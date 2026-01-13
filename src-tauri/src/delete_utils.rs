use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};

pub fn delete_model_with_shared_textures(model_path: &str) -> Result<String, String> {
    let model_path_obj = Path::new(model_path);
    if !model_path_obj.exists() {
        return Err(format!("Model file not found: {:?}", model_path_obj));
    }

    let model_dir = model_path_obj
        .parent()
        .ok_or("Invalid model path")?;
    let model_name = model_path_obj
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();

    let model_textures = resolve_model_textures(model_path_obj)?;

    let mut shared_textures: HashSet<String> = HashSet::new();
    for entry in fs::read_dir(model_dir).map_err(|e| format!("Read dir failed: {}", e))? {
        let entry = match entry {
            Ok(v) => v,
            Err(_) => continue,
        };
        let path = entry.path();
        if path == model_path_obj {
            continue;
        }
        let ext = path
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("")
            .to_lowercase();
        if ext != "mdx" && ext != "mdl" {
            continue;
        }
        if let Ok(other_textures) = resolve_model_textures(&path) {
            for tex in other_textures {
                shared_textures.insert(tex.to_lowercase());
            }
        }
    }

    let mut deleted_textures = 0usize;
    for tex in model_textures.iter() {
        if shared_textures.contains(&tex.to_lowercase()) {
            continue;
        }
        if fs::remove_file(tex).is_ok() {
            deleted_textures += 1;
        }
    }

    let model_deleted = fs::remove_file(model_path_obj).is_ok();
    if !model_deleted {
        return Err("Failed to delete model file".to_string());
    }

    Ok(format!(
        "Deleted {} ({} textures)",
        model_name, deleted_textures
    ))
}

fn resolve_model_textures(model_path: &Path) -> Result<Vec<String>, String> {
    let data = fs::read(model_path).map_err(|e| format!("Failed to read model: {}", e))?;
    let texture_paths = extract_texture_paths(&data, model_path);
    let model_dir = model_path
        .parent()
        .ok_or("Invalid model path")?;

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

fn extract_texture_paths(data: &[u8], model_path: &Path) -> Vec<String> {
    let mut paths = Vec::new();
    let ext = model_path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();

    if ext == "mdx" {
        if let Some(texs_pos) = find_chunk(data, b"TEXS") {
            let chunk_size = u32::from_le_bytes([
                data[texs_pos + 4],
                data[texs_pos + 5],
                data[texs_pos + 6],
                data[texs_pos + 7],
            ]) as usize;
            let chunk_data = &data[texs_pos + 8..texs_pos + 8 + chunk_size];

            let entry_size = 268;
            for i in (0..chunk_data.len()).step_by(entry_size) {
                if i + entry_size > chunk_data.len() {
                    break;
                }
                let path_bytes = &chunk_data[i + 4..i + 4 + 260];
                if let Some(null_pos) = path_bytes.iter().position(|&b| b == 0) {
                    if let Ok(path_str) = std::str::from_utf8(&path_bytes[..null_pos]) {
                        let trimmed = path_str.trim();
                        if !trimmed.is_empty() && !trimmed.starts_with("ReplaceableTextures") {
                            paths.push(
                                trimmed
                                    .replace("\\", "/")
                                    .replace("/", std::path::MAIN_SEPARATOR_STR),
                            );
                        }
                    }
                }
            }
        }
    } else if ext == "mdl" {
        if let Ok(text) = std::str::from_utf8(data) {
            for line in text.lines() {
                let line = line.trim();
                if line.starts_with("Image ") {
                    if let Some(start) = line.find('"') {
                        if let Some(end) = line.rfind('"') {
                            if end > start {
                                let path_str = &line[start + 1..end];
                                if !path_str.is_empty()
                                    && !path_str.starts_with("ReplaceableTextures")
                                {
                                    paths.push(path_str.replace("\\", std::path::MAIN_SEPARATOR_STR));
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    paths
}

fn find_chunk(data: &[u8], chunk_id: &[u8; 4]) -> Option<usize> {
    let mut pos = 0;
    if data.len() >= 4 && &data[0..4] == b"MDLX" {
        pos = 4;
    }
    while pos + 8 <= data.len() {
        if &data[pos..pos + 4] == chunk_id {
            return Some(pos);
        }
        if pos + 8 > data.len() {
            break;
        }
        let chunk_size =
            u32::from_le_bytes([data[pos + 4], data[pos + 5], data[pos + 6], data[pos + 7]])
                as usize;
        pos += 8 + chunk_size;
    }
    None
}
