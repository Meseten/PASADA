// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Run the main Tauri application
    app_lib::run();
    
    // AGGRESSIVE ZOMBIE HUNTER: Executes the moment the app window is closed
    #[cfg(target_os = "windows")]
    {
        let _ = std::process::Command::new("taskkill")
            .args(&["/F", "/T", "/IM", "pasada-backend.exe"])
            .status();
    }
}