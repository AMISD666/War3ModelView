use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::ipc::Response;

use crate::{activation, app_paths};

#[derive(Debug, Clone, Serialize)]
pub struct SecureDirEntry {
    pub name: String,
    #[serde(rename = "isDirectory")]
    pub is_directory: bool,
    #[serde(rename = "isFile")]
    pub is_file: bool,
    #[serde(rename = "isSymlink")]
    pub is_symlink: bool,
}

fn normalize_for_compare(path: &Path) -> PathBuf {
    path.canonicalize().unwrap_or_else(|_| path.to_path_buf())
}

fn is_inside_app_storage(path: &str) -> bool {
    let Ok(root) = app_paths::get_app_storage_root() else {
        return false;
    };
    let root = normalize_for_compare(&root);
    let target = normalize_for_compare(Path::new(path));
    target.starts_with(root)
}

fn require_external_access(path: &str, feature_name: &str) -> Result<(), String> {
    if is_inside_app_storage(path) {
        return Ok(());
    }
    activation::require_basic_activation(feature_name).map(|_| ())
}

fn ensure_parent_dir(path: &str) -> Result<(), String> {
    if let Some(parent) = Path::new(path).parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create parent directory: {}", e))?;
        }
    }
    Ok(())
}

#[tauri::command]
pub fn secure_read_text_file(path: String) -> Result<String, String> {
    fs::read_to_string(path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn secure_write_text_file(path: String, contents: String) -> Result<(), String> {
    require_external_access(&path, "Writing files")?;
    ensure_parent_dir(&path)?;
    fs::write(path, contents).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn secure_read_file(path: String) -> Result<Response, String> {
    fs::read(path).map(Response::new).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn secure_write_file(path: String, contents: Vec<u8>) -> Result<(), String> {
    require_external_access(&path, "Writing files")?;
    ensure_parent_dir(&path)?;
    fs::write(path, contents).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn secure_copy_file(source_path: String, target_path: String) -> Result<(), String> {
    require_external_access(&target_path, "Copying files")?;
    ensure_parent_dir(&target_path)?;
    fs::copy(source_path, target_path)
        .map(|_| ())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn secure_create_dir(path: String, recursive: Option<bool>) -> Result<(), String> {
    require_external_access(&path, "Creating directories")?;
    if recursive.unwrap_or(false) {
        fs::create_dir_all(path).map_err(|e| e.to_string())
    } else {
        fs::create_dir(path).map_err(|e| e.to_string())
    }
}

#[tauri::command]
pub fn secure_remove_path(path: String, recursive: Option<bool>) -> Result<(), String> {
    require_external_access(&path, "Removing files")?;
    let metadata = fs::symlink_metadata(&path).map_err(|e| e.to_string())?;
    if metadata.is_dir() && recursive.unwrap_or(false) {
        fs::remove_dir_all(path).map_err(|e| e.to_string())
    } else if metadata.is_dir() {
        fs::remove_dir(path).map_err(|e| e.to_string())
    } else {
        fs::remove_file(path).map_err(|e| e.to_string())
    }
}

#[tauri::command]
pub fn secure_exists(path: String) -> bool {
    Path::new(&path).exists()
}

#[tauri::command]
pub fn secure_file_size(path: String) -> Result<u64, String> {
    fs::metadata(path)
        .map(|metadata| metadata.len())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn secure_read_dir(path: String) -> Result<Vec<SecureDirEntry>, String> {
    let entries = fs::read_dir(path).map_err(|e| e.to_string())?;
    let mut result = Vec::new();
    for entry in entries {
        let entry = entry.map_err(|e| e.to_string())?;
        let file_type = entry.file_type().map_err(|e| e.to_string())?;
        result.push(SecureDirEntry {
            name: entry.file_name().to_string_lossy().to_string(),
            is_directory: file_type.is_dir(),
            is_file: file_type.is_file(),
            is_symlink: file_type.is_symlink(),
        });
    }
    Ok(result)
}
