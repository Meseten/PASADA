// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Run the main Tauri application. Graceful cleanup is now handled in lib.rs
    app_lib::run();
}