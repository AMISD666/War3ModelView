use serde::Serialize;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize)]
pub struct ModelManifestRow {
    pub full_path: String,
    pub file_name: String,
    pub animations: Vec<String>,
    pub texture_paths: Vec<String>,
    pub byte_len: usize,
    pub modified_unix_ms: u128,
}

pub fn build_manifest_row(full_path: &Path, data: &[u8]) -> ModelManifestRow {
    let file_name = full_path
        .file_name()
        .and_then(|v| v.to_str())
        .unwrap_or_default()
        .to_string();
    let metadata = std::fs::metadata(full_path).ok();
    let modified_unix_ms = metadata
        .and_then(|m| m.modified().ok())
        .and_then(|ts| ts.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis())
        .unwrap_or(0);

    ModelManifestRow {
        full_path: full_path.to_string_lossy().to_string(),
        file_name,
        animations: extract_animation_names(data, full_path),
        texture_paths: extract_texture_paths(data, full_path),
        byte_len: data.len(),
        modified_unix_ms,
    }
}

pub fn extract_texture_paths(data: &[u8], model_path: &Path) -> Vec<String> {
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
            let chunk_end = texs_pos + 8 + chunk_size;
            if chunk_end <= data.len() {
                let chunk_data = &data[texs_pos + 8..chunk_end];
                let entry_size = 268;
                for i in (0..chunk_data.len()).step_by(entry_size) {
                    if i + entry_size > chunk_data.len() {
                        break;
                    }
                    let path_bytes = &chunk_data[i + 4..i + 4 + 260];
                    let replaceable_id = i32::from_le_bytes([
                        chunk_data[i + 264],
                        chunk_data[i + 265],
                        chunk_data[i + 266],
                        chunk_data[i + 267],
                    ]);
                    if let Some(null_pos) = path_bytes.iter().position(|&b| b == 0) {
                        if let Ok(path_str) = std::str::from_utf8(&path_bytes[..null_pos]) {
                            let trimmed = path_str.trim();
                            if !trimmed.is_empty() {
                                paths.push(
                                    trimmed
                                        .replace("\\", "/")
                                        .replace("/", std::path::MAIN_SEPARATOR_STR),
                                );
                                continue;
                            }
                        }
                    }
                    if let Some(replaceable_path) = get_replaceable_texture_path(replaceable_id) {
                        paths.push(format!(
                            "ReplaceableTextures{}{}.blp",
                            std::path::MAIN_SEPARATOR,
                            replaceable_path.replace("\\", std::path::MAIN_SEPARATOR_STR)
                        ));
                    }
                }
            }
        }
    } else if ext == "mdl" {
        if let Ok(text) = std::str::from_utf8(data) {
            paths.extend(extract_mdl_texture_paths(text));
        }
    }

    dedupe_preserve_order(paths)
}

pub fn extract_animation_names(data: &[u8], model_path: &Path) -> Vec<String> {
    let ext = model_path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();

    let names = if ext == "mdx" {
        extract_mdx_animation_names(data)
    } else if ext == "mdl" {
        extract_mdl_animation_names(data)
    } else {
        Vec::new()
    };

    dedupe_preserve_order(names)
}

fn extract_mdx_animation_names(data: &[u8]) -> Vec<String> {
    let mut names = Vec::new();
    let Some(seqs_pos) = find_chunk(data, b"SEQS") else {
        return names;
    };
    let chunk_size = u32::from_le_bytes([
        data[seqs_pos + 4],
        data[seqs_pos + 5],
        data[seqs_pos + 6],
        data[seqs_pos + 7],
    ]) as usize;
    let chunk_end = seqs_pos + 8 + chunk_size;
    if chunk_end > data.len() {
        return names;
    }
    let chunk_data = &data[seqs_pos + 8..chunk_end];
    let entry_size = 132;

    for i in (0..chunk_data.len()).step_by(entry_size) {
        if i + entry_size > chunk_data.len() {
            break;
        }
        let name_bytes = &chunk_data[i..i + 80];
        let end = name_bytes.iter().position(|&b| b == 0).unwrap_or(name_bytes.len());
        if let Ok(name) = std::str::from_utf8(&name_bytes[..end]) {
            let trimmed = name.trim();
            if !trimmed.is_empty() {
                names.push(trimmed.to_string());
            }
        }
    }

    names
}

fn extract_mdl_animation_names(data: &[u8]) -> Vec<String> {
    let mut names = Vec::new();
    let Ok(text) = std::str::from_utf8(data) else {
        return names;
    };

    for line in text.lines() {
        let line = line.trim();
        if !line.starts_with("Anim ") {
            continue;
        }
        if let Some(start) = line.find('"') {
            if let Some(end_rel) = line[start + 1..].find('"') {
                let name = &line[start + 1..start + 1 + end_rel];
                let trimmed = name.trim();
                if !trimmed.is_empty() {
                    names.push(trimmed.to_string());
                }
            }
        }
    }

    names
}

fn dedupe_preserve_order(values: Vec<String>) -> Vec<String> {
    let mut seen = std::collections::HashSet::new();
    let mut deduped = Vec::new();

    for value in values {
        let key = value.to_lowercase();
        if seen.insert(key) {
            deduped.push(value);
        }
    }

    deduped
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
        let chunk_size = u32::from_le_bytes([
            data[pos + 4],
            data[pos + 5],
            data[pos + 6],
            data[pos + 7],
        ]) as usize;
        pos = pos.saturating_add(8 + chunk_size);
    }
    None
}

fn get_replaceable_texture_path(replaceable_id: i32) -> Option<&'static str> {
    match replaceable_id {
        1 => Some("TeamColor\\TeamColor00"),
        2 => Some("TeamGlow\\TeamGlow00"),
        11 => Some("Cliff\\Cliff0"),
        31 => Some("LordaeronTree\\LordaeronSummerTree"),
        32 => Some("AshenvaleTree\\AshenTree"),
        33 => Some("BarrensTree\\BarrensTree"),
        34 => Some("NorthrendTree\\NorthTree"),
        35 => Some("Mushroom\\MushroomTree"),
        36 => Some("RuinsTree\\RuinsTree"),
        37 => Some("OutlandMushroomTree\\MushroomTree"),
        _ => None,
    }
}

fn extract_mdl_texture_paths(text: &str) -> Vec<String> {
    let mut paths = Vec::new();
    let mut in_textures = false;
    let mut texture_depth = 0usize;
    for raw_line in text.lines() {
        let line = raw_line.trim();
        if line.starts_with("Textures ") {
            in_textures = true;
            texture_depth = texture_depth.saturating_add(line.matches('{').count());
            texture_depth = texture_depth.saturating_sub(line.matches('}').count());
            continue;
        }
        if !in_textures {
            continue;
        }

        texture_depth = texture_depth.saturating_add(line.matches('{').count());
        texture_depth = texture_depth.saturating_sub(line.matches('}').count());

        if line.starts_with("Bitmap ") {
        } else if line.starts_with("Image ") {
            if let Some(start) = line.find('"') {
                if let Some(end) = line.rfind('"') {
                    if end > start {
                        let path_str = &line[start + 1..end];
                        if !path_str.is_empty() {
                            paths.push(path_str.replace("\\", std::path::MAIN_SEPARATOR_STR));
                        }
                    }
                }
            }
        } else if line.starts_with("ReplaceableId") {
            let value = line
                .trim_start_matches("ReplaceableId")
                .trim()
                .trim_end_matches(',')
                .parse::<i32>()
                .unwrap_or(0);
            if let Some(replaceable_path) = get_replaceable_texture_path(value) {
                paths.push(format!(
                    "ReplaceableTextures{}{}.blp",
                    std::path::MAIN_SEPARATOR,
                    replaceable_path.replace("\\", std::path::MAIN_SEPARATOR_STR)
                ));
            }
        }

        if texture_depth == 0 {
            in_textures = false;
        }
    }

    paths
}

pub fn normalize_manifest_paths(paths: &[String], model_path: &Path) -> Vec<PathBuf> {
    let model_dir = match model_path.parent() {
        Some(dir) => dir,
        None => return Vec::new(),
    };

    paths.iter().map(|p| model_dir.join(p)).collect()
}
