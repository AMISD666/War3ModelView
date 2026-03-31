use std::collections::{HashMap, HashSet};
use std::fs;
use std::mem::size_of;
use std::path::{Path, PathBuf};
use std::ptr;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, SystemTime};
use wow_mpq::Archive;

use crate::app_settings;
use crate::model_manifest::extract_texture_paths;
use windows_sys::Win32::Foundation::POINT;
use windows_sys::Win32::Storage::FileSystem::CreateHardLinkW;
use windows_sys::Win32::System::DataExchange::{
    CloseClipboard, EmptyClipboard, OpenClipboard, RegisterClipboardFormatW, SetClipboardData,
};
use windows_sys::Win32::System::Memory::{GlobalAlloc, GlobalLock, GlobalUnlock, GMEM_MOVEABLE};

fn to_wide(path: &Path) -> Vec<u16> {
    use std::os::windows::ffi::OsStrExt;
    path.as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect()
}

fn try_hardlink(src: &Path, dst: &Path) -> bool {
    if dst.exists() {
        return true;
    }
    let wide_dst = to_wide(dst);
    let wide_src = to_wide(src);
    unsafe { CreateHardLinkW(wide_dst.as_ptr(), wide_src.as_ptr(), std::ptr::null()) != 0 }
}

pub fn cleanup_temp_root(temp_root: &Path) {
    let max_age = Duration::from_secs(10 * 60);
    let keep_latest = 2usize;
    let now = SystemTime::now();

    let entries = match fs::read_dir(temp_root) {
        Ok(v) => v,
        Err(_) => return,
    };

    let mut candidates: Vec<(PathBuf, SystemTime)> = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let name = match path.file_name().and_then(|n| n.to_str()) {
            Some(n) => n,
            None => continue,
        };
        if !name.starts_with("war3copy_") {
            continue;
        }
        let meta = match fs::metadata(&path) {
            Ok(m) => m,
            Err(_) => continue,
        };
        let ts = meta.modified().or_else(|_| meta.created());
        if let Ok(ts) = ts {
            candidates.push((path, ts));
        }
    }

    candidates.sort_by(|a, b| b.1.cmp(&a.1));
    for (idx, (path, ts)) in candidates.into_iter().enumerate() {
        if idx < keep_latest {
            continue;
        }
        if let Ok(age) = now.duration_since(ts) {
            if age > max_age {
                let _ = fs::remove_dir_all(path);
            }
        }
    }
}

pub fn copy_model_with_textures(model_path: &str, temp_root: &Path) -> Result<String, String> {
    let paths = vec![model_path.to_string()];
    let (message, _) = copy_models_with_textures(&paths, temp_root, false)?;
    Ok(message)
}

pub fn copy_models_with_textures(
    model_paths: &[String],
    temp_root: &Path,
    skip_mpq: bool,
) -> Result<(String, usize), String> {
    if model_paths.is_empty() {
        return Err("No model paths provided".to_string());
    }

    fs::create_dir_all(&temp_root).map_err(|e| format!("Failed to create temp dir: {}", e))?;
    cleanup_temp_root(temp_root);
    let temp_base = temp_root.join(format!("war3copy_{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(&temp_base).map_err(|e| format!("Failed to create temp dir: {}", e))?;
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

    let mut model_names: Vec<String> = Vec::new();
    let mut copy_jobs: Vec<(PathBuf, PathBuf, bool)> = Vec::new();
    let mut job_targets: HashSet<PathBuf> = HashSet::new();
    let mut texture_targets: HashSet<PathBuf> = HashSet::new();
    let texture_count = Arc::new(AtomicUsize::new(0));
    let mut resolve_cache: HashMap<String, Option<(PathBuf, String)>> = HashMap::new();
    let mut search_bases_cache: HashMap<PathBuf, Vec<PathBuf>> = HashMap::new();

    let ext_candidates = ["blp", "tga", "dds", "png", "BLP", "TGA", "DDS", "PNG"];

    let settings = app_settings::load_settings();
    let mut mpq_paths: Vec<String> = Vec::new();
    if !skip_mpq && settings.copy_mpq_textures && !settings.mpq_paths.is_empty() {
        mpq_paths = settings.mpq_paths;
    }
    let mut mpq_archives: Option<Vec<Archive>> = None;

    #[derive(Clone)]
    struct ModelInfo {
        path: PathBuf,
        dir: PathBuf,
        name: String,
        textures: Vec<String>,
    }

    let model_jobs: Vec<PathBuf> = model_paths
        .iter()
        .map(PathBuf::from)
        .filter(|p| p.exists())
        .collect();

    let model_results: Arc<Mutex<Vec<ModelInfo>>> = Arc::new(Mutex::new(Vec::new()));
    let model_queue = Arc::new(Mutex::new(model_jobs));

    let parse_workers = std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(4)
        .min(8)
        .max(2);

    let mut parsers = Vec::new();
    for _ in 0..parse_workers {
        let model_queue = Arc::clone(&model_queue);
        let model_results = Arc::clone(&model_results);
        parsers.push(thread::spawn(move || loop {
            let job = {
                let mut guard = model_queue.lock().unwrap();
                guard.pop()
            };
            let model_path = match job {
                Some(p) => p,
                None => break,
            };
            let model_dir = match model_path.parent() {
                Some(dir) => dir.to_path_buf(),
                None => continue,
            };
            let model_name = match model_path.file_name() {
                Some(name) => name.to_string_lossy().to_string(),
                None => continue,
            };
            let model_data = match fs::read(&model_path) {
                Ok(data) => data,
                Err(_) => continue,
            };
            let texture_paths = extract_texture_paths(&model_data, &model_path);
            let info = ModelInfo {
                path: model_path,
                dir: model_dir,
                name: model_name,
                textures: texture_paths,
            };
            model_results.lock().unwrap().push(info);
        }));
    }
    for worker in parsers {
        let _ = worker.join();
    }

    let model_infos = model_results.lock().unwrap().clone();
    for info in model_infos {
        println!(
            "[Copy] Found {} texture paths: {:?}",
            info.textures.len(),
            info.textures
        );

        model_names.push(info.name.clone());
        let temp_model_path = temp_base.join(&info.name);
        if job_targets.insert(temp_model_path.clone()) {
            copy_jobs.push((info.path.clone(), temp_model_path.clone(), false));
        }
        push_path(&temp_model_path);
        println!("[Copy] Copied model: {:?}", temp_model_path);

        for tex_rel_path in &info.textures {
            let cache_key = format!(
                "{}|{}",
                info.dir.to_string_lossy().to_lowercase(),
                tex_rel_path.to_lowercase()
            );
            let cached = resolve_cache.get(&cache_key).cloned();
            let mut source_found: Option<PathBuf> = None;
            let mut actual_rel_path = tex_rel_path.clone();

            if let Some(cached) = cached {
                if let Some((src, rel)) = cached {
                    source_found = Some(src);
                    actual_rel_path = rel;
                }
            } else {
                let search_bases = search_bases_cache
                    .entry(info.dir.to_path_buf())
                    .or_insert_with(|| {
                        let mut bases: Vec<PathBuf> = vec![info.dir.to_path_buf()];
                        let mut current = info.dir.as_path();
                        for _ in 0..3 {
                            if let Some(parent) = current.parent() {
                                bases.push(parent.to_path_buf());
                                current = parent;
                            } else {
                                break;
                            }
                        }
                        bases
                    })
                    .clone();

                let tex_filename = Path::new(tex_rel_path).file_name().unwrap_or_default();
                'search: for base in &search_bases {
                    for candidate in &[base.join(tex_rel_path), base.join(&tex_filename)] {
                        if candidate.exists() {
                            source_found = Some(candidate.clone());
                            break 'search;
                        }

                        let stem = candidate.with_extension("");
                        for ext in &ext_candidates {
                            let alt = stem.with_extension(ext);
                            if alt.exists() {
                                source_found = Some(alt);
                                let rel_stem = Path::new(tex_rel_path).with_extension("");
                                actual_rel_path =
                                    rel_stem.with_extension(ext).to_string_lossy().to_string();
                                break 'search;
                            }
                        }
                    }
                }

                if let Some(found) = source_found.as_ref() {
                    let mut rel_buf = PathBuf::from(tex_rel_path);
                    if let Some(found_ext) = found.extension().and_then(|e| e.to_str()) {
                        let rel_ext = rel_buf.extension().and_then(|e| e.to_str());
                        if rel_ext.is_none()
                            || !rel_ext
                                .map(|e| e.eq_ignore_ascii_case(found_ext))
                                .unwrap_or(false)
                        {
                            rel_buf.set_extension(found_ext);
                        }
                    }
                    actual_rel_path = rel_buf.to_string_lossy().to_string();
                }

                resolve_cache.insert(
                    cache_key,
                    source_found
                        .as_ref()
                        .map(|src| (src.clone(), actual_rel_path.clone())),
                );
            }

            if let Some(source) = source_found {
                let target_path = temp_base.join(&actual_rel_path);
                if let Some(parent) = target_path.parent() {
                    fs::create_dir_all(parent).ok();
                }

                if texture_targets.insert(target_path.clone()) {
                    if job_targets.insert(target_path.clone()) {
                        copy_jobs.push((source.clone(), target_path.clone(), true));
                    }
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
                    println!("[Copy] Copied texture: {:?} -> {:?}", source, target_path);
                }
            } else {
                let mut copied_from_mpq = false;
                if !mpq_paths.is_empty() {
                    let mpq_path = tex_rel_path.replace("/", "\\");
                    if mpq_archives.is_none() {
                        let mut opened: Vec<Archive> = Vec::new();
                        for path in &mpq_paths {
                            if let Ok(archive) = Archive::open(path) {
                                opened.push(archive);
                            }
                        }
                        mpq_archives = Some(opened);
                    }
                    let archives = mpq_archives.as_mut().unwrap();
                    for archive in archives.iter_mut().rev() {
                        if let Ok(data) = archive.read_file(&mpq_path) {
                            if data.len() > 50 * 1024 * 1024 {
                                continue;
                            }
                            let target_path = temp_base.join(&actual_rel_path);
                            if let Some(parent) = target_path.parent() {
                                fs::create_dir_all(parent).ok();
                            }
                            if texture_targets.insert(target_path.clone()) {
                                if fs::write(&target_path, &data).is_ok() {
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
                                    texture_count.fetch_add(1, Ordering::Relaxed);
                                    copied_from_mpq = true;
                                    println!("[Copy] Copied texture from MPQ: {:?}", target_path);
                                }
                            }
                            break;
                        }
                    }
                }
                if !copied_from_mpq {
                    println!("[Copy] Texture not found: {:?}", tex_rel_path);
                }
            }
        }
    }

    if files_to_copy.is_empty() {
        return Err("No models copied".to_string());
    }

    let worker_count = std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(4)
        .min(8)
        .max(2);
    let jobs = Arc::new(Mutex::new(copy_jobs));

    let mut workers = Vec::new();
    for _ in 0..worker_count {
        let jobs = Arc::clone(&jobs);
        let texture_count = Arc::clone(&texture_count);
        workers.push(thread::spawn(move || loop {
            let job = {
                let mut guard = jobs.lock().unwrap();
                guard.pop()
            };
            match job {
                Some((src, dst, is_texture)) => {
                    if let Some(parent) = dst.parent() {
                        let _ = fs::create_dir_all(parent);
                    }
                    let linked = try_hardlink(&src, &dst);
                    if !linked {
                        let _ = fs::copy(&src, &dst);
                    }
                    if is_texture {
                        texture_count.fetch_add(1, Ordering::Relaxed);
                    }
                }
                None => break,
            }
        }));
    }
    for worker in workers {
        let _ = worker.join();
    }

    set_file_list_with_preferred_drop_effect(&files_to_copy)?;
    println!("[Copy] Clipboard items: {}", files_to_copy.len());

    let total_textures = texture_count.load(Ordering::Relaxed);
    let message = if model_names.len() == 1 {
        format!("已复制 {} ({} 个贴图)", model_names[0], total_textures)
    } else {
        format!(
            "已复制 {} 个模型 ({} 个贴图)",
            model_names.len(),
            total_textures
        )
    };
    Ok((message, files_to_copy.len()))
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
