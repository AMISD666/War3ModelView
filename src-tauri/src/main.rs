#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod mpq_manager;
use mpq_manager::MpqManager;
use tauri::State;

use winreg::enums::*;
use winreg::RegKey;

#[tauri::command]
fn detect_warcraft_path() -> Result<String, String> {
    println!("[Rust] Command: detect_warcraft_path");
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let path = std::path::Path::new("SOFTWARE").join("Blizzard Entertainment").join("Warcraft III");
    
    // Try to open the key
    let key = match hkcu.open_subkey(&path) {
        Ok(k) => k,
        Err(_) => return Err("Registry key not found".to_string()),
    };
    
    // Try to read the value
    let install_path: String = match key.get_value("InstallPath") {
        Ok(p) => p,
        Err(_) => return Err("InstallPath value not found".to_string()),
    };
    
    Ok(install_path)
}

#[tauri::command]
fn toggle_console(show: bool) {
    println!("[Rust] Command: toggle_console({})", show);
    #[cfg(windows)]
    unsafe {
        use windows_sys::Win32::System::Console::{AllocConsole, FreeConsole};
        if show {
            AllocConsole();
        } else {
            FreeConsole();
        }
    }
}

#[tauri::command]
fn load_mpq(path: String, state: State<MpqManager>) -> Result<String, String> {
    println!("[Rust] Command: load_mpq({})", path);
    state.add_archive(&path)
}

#[tauri::command]
fn read_mpq_file(path: String, state: State<MpqManager>) -> Result<Vec<u8>, String> {
    println!("[Rust] Command: read_mpq_file({})", path);
    match state.read_file(&path) {
        Some(data) => Ok(data),
        None => Err(format!("File not found in MPQs: {}", path)),
    }
}

fn main() {
  tauri::Builder::default()
    .manage(MpqManager::new())
    .plugin(tauri_plugin_fs::init())
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_shell::init())
    .invoke_handler(tauri::generate_handler![load_mpq, read_mpq_file, detect_warcraft_path, toggle_console])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
