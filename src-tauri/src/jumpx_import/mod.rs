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

use crate::activation;
use crate::activation::FbxCapability;
use crate::action_name_mapping::{load_action_name_mapping_from_exe_dir, ActionNameMapping};
use std::fs;
use std::path::Path;

#[tauri::command]
pub fn probe_jumpx_import(
    path: String,
    options: Option<JumpxImportSettings>,
) -> Result<JumpxProbeResult, String> {
    let capability = activation::require_fbx_capability()?;
    probe_jumpx_import_with_capability(path, options, &capability)
}

fn probe_jumpx_import_with_capability(
    path: String,
    options: Option<JumpxImportSettings>,
    capability: &FbxCapability,
) -> Result<JumpxProbeResult, String> {
    capability.assert_valid_for_operation("JumpX probe")?;
    probe_jumpx_import_unchecked(path, options)
}

fn probe_jumpx_import_unchecked(
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
    let capability = activation::require_fbx_capability()?;
    import_jumpx_static_scene_with_capability(path, options, &capability)
}

fn import_jumpx_static_scene_with_capability(
    path: String,
    options: Option<JumpxImportSettings>,
    capability: &FbxCapability,
) -> Result<JumpxStaticSceneResult, String> {
    capability.assert_valid_for_operation("JumpX static scene import")?;
    import_jumpx_static_scene_unchecked(path, options)
}

fn import_jumpx_static_scene_unchecked(
    path: String,
    options: Option<JumpxImportSettings>,
) -> Result<JumpxStaticSceneResult, String> {
    let (bytes, file_size) = read_jumpx_file(&path, options)?;
    let mut scene = parser::parse_jumpx_scene(path, file_size, &bytes)?;
    apply_action_name_mapping_to_jumpx_actions(&mut scene.actions);
    Ok(scene)
}

fn apply_action_name_mapping_to_jumpx_actions(actions: &mut [JumpxActionDto]) {
    let Some(mapping) = load_action_name_mapping_from_exe_dir() else {
        return;
    };
    apply_action_name_mapping(actions, &mapping);
}

fn apply_action_name_mapping(actions: &mut [JumpxActionDto], mapping: &ActionNameMapping) {
    let raw_names: Vec<String> = actions.iter().map(|action| action.name.clone()).collect();
    for (action, mapped_name) in actions.iter_mut().zip(mapping.map_sequence_names(&raw_names)) {
        if let Some(name) = mapped_name {
            action.name = name;
        }
    }
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
