use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

use crate::app_paths;

#[derive(Debug, Serialize, Deserialize, Default)]
pub struct AppSettings {
    pub mpq_paths: Vec<String>,
    pub copy_mpq_textures: bool,
}

fn settings_path() -> Result<PathBuf, String> {
    let root = app_paths::get_app_storage_root()?;
    Ok(root.join("app_settings.json"))
}

pub fn load_settings() -> AppSettings {
    let path = match settings_path() {
        Ok(p) => p,
        Err(_) => return AppSettings::default(),
    };
    let data = match fs::read(&path) {
        Ok(d) => d,
        Err(_) => return AppSettings::default(),
    };
    serde_json::from_slice(&data).unwrap_or_default()
}

pub fn save_settings(settings: &AppSettings) -> Result<(), String> {
    let path = settings_path()?;
    let data = serde_json::to_vec_pretty(settings).map_err(|e| e.to_string())?;
    fs::write(&path, data).map_err(|e| e.to_string())
}

pub fn update_mpq_paths(paths: Vec<String>) -> Result<(), String> {
    let mut settings = load_settings();
    settings.mpq_paths = paths;
    save_settings(&settings)
}

pub fn set_copy_mpq_textures(enabled: bool) -> Result<(), String> {
    let mut settings = load_settings();
    settings.copy_mpq_textures = enabled;
    save_settings(&settings)
}

pub fn get_copy_mpq_textures() -> bool {
    load_settings().copy_mpq_textures
}

pub fn get_mpq_paths() -> Vec<String> {
    load_settings().mpq_paths
}
