use std::fs;
use std::path::PathBuf;

fn migrate_settings_from_exe_dir(target_root: &PathBuf) {
    let exe_path = match std::env::current_exe() {
        Ok(path) => path,
        Err(_) => return,
    };
    let exe_dir = match exe_path.parent() {
        Some(dir) => dir,
        None => return,
    };
    let source_settings = exe_dir.join("war3modelview_data").join("settings");
    if !source_settings.is_dir() {
        return;
    }

    let target_settings = target_root.join("settings");
    if fs::create_dir_all(&target_settings).is_err() {
        return;
    }

    let entries = match fs::read_dir(&source_settings) {
        Ok(v) => v,
        Err(_) => return,
    };
    let mut copied_any = false;
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let file_name = match path.file_name() {
            Some(name) => name,
            None => continue,
        };
        let target_path = target_settings.join(file_name);
        if target_path.exists() {
            continue;
        }
        if fs::copy(&path, &target_path).is_ok() {
            copied_any = true;
        }
    }
    if copied_any || source_settings.read_dir().map(|mut it| it.next().is_none()).unwrap_or(false) {
        let _ = fs::remove_dir_all(&source_settings);
    }
}

pub fn get_app_storage_root() -> Result<PathBuf, String> {
    let local_app_data = std::env::var("LOCALAPPDATA")
        .map_err(|_| "Failed to create app data dir".to_string())?;
    let fallback_root = PathBuf::from(local_app_data)
        .join("War3ModelView")
        .join("war3modelview_data");
    fs::create_dir_all(&fallback_root)
        .map_err(|e| format!("Failed to create app data dir: {}", e))?;
    migrate_settings_from_exe_dir(&fallback_root);
    Ok(fallback_root)
}
