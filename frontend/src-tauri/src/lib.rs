use std::sync::{Arc, Mutex};
use tauri::{Manager, RunEvent};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

// Holds the background Python process so we can kill it safely when closing the app
struct BackendState(Arc<Mutex<Option<CommandChild>>>);

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