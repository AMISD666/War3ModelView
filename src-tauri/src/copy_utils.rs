use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::mem::size_of;
use std::ptr;
use windows_sys::Win32::Foundation::POINT;
use windows_sys::Win32::System::DataExchange::{
    CloseClipboard, EmptyClipboard, OpenClipboard, RegisterClipboardFormatW, SetClipboardData,
};
use windows_sys::Win32::System::Memory::{GlobalAlloc, GlobalLock, GlobalUnlock, GMEM_MOVEABLE};

pub fn copy_model_with_textures(model_path: &str, temp_root: &Path) -> Result<String, String> {
    let model_path_obj = Path::new(model_path);
    if !model_path_obj.exists() {
        return Err(format!("Model file not found: {:?}", model_path_obj));
    }

    let model_dir = model_path_obj.parent().ok_or("Invalid model path")?;
    let model_name = model_path_obj
        .file_name()
        .ok_or("Invalid model filename")?;

    let model_data =
        fs::read(&model_path_obj).map_err(|e| format!("Failed to read model: {}", e))?;

    let texture_paths = extract_texture_paths(&model_data, model_path_obj);
    println!(
        "[Copy] Found {} texture paths: {:?}",
        texture_paths.len(),
        texture_paths
    );

    fs::create_dir_all(&temp_root)
        .map_err(|e| format!("Failed to create temp dir: {}", e))?;
    let temp_base = temp_root.join(format!("war3copy_{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(&temp_base)
        .map_err(|e| format!("Failed to create temp dir: {}", e))?;
    println!("[Copy] Temp dir: {:?}", temp_base);

    let mut files_to_copy: Vec<String> = Vec::new();
    let mut items_seen: HashSet<String> = HashSet::new();
    let mut push_item = |path: String| {
        if items_seen.insert(path.clone()) {
            files_to_copy.push(path);
        }
    };

    let normalize_clip_path = |path: &Path| {
        let canonical = std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
        let s = canonical.to_string_lossy();
        if s.starts_with("\\\\?\\") {
            PathBuf::from(&s[4..])
        } else {
            canonical
        }
    };

    let mut push_path = |path: &Path| {
        let normalized = normalize_clip_path(path);
        push_item(normalized.to_string_lossy().to_string());
    };

    let mut found_textures = 0;

    let temp_model_path = temp_base.join(model_name);
    fs::copy(&model_path_obj, &temp_model_path)
        .map_err(|e| format!("Failed to copy model: {}", e))?;
    push_path(&temp_model_path);
    println!("[Copy] Copied model: {:?}", temp_model_path);

    for tex_rel_path in &texture_paths {
        let tex_filename = Path::new(tex_rel_path).file_name().unwrap_or_default();

        let mut source_found: Option<PathBuf> = None;
        let mut actual_rel_path = tex_rel_path.clone();

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

        'search: for base in &search_bases {
            for candidate in &[base.join(tex_rel_path), base.join(tex_filename)] {
                if candidate.exists() {
                    source_found = Some(candidate.clone());
                    break 'search;
                }

                let stem = candidate.with_extension("");
                for ext in &["blp", "tga", "dds", "png", "BLP", "TGA", "DDS", "PNG"] {
                    let alt = stem.with_extension(ext);
                    if alt.exists() {
                        source_found = Some(alt);
                        let rel_stem = Path::new(tex_rel_path).with_extension("");
                        actual_rel_path = rel_stem.with_extension(ext).to_string_lossy().to_string();
                        break 'search;
                    }
                }
            }
        }

        if let Some(source) = source_found {
            let target_path = temp_base.join(&actual_rel_path);
            if let Some(parent) = target_path.parent() {
                fs::create_dir_all(parent).ok();
            }

            if fs::copy(&source, &target_path).is_ok() {
                let rel_path = Path::new(&actual_rel_path);
                let mut top_component: Option<PathBuf> = None;
                for comp in rel_path.components() {
                    if let std::path::Component::Normal(name) = comp {
                        top_component = Some(PathBuf::from(name));
                        break;
                    }
                }
                if let Some(top) = top_component {
                    let top_dir = temp_base.join(top);
                    if top_dir != temp_base && top_dir.is_dir() {
                        push_path(&top_dir);
                    } else {
                        push_path(&target_path);
                    }
                } else {
                    push_path(&target_path);
                }
                found_textures += 1;
                println!("[Copy] Copied texture: {:?} -> {:?}", source, target_path);
            }
        } else {
            println!("[Copy] Texture not found: {:?}", tex_rel_path);
        }
    }

    set_file_list_with_preferred_drop_effect(&files_to_copy)?;

    println!("[Copy] Clipboard items: {}", files_to_copy.len());

    let model_name_str = model_path_obj
        .file_name()
        .unwrap_or_default()
        .to_string_lossy();
    Ok(format!(
        "Copied {} ({} textures)",
        model_name_str, found_textures
    ))
}

#[repr(C)]
struct DropFiles {
    p_files: u32,
    pt: POINT,
    f_nc: i32,
    f_wide: i32,
}

fn set_file_list_with_preferred_drop_effect(paths: &[String]) -> Result<(), String> {
    unsafe {
        if OpenClipboard(0) == 0 {
            return Err("OpenClipboard failed".to_string());
        }

        if EmptyClipboard() == 0 {
            CloseClipboard();
            return Err("EmptyClipboard failed".to_string());
        }

        let mut wide_list: Vec<u16> = Vec::new();
        for path in paths {
            wide_list.extend(path.encode_utf16());
            wide_list.push(0);
        }
        wide_list.push(0);

        let dropfiles = DropFiles {
            p_files: size_of::<DropFiles>() as u32,
            pt: POINT { x: 0, y: 0 },
            f_nc: 0,
            f_wide: 1,
        };

        let mem_size = size_of::<DropFiles>() + wide_list.len() * 2;
        let hmem = GlobalAlloc(GMEM_MOVEABLE, mem_size);
        if hmem.is_null() {
            CloseClipboard();
            return Err("GlobalAlloc failed".to_string());
        }

        let ptr_base = GlobalLock(hmem) as *mut u8;
        if ptr_base.is_null() {
            CloseClipboard();
            return Err("GlobalLock failed".to_string());
        }

        ptr::copy_nonoverlapping(
            &dropfiles as *const DropFiles as *const u8,
            ptr_base,
            size_of::<DropFiles>(),
        );
        let list_ptr = ptr_base.add(size_of::<DropFiles>()) as *mut u16;
        ptr::copy_nonoverlapping(wide_list.as_ptr(), list_ptr, wide_list.len());
        GlobalUnlock(hmem);

        if SetClipboardData(15u32, hmem as isize) == 0 {
            CloseClipboard();
            return Err("SetClipboardData CF_HDROP failed".to_string());
        }

        let mut wide: Vec<u16> = "Preferred DropEffect".encode_utf16().collect();
        wide.push(0);
        let format = RegisterClipboardFormatW(wide.as_ptr());
        if format == 0 {
            CloseClipboard();
            return Err("RegisterClipboardFormatW failed".to_string());
        }

        let hmem_effect = GlobalAlloc(GMEM_MOVEABLE, 4);
        if hmem_effect.is_null() {
            CloseClipboard();
            return Err("GlobalAlloc failed".to_string());
        }

        let ptr_effect = GlobalLock(hmem_effect) as *mut u32;
        if ptr_effect.is_null() {
            CloseClipboard();
            return Err("GlobalLock failed".to_string());
        }

        *ptr_effect = 1;
        GlobalUnlock(hmem_effect);

        if SetClipboardData(format, hmem_effect as isize) == 0 {
            CloseClipboard();
            return Err("SetClipboardData Preferred DropEffect failed".to_string());
        }

        CloseClipboard();
        Ok(())
    }
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
