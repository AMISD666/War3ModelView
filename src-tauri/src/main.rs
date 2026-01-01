#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod activation;
mod mpq_manager;

use mpq_manager::MpqManager;
use tauri::State;

use winreg::enums::*;
use winreg::RegKey;

#[tauri::command]
fn detect_warcraft_path() -> Result<String, String> {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let path = std::path::Path::new("SOFTWARE")
        .join("Blizzard Entertainment")
        .join("Warcraft III");

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
fn debug_log(message: String) {
    println!("{}", message);
}

#[tauri::command]
fn load_mpq(path: String, state: State<MpqManager>) -> Result<String, String> {
    state.add_archive(&path)
}

#[tauri::command]
fn read_mpq_file(path: String, state: State<MpqManager>) -> Result<Vec<u8>, String> {
    match state.read_file(&path) {
        Some(data) => Ok(data),
        None => Err(format!("File not found in MPQs: {}", path)),
    }
}

#[tauri::command]
fn read_mpq_files_batch(paths: Vec<String>, state: State<MpqManager>) -> Vec<Option<Vec<u8>>> {
    state.read_files_batch(&paths)
}

#[tauri::command]
fn read_local_files_batch(paths: Vec<String>) -> Vec<Option<Vec<u8>>> {
    paths.iter().map(|path| std::fs::read(path).ok()).collect()
}

// ==================
// Activation Commands
// ==================
#[tauri::command]
fn get_machine_id() -> Result<String, String> {
    activation::get_machine_id()
}

#[tauri::command]
fn get_activation_status() -> activation::ActivationStatus {
    activation::get_activation_status()
}

#[tauri::command]
fn activate_software(license_code: String) -> Result<activation::ActivationStatus, String> {
    activation::activate_software(&license_code)
}

// ==================
// Context Menu Commands
// ==================
#[tauri::command]
fn register_context_menu() -> Result<bool, String> {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let mut exe_path = std::env::current_exe()
        .map_err(|e| e.to_string())?
        .to_string_lossy()
        .to_string();

    // Fix: Remove UNC prefix if present, as it can confuse registry commands
    if exe_path.starts_with("\\\\?\\") {
        exe_path = exe_path[4..].to_string();
    }

    let extensions = ["mdx", "mdl"];

    // Clean up old key name if it exists to avoid confusion
    for ext in &extensions {
        let old_shell_path = format!(
            "Software\\Classes\\SystemFileAssociations\\.{}\\shell\\GGwar3Edit",
            ext
        );
        let _ = hkcu.delete_subkey_all(&old_shell_path);
    }

    for ext in &extensions {
        // Use a new, unique key name "GGWar3View"
        let shell_path = format!(
            "Software\\Classes\\SystemFileAssociations\\.{}\\shell\\GGWar3View",
            ext
        );
        let command_path = format!("{}\\command", shell_path);

        // 1. Create shell key (force new)
        let (shell_key, _) = hkcu
            .create_subkey(&shell_path)
            .map_err(|e| format!("Failed to create shell key for .{}: {}", ext, e))?;

        // 2. Set display name
        shell_key
            .set_value("", &"使用 GGwar3Edit 打开")
            .map_err(|e| format!("Failed to set display name: {}", e))?;

        // 3. Set icon
        shell_key
            .set_value("Icon", &format!("\"{}\",0", exe_path))
            .map_err(|e| format!("Failed to set icon: {}", e))?;

        // 4. Create command key
        let (command_key, _) = hkcu
            .create_subkey(&command_path)
            .map_err(|e| format!("Failed to create command key: {}", e))?;

        // 5. Set command string: "PATH" "%1"
        command_key
            .set_value("", &format!("\"{}\" \"%1\"", exe_path))
            .map_err(|e| format!("Failed to set command: {}", e))?;
    }

    Ok(true)
}

#[tauri::command]
fn unregister_context_menu() -> Result<bool, String> {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let extensions = ["mdx", "mdl"];

    for ext in &extensions {
        let shell_path = format!(
            "Software\\Classes\\SystemFileAssociations\\.{}\\shell\\GGWar3View",
            ext
        );
        let _ = hkcu.delete_subkey_all(&shell_path);

        // Also clean up old key
        let old_shell_path = format!(
            "Software\\Classes\\SystemFileAssociations\\.{}\\shell\\GGwar3Edit",
            ext
        );
        let _ = hkcu.delete_subkey_all(&old_shell_path);
    }

    Ok(true)
}

#[tauri::command]
fn check_context_menu_status() -> bool {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let mdx_path = "Software\\Classes\\SystemFileAssociations\\.mdx\\shell\\GGWar3View";
    let mdl_path = "Software\\Classes\\SystemFileAssociations\\.mdl\\shell\\GGWar3View";

    hkcu.open_subkey(mdx_path).is_ok() && hkcu.open_subkey(mdl_path).is_ok()
}

#[tauri::command]
fn get_cli_file_path() -> Option<String> {
    let args: Vec<String> = std::env::args().collect();
    // First arg is the executable, second would be the file path
    for arg in args.iter().skip(1) {
        let lower = arg.to_lowercase();
        if lower.ends_with(".mdx") || lower.ends_with(".mdl") {
            return Some(arg.clone());
        }
    }
    None
}

fn main() {
    tauri::Builder::default()
        .manage(MpqManager::new())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            load_mpq,
            read_mpq_file,
            read_mpq_files_batch,
            read_local_files_batch,
            detect_warcraft_path,
            toggle_console,
            debug_log,
            // Activation Commands
            get_machine_id,
            get_activation_status,
            activate_software,
            // Context Menu Commands
            register_context_menu,
            unregister_context_menu,
            check_context_menu_status,
            get_cli_file_path
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
