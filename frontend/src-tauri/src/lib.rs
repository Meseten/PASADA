use std::fs;
use std::path::PathBuf;
use std::process::Command;
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::Deserialize;
use tauri::{Manager, RunEvent};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;
use tauri_plugin_updater::UpdaterExt;

#[derive(Deserialize)]
struct PrintPdfRequest {
    file_name: String,
    pdf_base64: String,
}

// Holds the background Python process so we can kill it safely when closing the app
struct BackendState(Arc<Mutex<Option<CommandChild>>>);

// The update downloaded and signature-verified by prepare_app_update, kept
// so install_app_update does not need a second download. Cleared when used.
struct PreparedUpdateState(Arc<Mutex<Option<Vec<u8>>>>);

fn unique_temp_pdf_path(file_name: &str) -> PathBuf {
    let temp_dir = std::env::temp_dir();
    let suffix = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or_default();
    temp_dir.join(format!("pasada-{}-{}", suffix, file_name))
}

#[tauri::command]
fn print_pdf_fallback(request: PrintPdfRequest) -> Result<String, String> {
    log::info!("print_pdf_fallback requested for {}", request.file_name);
    let pdf_bytes = STANDARD
        .decode(request.pdf_base64)
        .map_err(|error| format!("failed to decode PDF payload: {error}"))?;

    let temp_path = unique_temp_pdf_path(&request.file_name);
    fs::write(&temp_path, &pdf_bytes)
        .map_err(|error| format!("failed to write temporary PDF: {error}"))?;

    #[cfg(target_os = "windows")]
    {
        let path_string = temp_path.to_string_lossy().to_string();
        // Prevent PowerShell string injection by properly escaping single quotes
        let escaped_path = path_string.replace("'", "''");

        // THE FIX: Bulletproof PowerShell try/catch. 
        // 1. Tries to invoke the native Print verb (Works flawlessly for Acrobat).
        // 2. If it fails (Because Edge/Chrome is default and blocks it), it catches the error and forces the PDF to open on screen so the user can manually print.
        let ps_script = format!(
            "try {{ Start-Process -LiteralPath '{}' -Verb Print -WindowStyle Hidden -ErrorAction Stop }} catch {{ Start-Process -LiteralPath '{}' }}",
            escaped_path, escaped_path
        );

        log::info!("executing Windows print fallback: {}", ps_script);

        // spawn() instead of status() prevents Tauri from locking up, unfreezing the UI instantly.
        let _ = Command::new("powershell")
            .args(["-NoProfile", "-Command", &ps_script])
            .spawn()
            .map_err(|error| format!("failed to launch Windows print process: {error}"))?;
    }

    #[cfg(not(target_os = "windows"))]
    {
        log::info!("using native lpr fallback for {}", temp_path.display());
        let _ = Command::new("lpr")
            .arg(&temp_path)
            .spawn()
            .map_err(|error| format!("failed to launch native printer: {error}"))?;
    }

    // Memory Leak Prevention: Spawn a thread to delete the temp file after 5 minutes 
    // giving the OS spooler enough time to process it.
    let temp_path_clone = temp_path.clone();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_secs(300));
        let _ = fs::remove_file(temp_path_clone);
    });

    Ok(temp_path.to_string_lossy().to_string())
}

// Checks GitHub Releases for a newer PASADA version.
// Returns Ok(None) when the app is already up to date.
#[tauri::command]
async fn check_for_app_update(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let updater = app.updater().map_err(|error| error.to_string())?;
    let update = updater.check().await.map_err(|error| error.to_string())?;
    Ok(update.map(|u| u.version))
}

// Downloads the signed update in the background WITHOUT installing it. The
// bytes are verified against the release signature before they are stored,
// so a failed or forged download never reaches the install step.
#[tauri::command]
async fn prepare_app_update(app: tauri::AppHandle) -> Result<usize, String> {
    let updater = app.updater().map_err(|error| error.to_string())?;
    let Some(update) = updater.check().await.map_err(|error| error.to_string())? else {
        return Err("No update is available.".into());
    };

    log::info!("preparing update {} in the background", update.version);
    let bytes = update
        .download(
            |chunk, total| log::info!("update download: {chunk} of {total:?} bytes"),
            || log::info!("update download finished"),
        )
        .await
        .map_err(|error| error.to_string())?;

    let size = bytes.len();
    let state = app.state::<PreparedUpdateState>();
    if let Ok(mut lock) = state.0.lock() {
        *lock = Some(bytes);
    }
    log::info!("update {} prepared ({} bytes), waiting for the user to install", update.version, size);
    Ok(size)
}

// Installs the prepared update when one exists (no second download), or
// downloads then installs on the spot otherwise. The app restarts itself
// when the install completes; the Python sidecar is killed first so no
// backend process is left holding the old install directory.
#[tauri::command]
async fn install_app_update(app: tauri::AppHandle) -> Result<(), String> {
    let updater = app.updater().map_err(|error| error.to_string())?;
    let Some(update) = updater.check().await.map_err(|error| error.to_string())? else {
        return Err("No update is available.".into());
    };

    log::info!("installing PASADA update {}", update.version);

    #[cfg(any(windows, target_os = "linux"))]
    {
        // Reuse the background download when "prepare in background" already
        // fetched it. The bytes were signature-verified at download time.
        let state = app.state::<PreparedUpdateState>();
        let prepared = state.0.lock().ok().and_then(|mut lock| lock.take());
        match prepared {
            Some(bytes) => {
                log::info!("installing prepared update ({} bytes)", bytes.len());
                update
                    .install(&bytes)
                    .map_err(|error| error.to_string())?;
            }
            None => {
                // tauri-plugin-updater v2 passes the cumulative byte count (usize) and
                // the optional total straight to the progress closure; the old
                // DownloadEvent enum no longer exists in this API version.
                update
                    .download_and_install(
                        |chunk, total| log::info!("update download: {chunk} of {total:?} bytes"),
                        || log::info!("update download finished"),
                    )
                    .await
                    .map_err(|error| error.to_string())?;
            }
        }
    }
    #[cfg(target_os = "macos")]
    {
        update
            .download_and_install(|_, _| {}, || {})
            .await
            .map_err(|error| error.to_string())?;
    }

    // Relaunch into the new version. The NSIS installer on Windows usually
    // kills this process mid-install; restart() covers the platforms where
    // the process survives and makes the relaunch deterministic.
    app.restart();
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let backend_child = Arc::new(Mutex::new(None));
    let backend_child_clone = backend_child.clone();

    tauri::Builder::default()
        .plugin(tauri_plugin_log::Builder::new().build())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        // Prevents the user from opening PASADA twice and crashing the ports
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .invoke_handler(tauri::generate_handler![
            print_pdf_fallback,
            check_for_app_update,
            prepare_app_update,
            install_app_update
        ])
        .manage(BackendState(backend_child))
        .manage(PreparedUpdateState(Arc::new(Mutex::new(None))))
        .setup(move |app| {
            // Gracefully attempt to launch Python Backend
            match app.shell().sidecar("pasada-backend") {
                Ok(command) => {
                    match command.spawn() {
                        Ok((mut rx, child)) => {
                            // Lock the child process in managed state
                            if let Ok(mut lock) = backend_child_clone.lock() {
                                *lock = Some(child);
                            }
                            
                            // Pipe the Python output to the Tauri logger
                            tauri::async_runtime::spawn(async move {
                                while let Some(event) = rx.recv().await {
                                    match event {
                                        CommandEvent::Stdout(line) => log::info!("[Backend]: {}", String::from_utf8_lossy(&line)),
                                        CommandEvent::Stderr(line) => log::error!("[Backend]: {}", String::from_utf8_lossy(&line)),
                                        _ => {}
                                    }
                                }
                            });
                        }
                        Err(e) => log::error!("Failed to spawn FastAPI backend: {}", e),
                    }
                }
                Err(e) => log::error!("Failed to locate sidecar: {}", e),
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(move |app_handle, event| {
            // Cross-platform Graceful Shutdown (Replaces taskkill)
            if let RunEvent::ExitRequested { .. } | RunEvent::Exit = event {
                if let Some(state) = app_handle.try_state::<BackendState>() {
                    if let Ok(mut lock) = state.0.lock() {
                        if let Some(child) = lock.take() {
                            log::info!("Gracefully terminating the backend...");
                            let _ = child.kill();
                        }
                    }
                }
            }
        });
}
