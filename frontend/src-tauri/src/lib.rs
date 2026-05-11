use tauri_plugin_shell::ShellExt;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            match app.shell().sidecar("pasada-backend") {
                Ok(command) => {
                    command.spawn().expect("Failed to spawn FastAPI backend");
                }
                Err(e) => {
                    eprintln!("Failed to locate sidecar: {}", e);
                }
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}