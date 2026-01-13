use std::fs;
use std::path::PathBuf;

pub fn get_app_storage_root() -> Result<PathBuf, String> {
    let exe_path =
        std::env::current_exe().map_err(|e| format!("Failed to get current exe path: {}", e))?;
    let exe_dir = exe_path
        .parent()
        .ok_or("Failed to get exe directory")?;
    let root = exe_dir.join("war3modelview_data");
    if fs::create_dir_all(&root).is_ok() {
        return Ok(root);
    }

    let local_app_data = std::env::var("LOCALAPPDATA")
        .map_err(|_| "Failed to create app data dir".to_string())?;
    let fallback_root = PathBuf::from(local_app_data)
        .join("War3ModelView")
        .join("war3modelview_data");
    fs::create_dir_all(&fallback_root)
        .map_err(|e| format!("Failed to create app data dir: {}", e))?;
    Ok(fallback_root)
}
