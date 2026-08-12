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

#[derive(Deserialize)]
struct PrintPdfRequest {
    file_name: String,
    pdf_base64: String,
}

// Holds the background Python process so we can kill it safely when closing the app
struct BackendState(Arc<Mutex<Option<CommandChild>>>);

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
    fs::write(&temp_path, pdf_bytes)
        .map_err(|error| format!("failed to write temporary PDF: {error}"))?;

    #[cfg(target_os = "windows")]
    {
        log::info!("using Windows print verb for {}", temp_path.display());
        let path_string = temp_path.to_string_lossy().to_string();
        let escaped_path = path_string.replace('"', "\"");
        let status = Command::new("powershell")
            .args([
                "-NoProfile",
                "-Command",
                &format!(
                    "Start-Process -FilePath \"{}\" -Verb Print",
                    escaped_path
                ),
            ])
            .status()
            .map_err(|error| format!("failed to launch Windows print verb: {error}"))?;

        if !status.success() {
            return Err(format!("Windows print verb exited with status: {status}"));
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        log::info!("using native viewer fallback for {}", temp_path.display());
        let status = Command::new("xdg-open")
            .arg(&temp_path)
            .status()
            .map_err(|error| format!("failed to launch native viewer: {error}"))?;

        if !status.success() {
            return Err(format!("native viewer exited with status: {status}"));
        }
    }

    Ok(temp_path.to_string_lossy().to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let backend_child = Arc::new(Mutex::new(None));
    let backend_child_clone = backend_child.clone();

    tauri::Builder::default()
        .plugin(tauri_plugin_log::Builder::new().build())
        .plugin(tauri_plugin_shell::init())
        // Prevents the user from opening PASADA twice and crashing the ports
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .invoke_handler(tauri::generate_handler![print_pdf_fallback])
        .manage(BackendState(backend_child))
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