use std::fs;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::Deserialize;
use tauri::{Emitter, Manager, RunEvent};
use tauri_plugin_updater::UpdaterExt;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[derive(Deserialize)]
struct PrintPdfRequest {
    file_name: String,
    pdf_base64: String,
}

// Holds the background Python process so we can kill it safely when closing the app
struct BackendState(Arc<Mutex<Option<Child>>>);

// The update downloaded and signature-verified by prepare_app_update, kept
// so install_app_update does not need a second download. Cleared when used.
struct PreparedUpdateState(Arc<Mutex<Option<Vec<u8>>>>);

// The backend now ships as an ONEDIR PyInstaller folder (exe + _internal/).
// Onefile self-extracted ~106 MB on EVERY launch — measured as the dominant
// chunk of the office's first boot. Onedir pays the unpack once at install
// time; launch goes straight to interpreter import. The folder rides in the
// bundle as a Tauri resource (tauri.conf.json -> bundle.resources -> "backend/").
fn locate_backend_dir(app: &tauri::AppHandle) -> Option<PathBuf> {
    // Bundled (installed) app: the resource dir holds the "backend/" folder.
    if let Ok(resource_dir) = app.path().resource_dir() {
        let candidate = resource_dir.join("backend");
        if candidate.join(backend_exe_name()).exists() {
            return Some(candidate);
        }
    }
    // Unpackaged local run (cargo target/release): the folder sits beside exe.
    if let Ok(current_exe) = std::env::current_exe() {
        if let Some(exe_dir) = current_exe.parent() {
            let candidate = exe_dir.join("backend");
            if candidate.join(backend_exe_name()).exists() {
                return Some(candidate);
            }
        }
    }
    None
}

fn backend_exe_name() -> &'static str {
    if cfg!(windows) {
        "pasada-backend.exe"
    } else {
        "pasada-backend"
    }
}

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

// The onedir backend is spawned with std::process and streamed to the
// backend-status pipeline through this channel.
enum BackendEvent {
    Stdout(String),
    Stderr(String),
    Terminated(Option<i32>),
}

// Sidecar status pipeline: one consumer task emits "failed" the moment the
// backend process exits (crash mid-boot, missing payload), and a helper
// thread emits "ready" as soon as something actually accepts a TCP
// connection on the API port. The frontend listens on the backend-status
// event channel so the login screen can distinguish "still starting" from
// "the backend died" instead of showing a spinner forever.
fn watch_backend_events(app: tauri::AppHandle, rx: std::sync::mpsc::Receiver<BackendEvent>) {
    let handle = app.clone();
    std::thread::spawn(move || {
        while let Ok(event) = rx.recv() {
            match event {
                BackendEvent::Stdout(line) => log::info!("[Backend]: {}", line),
                BackendEvent::Stderr(line) => log::error!("[Backend]: {}", line),
                BackendEvent::Terminated(status) => {
                    // The backend process ended. Normal shutdown never reaches
                    // here (we kill it ourselves on exit), so this is a crash
                    // mid-boot or a payload problem — tell the webview, whose
                    // Connecting panel turns it into a real error message.
                    log::error!("[Backend] terminated: {:?}", status);
                    let _ = handle.emit("backend-status", serde_json::json!({"type": "failed", "message": "The PASADA service on this computer stopped unexpectedly. Restart the app."}));
                }
            }
        }
    });
    let watch_handle = app.clone();
    std::thread::spawn(move || {
        use std::net::TcpStream;
        for _ in 0..600 {
            if TcpStream::connect_timeout(
                &"127.0.0.1:43888".parse().unwrap(),
                std::time::Duration::from_millis(500),
            ).is_ok() {
                log::info!("[Backend] port reachable; emitting ready");
                let _ = watch_handle.emit("backend-status", serde_json::json!({"type": "ready"}));
                return;
            }
            std::thread::sleep(std::time::Duration::from_millis(500));
        }
        // The watcher thread exhausted its retries without the port ever
        // opening. The died-handler above will fire on real process death;
        // if the process is alive but wedged, tell the user after 5 minutes.
        let _ = watch_handle.emit("backend-status", serde_json::json!({"type": "failed", "message": "The PASADA service did not become reachable after several minutes. Restart the app or check this computer's disk activity."}));
    });
}

// Launches the onedir backend folder and feeds its streams into the event
// channel. Windows: without CREATE_NO_WINDOW the console binary flashes a
// cmd window before the webview is up — visible and ugly on every boot.
// The child lives in BackendState; the death watcher polls try_wait() through
// the SAME state lock instead of taking ownership, so the exit handler keeps
// its clean kill path.
fn launch_backend(app: &tauri::AppHandle, dir: PathBuf, state: &BackendState) {
    let exe_path = dir.join(backend_exe_name());
    log::info!("launching onedir backend at {}", exe_path.display());

    let mut command = Command::new(&exe_path);
    command.stdout(Stdio::piped()).stderr(Stdio::piped());
    #[cfg(windows)]
    {
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }

    let mut child = match command.spawn() {
        Ok(child) => child,
        Err(error) => {
            log::error!("Failed to spawn FastAPI backend: {}", error);
            let _ = app.emit("backend-status", serde_json::json!({"type": "failed", "message": format!("The PASADA service failed to start: {}", error)}));
            return;
        }
    };

    let (tx, rx) = std::sync::mpsc::channel::<BackendEvent>();
    watch_backend_events(app.clone(), rx);

    if let Some(stdout) = child.stdout.take() {
        let tx = tx.clone();
        std::thread::spawn(move || {
            use std::io::{BufRead, BufReader};
            for line in BufReader::new(stdout).lines() {
                match line {
                    Ok(line) => { let _ = tx.send(BackendEvent::Stdout(line)); }
                    Err(_) => break,
                }
            }
        });
    }
    if let Some(stderr) = child.stderr.take() {
        let tx = tx.clone();
        std::thread::spawn(move || {
            use std::io::{BufRead, BufReader};
            for line in BufReader::new(stderr).lines() {
                match line {
                    Ok(line) => { let _ = tx.send(BackendEvent::Stderr(line)); }
                    Err(_) => break,
                }
            }
        });
    }

    let death_tx = tx;
    let death_state = state.0.clone();
    std::thread::spawn(move || {
        // Death watcher: poll try_wait through the shared state lock. Exits
        // when the process ends (emit Terminated) or when the state was taken
        // by the app's own shutdown kill (state empty — stay quiet).
        loop {
            let observed = {
                let mut lock = match death_state.lock() {
                    Ok(lock) => lock,
                    Err(poisoned) => poisoned.into_inner(),
                };
                match lock.as_mut() {
                    None => break,
                    Some(child) => child.try_wait(),
                }
            };
            match observed {
                Ok(Some(status)) => {
                    let _ = death_tx.send(BackendEvent::Terminated(status.code()));
                    break;
                }
                Ok(None) => std::thread::sleep(std::time::Duration::from_millis(500)),
                Err(_) => {
                    let _ = death_tx.send(BackendEvent::Terminated(None));
                    break;
                }
            }
        }
    });

    *(state.0.lock().unwrap_or_else(|poisoned| poisoned.into_inner())) = Some(child);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_log::Builder::new().build())
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
        .manage(BackendState(Arc::new(Mutex::new(None))))
        .manage(PreparedUpdateState(Arc::new(Mutex::new(None))))
        .setup(move |app| {
            // Launch the ONEDIR backend engine (bundled as the "backend/"
            // resource folder). A missing folder is a packaging bug: say so
            // and surface it on the login screen, never a silent dark wait.
            match locate_backend_dir(app.handle()) {
                Some(dir) => {
                    let state = app.state::<BackendState>();
                    launch_backend(app.handle(), dir, &state);
                }
                None => {
                    log::error!("Backend engine folder not found next to the app (expected a backend/pasada-backend folder).");
                    let _ = app.emit("backend-status", serde_json::json!({"type": "failed", "message": "The PASADA service folder is missing on this computer. Reinstall the app."}));
                }
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(move |app_handle, event| {
            // Cross-platform Graceful Shutdown
            if let RunEvent::ExitRequested { .. } | RunEvent::Exit = event {
                if let Some(state) = app_handle.try_state::<BackendState>() {
                    if let Ok(mut lock) = state.0.lock() {
                        if let Some(mut child) = lock.take() {
                            log::info!("Gracefully terminating the backend...");
                            let _ = child.kill();
                            let _ = child.wait();
                        }
                    }
                }
            }
        });
}
