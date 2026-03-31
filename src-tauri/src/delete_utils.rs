use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};

use crate::model_manifest::extract_texture_paths;

#[allow(dead_code)]
pub fn delete_model_with_shared_textures(model_path: &str) -> Result<String, String> {
    let paths = vec![model_path.to_string()];
    delete_models_with_shared_textures(&paths)
}

pub fn delete_models_with_shared_textures(model_paths: &[String]) -> Result<String, String> {
    if model_paths.is_empty() {
        return Err("No model paths provided".to_string());
    }

    let mut by_dir: HashMap<PathBuf, Vec<PathBuf>> = HashMap::new();
    for path in model_paths {
        let path_obj = Path::new(path);
        if !path_obj.exists() {
            continue;
        }
        if let Some(dir) = path_obj.parent() {
            by_dir
                .entry(dir.to_path_buf())
                .or_default()
                .push(path_obj.to_path_buf());
        }
    }

    if by_dir.is_empty() {
        return Err("No models found".to_string());
    }

    let mut deleted_models = 0usize;
    let mut deleted_textures = 0usize;
    let mut deleted_texture_set: HashSet<String> = HashSet::new();

    for (dir, selected_models) in by_dir {
        let selected_set: HashSet<PathBuf> = selected_models.iter().cloned().collect();
        let mut all_models: Vec<PathBuf> = Vec::new();

        if let Ok(entries) = fs::read_dir(&dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                let ext = path
                    .extension()
                    .and_then(|e| e.to_str())
                    .unwrap_or("")
                    .to_lowercase();
                if ext == "mdx" || ext == "mdl" {
                    all_models.push(path);
                }
            }
        }

        let mut usage: HashMap<String, usize> = HashMap::new();
        let mut selected_textures: HashMap<PathBuf, Vec<String>> = HashMap::new();

        for model_path in &all_models {
            if let Ok(textures) = resolve_model_textures(model_path) {
                for tex in textures.iter() {
                    let key = tex.to_lowercase();
                    *usage.entry(key).or_insert(0) += 1;
                }
                if selected_set.contains(model_path) {
                    selected_textures.insert(model_path.clone(), textures);
                }
            }
        }

        for model_path in &selected_models {
            if fs::remove_file(model_path).is_ok() {
                deleted_models += 1;
            }
            if let Some(textures) = selected_textures.get(model_path) {
                for tex in textures {
                    let key = tex.to_lowercase();
                    if usage.get(&key).copied().unwrap_or(0) == 1
                        && deleted_texture_set.insert(key.clone())
                    {
                        if fs::remove_file(tex).is_ok() {
                            deleted_textures += 1;
                        }
                    }
                }
            }
        }
    }

    Ok(format!(
        "Deleted {} models ({} textures)",
        deleted_models, deleted_textures
    ))
}

fn resolve_model_textures(model_path: &Path) -> Result<Vec<String>, String> {
    let data = fs::read(model_path).map_err(|e| format!("Failed to read model: {}", e))?;
    let texture_paths = extract_texture_paths(&data, model_path);
    let model_dir = model_path.parent().ok_or("Invalid model path")?;

    let mut resolved: Vec<String> = Vec::new();
    for tex_rel in texture_paths {
        if let Some(found) = resolve_texture_path(model_dir, &tex_rel) {
            resolved.push(found.to_string_lossy().to_string());
        }
    }
    Ok(resolved)
}

fn resolve_texture_path(model_dir: &Path, tex_path: &str) -> Option<PathBuf> {
    let normalized = tex_path.replace('/', "\\");
    let tex_path_obj = Path::new(&normalized);
    if tex_path_obj.is_absolute() && tex_path_obj.exists() {
        return Some(tex_path_obj.to_path_buf());
    }

    let tex_filename = tex_path_obj.file_name().unwrap_or_default();
    let mut search_bases: Vec<PathBuf> = vec![model_dir.to_path_buf()];
    let mut current = model_dir;
    for _ in 0..3 {
        if let Some(parent) = current.parent() {
            search_bases.push(parent.to_path_buf());
            current = parent;
        } else {
            break;
        }
    }

    for base in &search_bases {
        for candidate in &[base.join(&normalized), base.join(tex_filename)] {
            if candidate.exists() {
                return Some(candidate.clone());
            }
            let stem = candidate.with_extension("");
            for ext in &["blp", "tga", "dds", "png", "BLP", "TGA", "DDS", "PNG"] {
                let alt = stem.with_extension(ext);
                if alt.exists() {
                    return Some(alt);
                }
            }
        }
    }

    None
}
