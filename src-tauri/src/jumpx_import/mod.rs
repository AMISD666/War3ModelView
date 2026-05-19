mod binary;
mod container;
mod geometry_data;
mod math;
mod parser;
mod sections;
mod types;

#[cfg(test)]
mod tests;

pub use types::*;

use std::fs;
use std::path::Path;

#[tauri::command]
pub fn probe_jumpx_import(
    path: String,
    options: Option<JumpxImportSettings>,
) -> Result<JumpxProbeResult, String> {
    let (bytes, file_size) = read_jumpx_file(&path, options)?;
    parser::probe_jumpx(path, file_size, &bytes)
}

#[tauri::command]
pub fn import_jumpx_static_scene(
    path: String,
    options: Option<JumpxImportSettings>,
) -> Result<JumpxStaticSceneResult, String> {
    let (bytes, file_size) = read_jumpx_file(&path, options)?;
    parser::parse_jumpx_scene(path, file_size, &bytes)
}

fn read_jumpx_file(
    path: &str,
    options: Option<JumpxImportSettings>,
) -> Result<(Vec<u8>, u64), String> {
    let normalized_ext = Path::new(path)
        .extension()
        .and_then(|ext| ext.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    if normalized_ext != "x" {
        return Err("Only .x files can be imported by the JumpX importer".to_string());
    }

    let metadata = fs::metadata(path)
        .map_err(|error| format!("Failed to read JumpX file metadata: {error}"))?;
    if !metadata.is_file() {
        return Err("JumpX import path is not a file".to_string());
    }

    let file_size = metadata.len();
    let max_file_size_bytes = options
        .and_then(|value| value.max_file_size_bytes)
        .unwrap_or(256 * 1024 * 1024);
    if file_size > max_file_size_bytes {
        return Err(format!(
            "JumpX file is too large for the current import probe: {file_size} bytes > {max_file_size_bytes} bytes"
        ));
    }

    let bytes = fs::read(path).map_err(|error| format!("Failed to read JumpX file: {error}"))?;
    Ok((bytes, file_size))
}
