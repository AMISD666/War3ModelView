#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod activation;
mod app_paths;
mod app_settings;
mod copy_utils;
mod delete_utils;
mod mpq_manager;
mod texture_decode;
mod texture_encode;

use base64::Engine;
use mpq_manager::MpqManager;
use rayon::prelude::*;
use serde::Serialize;
use std::collections::{HashMap, VecDeque};
use std::sync::{Arc, Mutex};
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{ipc::Response, Emitter, Manager, State};
use texture_decode::{decode_texture_bytes_with_max_dimension, get_texture_candidate_paths, normalize_path};
use texture_encode::encode_texture_image;

use winreg::enums::*;
use winreg::RegKey;

static DEBUG_CONSOLE_ENABLED: AtomicBool = AtomicBool::new(false);
static CLI_ARGS_CONSUMED: AtomicBool = AtomicBool::new(false);
static PENDING_FILES: once_cell::sync::Lazy<std::sync::Mutex<Vec<String>>> =
    once_cell::sync::Lazy::new(|| std::sync::Mutex::new(Vec::new()));

const TEXTURE_PATH_CACHE_LIMIT: usize = 8192;
const TEXTURE_RESULT_CACHE_LIMIT: usize = 1024;
const TEXTURE_RESULT_CACHE_MAX_BYTES: usize = 192 * 1024 * 1024;
const TEXTURE_RESULT_CACHE_MAX_ENTRY_BYTES: usize = 8 * 1024 * 1024;
const TEXTURE_RGBA_CACHE_LIMIT: usize = 2048;
const TEXTURE_RGBA_CACHE_MAX_BYTES: usize = 192 * 1024 * 1024;
const TEXTURE_RGBA_CACHE_MAX_ENTRY_BYTES: usize = 2 * 1024 * 1024;

#[derive(Clone)]
struct CachedRgbaImage {
    width: u32,
    height: u32,
    data: Arc<Vec<u8>>,
}

#[derive(Default)]
struct TextureBatchCacheInner {
    // key: "{normalized_model_path_lower}|{normalized_texture_path_lower}"
    // value: Some(resolved fs file path) or None (fs path miss)
    path_hits: HashMap<String, Option<String>>,
    path_lru: VecDeque<String>,

    // key: "fs:{path_lower}" / "mpq:{path_lower}"
    result_bytes: HashMap<String, Arc<Vec<u8>>>,
    result_lru: VecDeque<String>,
    result_total_bytes: usize,

    // key: "{source_key}|{max_dimension}" where source_key is "fs:{path_lower}" / "mpq:{path_lower}"
    rgba_images: HashMap<String, Arc<CachedRgbaImage>>,
    rgba_lru: VecDeque<String>,
    rgba_total_bytes: usize,
}

struct TextureBatchCache {
    inner: Mutex<TextureBatchCacheInner>,
}

impl TextureBatchCache {
    fn new() -> Self {
        Self {
            inner: Mutex::new(TextureBatchCacheInner::default()),
        }
    }

    fn touch_lru(order: &mut VecDeque<String>, key: &str) {
        if let Some(pos) = order.iter().position(|k| k == key) {
            order.remove(pos);
        }
        order.push_back(key.to_string());
    }

    fn get_path_hit(&self, key: &str) -> Option<Option<String>> {
        let mut guard = self.inner.lock().unwrap();
        let value = guard.path_hits.get(key).cloned();
        if value.is_some() {
            Self::touch_lru(&mut guard.path_lru, key);
        }
        value
    }

    fn put_path_hit(&self, key: String, value: Option<String>) {
        let mut guard = self.inner.lock().unwrap();
        guard.path_hits.insert(key.clone(), value);
        Self::touch_lru(&mut guard.path_lru, &key);

        while guard.path_hits.len() > TEXTURE_PATH_CACHE_LIMIT {
            let old_key = match guard.path_lru.pop_front() {
                Some(k) => k,
                None => break,
            };
            guard.path_hits.remove(&old_key);
        }
    }

    fn invalidate_path_hit(&self, key: &str) {
        let mut guard = self.inner.lock().unwrap();
        guard.path_hits.remove(key);
        if let Some(pos) = guard.path_lru.iter().position(|k| k == key) {
            guard.path_lru.remove(pos);
        }
    }

    fn get_result_bytes(&self, key: &str) -> Option<Arc<Vec<u8>>> {
        let mut guard = self.inner.lock().unwrap();
        let value = guard.result_bytes.get(key).cloned();
        if value.is_some() {
            Self::touch_lru(&mut guard.result_lru, key);
        }
        value
    }

    fn put_result_bytes(&self, key: String, bytes: Arc<Vec<u8>>) {
        // Avoid very large single-entry cache pollution.
        if bytes.len() > TEXTURE_RESULT_CACHE_MAX_ENTRY_BYTES {
            return;
        }

        let mut guard = self.inner.lock().unwrap();
        if let Some(old) = guard.result_bytes.remove(&key) {
            guard.result_total_bytes = guard.result_total_bytes.saturating_sub(old.len());
        }
        guard.result_total_bytes = guard.result_total_bytes.saturating_add(bytes.len());
        guard.result_bytes.insert(key.clone(), bytes);
        Self::touch_lru(&mut guard.result_lru, &key);

        while guard.result_bytes.len() > TEXTURE_RESULT_CACHE_LIMIT
            || guard.result_total_bytes > TEXTURE_RESULT_CACHE_MAX_BYTES
        {
            let old_key = match guard.result_lru.pop_front() {
                Some(k) => k,
                None => break,
            };
            if let Some(old) = guard.result_bytes.remove(&old_key) {
                guard.result_total_bytes = guard.result_total_bytes.saturating_sub(old.len());
            }
        }
    }

    fn get_rgba_image(&self, key: &str) -> Option<Arc<CachedRgbaImage>> {
        let mut guard = self.inner.lock().unwrap();
        let value = guard.rgba_images.get(key).cloned();
        if value.is_some() {
            Self::touch_lru(&mut guard.rgba_lru, key);
        }
        value
    }

    fn put_rgba_image(&self, key: String, image: Arc<CachedRgbaImage>) {
        let entry_bytes = image.data.len();
        if entry_bytes > TEXTURE_RGBA_CACHE_MAX_ENTRY_BYTES {
            return;
        }

        let mut guard = self.inner.lock().unwrap();
        if let Some(old) = guard.rgba_images.remove(&key) {
            guard.rgba_total_bytes = guard.rgba_total_bytes.saturating_sub(old.data.len());
        }
        guard.rgba_total_bytes = guard.rgba_total_bytes.saturating_add(entry_bytes);
        guard.rgba_images.insert(key.clone(), image);
        Self::touch_lru(&mut guard.rgba_lru, &key);

        while guard.rgba_images.len() > TEXTURE_RGBA_CACHE_LIMIT
            || guard.rgba_total_bytes > TEXTURE_RGBA_CACHE_MAX_BYTES
        {
            let old_key = match guard.rgba_lru.pop_front() {
                Some(k) => k,
                None => break,
            };
            if let Some(old) = guard.rgba_images.remove(&old_key) {
                guard.rgba_total_bytes = guard.rgba_total_bytes.saturating_sub(old.data.len());
            }
        }
    }
}

#[tauri::command]
fn detect_warcraft_path() -> Result<String, String> {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let path = std::path::Path::new("SOFTWARE")
        .join("Blizzard Entertainment")
        .join("Warcraft III");

    // Try to open the key
    let key = match hkcu.open_subkey(&path) {
        Ok(k) => k,
        Err(_) => return Err("Registry key not found".to_string()),
    };

    // Try to read the value
    let install_path: String = match key.get_value("InstallPath") {
        Ok(p) => p,
        Err(_) => return Err("InstallPath value not found".to_string()),
    };

    Ok(install_path)
}

#[tauri::command]
fn toggle_console(show: bool) {
    DEBUG_CONSOLE_ENABLED.store(show, Ordering::Relaxed);
    #[cfg(windows)]
    unsafe {
        use windows_sys::Win32::System::Console::{AllocConsole, FreeConsole};
        if show {
            AllocConsole();
        } else {
            FreeConsole();
        }
    }
}

#[tauri::command]
fn debug_log(message: String) {
    if !DEBUG_CONSOLE_ENABLED.load(Ordering::Relaxed) {
        return;
    }
    println!("{}", message);
}

#[tauri::command]
fn load_mpq(path: String, state: State<MpqManager>) -> Result<String, String> {
    state.add_archive(&path)
}

#[tauri::command]
fn read_mpq_file(path: String, state: State<'_, MpqManager>) -> Result<Response, String> {
    match state.read_file(&path) {
        Some(data) => Ok(Response::new(data)),
        None => Err(format!("File not found in MPQs: {}", path)),
    }
}

#[tauri::command]
fn read_mpq_files_batch(paths: Vec<String>, state: State<'_, MpqManager>) -> Vec<Option<String>> {
    state
        .read_files_batch(&paths)
        .into_iter()
        .map(|opt| opt.map(|data| base64::engine::general_purpose::STANDARD.encode(data)))
        .collect()
}

#[tauri::command]
fn get_loaded_mpq_paths(state: State<'_, MpqManager>) -> Vec<String> {
    state.archive_paths()
}

#[tauri::command]
fn list_mpq_files(mpq_path: String, state: State<'_, MpqManager>) -> Result<Vec<String>, String> {
    state.list_files_for_archive(&mpq_path)
}

#[tauri::command]
fn set_mpq_priority(mpq_path: String, state: State<'_, MpqManager>) -> Result<(), String> {
    state.prioritize_archive(&mpq_path)
}

#[derive(Serialize)]
struct MpqProbeResult {
    input: String,
    normalized: String,
    candidates: Vec<String>,
    archive_count: usize,
    archive_paths: Vec<String>,
    found: bool,
    size: Option<usize>,
}

#[tauri::command]
fn debug_mpq_probe(path: String, state: State<'_, MpqManager>) -> Result<MpqProbeResult, String> {
    let (normalized, candidates, size, archive_count) = state.probe_file(&path);
    Ok(MpqProbeResult {
        input: path,
        normalized,
        candidates,
        archive_count,
        archive_paths: state.archive_paths(),
        found: size.is_some(),
        size,
    })
}

#[tauri::command]
fn read_local_files_batch(paths: Vec<String>) -> Vec<Option<String>> {
    paths
        .iter()
        .map(|path| {
            std::fs::read(path)
                .ok()
                .map(|data| base64::engine::general_purpose::STANDARD.encode(data))
        })
        .collect()
}

fn load_texture_bytes_with_source_key(
    normalized_model_path: &str,
    normalized_model_path_lc: &str,
    normalized_texture_path: &str,
    normalized_texture_path_lc: &str,
    skip_fs: bool,
    state: &MpqManager,
    cache: &TextureBatchCache,
) -> Option<(Arc<Vec<u8>>, String)> {
    let path_cache_key = format!(
        "{}|{}",
        normalized_model_path_lc,
        normalized_texture_path_lc
    );

    if !skip_fs {
        let mut cached_fs_path = cache.get_path_hit(&path_cache_key).unwrap_or(None);

        if let Some(fs_path) = cached_fs_path.clone() {
            let fs_key = format!("fs:{}", fs_path.to_lowercase());
            if let Some(bytes) = cache.get_result_bytes(&fs_key) {
                return Some((bytes, fs_key));
            } else if let Ok(bytes) = std::fs::read(&fs_path) {
                if bytes.len() <= 50 * 1024 * 1024 {
                    let bytes_arc = Arc::new(bytes);
                    cache.put_result_bytes(fs_key.clone(), bytes_arc.clone());
                    return Some((bytes_arc, fs_key));
                }
            } else {
                // Cached path became stale, force re-probe.
                cache.invalidate_path_hit(&path_cache_key);
                cached_fs_path = None;
            }
        }

        if cached_fs_path.is_none() {
            let candidates = get_texture_candidate_paths(normalized_model_path, normalized_texture_path);
            let mut resolved_fs_path: Option<String> = None;
            for candidate in candidates {
                if let Ok(bytes) = std::fs::read(&candidate) {
                    if bytes.len() <= 50 * 1024 * 1024 {
                        let fs_key = format!("fs:{}", candidate.to_lowercase());
                        let bytes_arc = Arc::new(bytes);
                        cache.put_result_bytes(fs_key.clone(), bytes_arc.clone());
                        resolved_fs_path = Some(candidate);
                        cache.put_path_hit(path_cache_key.clone(), resolved_fs_path);
                        return Some((bytes_arc, fs_key));
                    }
                }
            }
            cache.put_path_hit(path_cache_key.clone(), resolved_fs_path);
        }
    }

    let mpq_key = format!("mpq:{}", normalized_texture_path_lc);
    if let Some(bytes) = cache.get_result_bytes(&mpq_key) {
        return Some((bytes, mpq_key));
    }
    if let Some(bytes) = state.read_file(normalized_texture_path) {
        let bytes_arc = Arc::new(bytes);
        cache.put_result_bytes(mpq_key.clone(), bytes_arc.clone());
        return Some((bytes_arc, mpq_key));
    }

    None
}

#[tauri::command]
fn load_textures_batch_bin(
    model_path: String,
    texture_paths: Vec<String>,
    state: State<'_, MpqManager>,
    cache: State<'_, TextureBatchCache>,
) -> Result<Response, String> {
    let mut payload: Vec<u8> = Vec::new();
    payload.extend_from_slice(&(texture_paths.len() as u32).to_le_bytes());

    let normalized_model_path = normalize_path(&model_path);
    let normalized_model_path_lc = normalized_model_path.to_lowercase();
    let skip_fs = normalized_model_path.starts_with("dropped:") || normalized_model_path.is_empty();

    let resolved_bytes: Vec<Option<Arc<Vec<u8>>>> = texture_paths
        .par_iter()
        .map(|texture_path| {
            let normalized_texture_path = normalize_path(texture_path);
            let normalized_texture_path_lc = normalized_texture_path.to_lowercase();
            load_texture_bytes_with_source_key(
                &normalized_model_path,
                &normalized_model_path_lc,
                &normalized_texture_path,
                &normalized_texture_path_lc,
                skip_fs,
                &state,
                &cache,
            )
            .map(|(bytes, _source_key)| bytes)
        })
        .collect();

    for maybe_bytes in resolved_bytes {
        if let Some(bytes) = maybe_bytes {
            if bytes.len() <= 50 * 1024 * 1024 {
                payload.push(1u8);
                payload.extend_from_slice(&(bytes.len() as u32).to_le_bytes());
                payload.extend_from_slice(bytes.as_slice());
            } else {
                payload.push(0u8);
                payload.extend_from_slice(&0u32.to_le_bytes());
            }
        } else {
            payload.push(0u8);
            payload.extend_from_slice(&0u32.to_le_bytes());
        }
    }

    Ok(Response::new(payload))
}

#[tauri::command]
fn clear_texture_batch_cache(cache: State<'_, TextureBatchCache>) {
    let mut guard = cache.inner.lock().unwrap();
    guard.path_hits.clear();
    guard.path_lru.clear();
    
    guard.result_bytes.clear();
    guard.result_lru.clear();
    guard.result_total_bytes = 0;
    
    guard.rgba_images.clear();
    guard.rgba_lru.clear();
    guard.rgba_total_bytes = 0;
}

#[tauri::command]
fn load_textures_batch_thumb_rgba(
    model_path: String,
    texture_paths: Vec<String>,
    max_dimension: Option<u32>,
    state: State<'_, MpqManager>,
    cache: State<'_, TextureBatchCache>,
) -> Result<Response, String> {
    let mut payload: Vec<u8> = Vec::new();
    let texture_count = texture_paths.len();
    payload.extend_from_slice(&(texture_count as u32).to_le_bytes());

    let normalized_model_path = normalize_path(&model_path);
    let normalized_model_path_lc = normalized_model_path.to_lowercase();
    let skip_fs = normalized_model_path.starts_with("dropped:") || normalized_model_path.is_empty();
    let decode_max_dimension = max_dimension.unwrap_or(224).clamp(64, 512);

    let mut decoded_images: Vec<Option<Arc<CachedRgbaImage>>> = vec![None; texture_count];
    let mut decode_jobs: Vec<(usize, Arc<Vec<u8>>, String, String)> = Vec::new();

    for (index, texture_path) in texture_paths.iter().enumerate() {
        let normalized_texture_path = normalize_path(&texture_path);
        let normalized_texture_path_lc = normalized_texture_path.to_lowercase();
        if let Some((bytes, source_key)) = load_texture_bytes_with_source_key(
            &normalized_model_path,
            &normalized_model_path_lc,
            &normalized_texture_path,
            &normalized_texture_path_lc,
            skip_fs,
            &state,
            &cache,
        ) {
            let decode_key = format!("{}|{}", source_key, decode_max_dimension);
            if let Some(cached) = cache.get_rgba_image(&decode_key) {
                decoded_images[index] = Some(cached);
            } else {
                decode_jobs.push((index, bytes, normalized_texture_path, decode_key));
            }
        }
    }

    let decoded_results: Vec<(usize, String, Option<Arc<CachedRgbaImage>>)> = decode_jobs
        .into_par_iter()
        .map(|(index, bytes, normalized_texture_path, decode_key)| {
            let decoded_image = decode_texture_bytes_with_max_dimension(
                bytes.as_slice(),
                &normalized_texture_path,
                Some(decode_max_dimension),
            )
            .ok()
            .and_then(|decoded| {
                let expected_len = (decoded.width as usize)
                    .saturating_mul(decoded.height as usize)
                    .saturating_mul(4);
                if decoded.width > 0
                    && decoded.height > 0
                    && decoded.data.len() == expected_len
                    && decoded.data.len() <= 50 * 1024 * 1024
                {
                    Some(Arc::new(CachedRgbaImage {
                        width: decoded.width,
                        height: decoded.height,
                        data: Arc::new(decoded.data),
                    }))
                } else {
                    None
                }
            });
            (index, decode_key, decoded_image)
        })
        .collect();

    for (index, decode_key, decoded_image) in decoded_results {
        if let Some(image) = decoded_image {
            cache.put_rgba_image(decode_key, image.clone());
            decoded_images[index] = Some(image);
        }
    }

    for decoded_image in decoded_images {
        if let Some(image) = decoded_image {
            let data_len = image.data.len();
            if data_len <= 50 * 1024 * 1024 && data_len <= u32::MAX as usize {
                payload.push(1u8);
                payload.extend_from_slice(&image.width.to_le_bytes());
                payload.extend_from_slice(&image.height.to_le_bytes());
                payload.extend_from_slice(&(data_len as u32).to_le_bytes());
                payload.extend_from_slice(image.data.as_slice());
            } else {
                payload.push(0u8);
                payload.extend_from_slice(&0u32.to_le_bytes());
                payload.extend_from_slice(&0u32.to_le_bytes());
                payload.extend_from_slice(&0u32.to_le_bytes());
            }
        } else {
            payload.push(0u8);
            payload.extend_from_slice(&0u32.to_le_bytes());
            payload.extend_from_slice(&0u32.to_le_bytes());
            payload.extend_from_slice(&0u32.to_le_bytes());
        }
    }

    Ok(Response::new(payload))
}

// ==================
// Activation Commands
// ==================
#[tauri::command]
fn get_machine_id() -> Result<String, String> {
    activation::get_machine_id()
}

#[tauri::command]
fn get_activation_status() -> activation::ActivationStatus {
    activation::get_activation_status()
}

#[tauri::command]
fn activate_software(license_code: String) -> Result<activation::ActivationStatus, String> {
    activation::activate_software(&license_code)
}

#[tauri::command]
async fn open_qq_verification_window(app: tauri::AppHandle) -> Result<(), String> {
    let label = "qq_verification";

    // If an old window exists, destroy it (not close — destroy is synchronous and
    // immediately frees the label so we can re-create without a race condition).
    if let Some(window) = app.get_webview_window(label) {
        let _ = window.destroy();
        // Small yield to let the event loop clean up.
        std::thread::sleep(std::time::Duration::from_millis(200));
    }

    // Keep the same entry URL as the known-working implementation.
    let url = "https://xui.ptlogin2.qq.com/cgi-bin/xlogin?pt_disable_pwd=1&appid=715030901&daid=73&hide_close_icon=1&pt_no_auth=1&s_url=https%3A%2F%2Fqun.qq.com%2Fmember.html%23";
    let script = format!(
        r##"
        (function() {{
            const targetId = "{0}";
            const successHash = "#verified_ok_{0}";
            setInterval(() => {{
                try {{
                    const html = document.documentElement ? document.documentElement.innerHTML : "";
                    if (!html) return;
                    if (html.includes(targetId) || html.includes('data-id="' + targetId + '"')) {{
                        if (window.location.hash !== successHash) {{
                            window.location.hash = successHash;
                        }}
                    }}
                }} catch (_) {{}}
            }}, 1000);
        }})();
        "##,
        activation::QQ_TARGET_GROUP_ID
    );

    let external_url =
        tauri::WebviewUrl::External(tauri::Url::parse(url).map_err(|e| e.to_string())?);
    tauri::WebviewWindowBuilder::new(&app, label, external_url)
        .title("QQ群成员验证")
        .inner_size(1024.0, 768.0)
        .resizable(true)
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36")
        .initialization_script(&script)
        .build()
        .map_err(|e| format!("打开QQ群验证窗口失败: {}", e))?;

    Ok(())
}

#[tauri::command]
fn check_qq_verification_window_status(app: tauri::AppHandle) -> Result<bool, String> {
    let success_flag = format!("verified_ok_{}", activation::QQ_TARGET_GROUP_ID);
    if let Some(window) = app.get_webview_window("qq_verification") {
        let current_url = window.url().map_err(|e| e.to_string())?.to_string();
        if current_url.contains(&success_flag) {
            activation::save_qq_verification_now()?;
            let _ = window.destroy();
            return Ok(true);
        }
    }
    Ok(false)
}

#[tauri::command]
fn close_qq_verification_window(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("qq_verification") {
        let _ = window.destroy();
    }
    Ok(())
}

#[tauri::command]
fn get_cli_copy_path() -> Option<String> {
    let args: Vec<String> = std::env::args().collect();
    let mut has_copy_flag = false;
    for arg in &args {
        if arg == "--copy-model" {
            has_copy_flag = true;
            break;
        }
    }
    if !has_copy_flag {
        return None;
    }
    for arg in args.iter().skip(1) {
        let lower = arg.to_lowercase();
        if lower.ends_with(".mdx") || lower.ends_with(".mdl") {
            return Some(arg.clone());
        }
    }
    None
}

#[tauri::command]
fn get_cli_delete_path() -> Option<String> {
    let args: Vec<String> = std::env::args().collect();
    let mut has_delete_flag = false;
    for arg in &args {
        if arg == "--delete-model" {
            has_delete_flag = true;
            break;
        }
    }
    if !has_delete_flag {
        return None;
    }
    for arg in args.iter().skip(1) {
        let lower = arg.to_lowercase();
        if lower.ends_with(".mdx") || lower.ends_with(".mdl") {
            return Some(arg.clone());
        }
    }
    None
}

fn get_cli_delete_paths() -> Option<Vec<String>> {
    let args: Vec<String> = std::env::args().collect();
    if !args.iter().any(|a| a == "--delete-model") {
        return None;
    }
    let mut paths: Vec<String> = args
        .iter()
        .skip(1)
        .filter(|arg| {
            let lower = arg.to_lowercase();
            lower.ends_with(".mdx") || lower.ends_with(".mdl")
        })
        .cloned()
        .collect();

    if paths.is_empty() {
        let raw = args.iter().skip(1).cloned().collect::<Vec<_>>().join(" ");
        let mut in_quotes = false;
        let mut current = String::new();
        let push_if_model = |s: &str, out: &mut Vec<String>| {
            let trimmed = s.trim().trim_matches('"');
            let lower = trimmed.to_lowercase();
            if lower.ends_with(".mdx") || lower.ends_with(".mdl") {
                out.push(trimmed.to_string());
            }
        };
        for ch in raw.chars() {
            if ch == '"' {
                if in_quotes {
                    push_if_model(&current, &mut paths);
                    current.clear();
                    in_quotes = false;
                } else {
                    in_quotes = true;
                }
                continue;
            }
            if in_quotes {
                current.push(ch);
            }
        }
        if paths.is_empty() {
            for token in raw.split_whitespace() {
                push_if_model(token, &mut paths);
            }
        }
    }

    Some(paths)
}

fn get_cli_copy_paths() -> Option<Vec<String>> {
    let args: Vec<String> = std::env::args().collect();
    if !args.iter().any(|a| a == "--copy-model") {
        return None;
    }
    let mut paths: Vec<String> = args
        .iter()
        .skip(1)
        .filter(|arg| {
            let lower = arg.to_lowercase();
            lower.ends_with(".mdx") || lower.ends_with(".mdl")
        })
        .cloned()
        .collect();

    if paths.is_empty() {
        let raw = args.iter().skip(1).cloned().collect::<Vec<_>>().join(" ");
        let mut in_quotes = false;
        let mut current = String::new();
        let push_if_model = |s: &str, out: &mut Vec<String>| {
            let trimmed = s.trim().trim_matches('"');
            let lower = trimmed.to_lowercase();
            if lower.ends_with(".mdx") || lower.ends_with(".mdl") {
                out.push(trimmed.to_string());
            }
        };
        for ch in raw.chars() {
            if ch == '"' {
                if in_quotes {
                    push_if_model(&current, &mut paths);
                    current.clear();
                    in_quotes = false;
                } else {
                    in_quotes = true;
                }
                continue;
            }
            if in_quotes {
                current.push(ch);
            }
        }
        if paths.is_empty() {
            for token in raw.split_whitespace() {
                push_if_model(token, &mut paths);
            }
        }
    }

    Some(paths)
}

// ==================
// Context Menu Commands
// ==================
#[tauri::command]
fn register_context_menu() -> Result<bool, String> {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let mut exe_path = std::env::current_exe()
        .map_err(|e| e.to_string())?
        .to_string_lossy()
        .to_string();

    // Fix: Remove UNC prefix if present, as it can confuse registry commands
    if exe_path.starts_with("\\\\?\\") {
        exe_path = exe_path[4..].to_string();
    }

    let extensions = ["mdx", "mdl"];

    // Clean up old key name if it exists to avoid confusion
    for ext in &extensions {
        let old_shell_path = format!(
            "Software\\Classes\\SystemFileAssociations\\.{}\\shell\\GGwar3Edit",
            ext
        );
        let _ = hkcu.delete_subkey_all(&old_shell_path);
    }

    for ext in &extensions {
        // Use a new, unique key name "GGWar3View"
        let shell_path = format!(
            "Software\\Classes\\SystemFileAssociations\\.{}\\shell\\GGWar3View",
            ext
        );
        let command_path = format!("{}\\command", shell_path);

        // 1. Create shell key (force new)
        let (shell_key, _) = hkcu
            .create_subkey(&shell_path)
            .map_err(|e| format!("Failed to create shell key for .{}: {}", ext, e))?;

        // 2. Set display name
        shell_key
            .set_value("", &"使用 GGwar3Edit 打开")
            .map_err(|e| format!("Failed to set display name: {}", e))?;

        // 3. Set icon
        shell_key
            .set_value("Icon", &format!("\"{}\",0", exe_path))
            .map_err(|e| format!("Failed to set icon: {}", e))?;

        // 4. Create command key
        let (command_key, _) = hkcu
            .create_subkey(&command_path)
            .map_err(|e| format!("Failed to create command key: {}", e))?;

        // 5. Set command string: "PATH" "%1"
        command_key
            .set_value("", &format!("\"{}\" \"%1\"", exe_path))
            .map_err(|e| format!("Failed to set command: {}", e))?;
    }

    Ok(true)
}

#[tauri::command]
fn unregister_context_menu() -> Result<bool, String> {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let extensions = ["mdx", "mdl"];

    for ext in &extensions {
        let shell_path = format!(
            "Software\\Classes\\SystemFileAssociations\\.{}\\shell\\GGWar3View",
            ext
        );
        let _ = hkcu.delete_subkey_all(&shell_path);

        // Also clean up old key
        let old_shell_path = format!(
            "Software\\Classes\\SystemFileAssociations\\.{}\\shell\\GGwar3Edit",
            ext
        );
        let _ = hkcu.delete_subkey_all(&old_shell_path);
    }

    Ok(true)
}

#[tauri::command]
fn check_context_menu_status() -> bool {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let mdx_path = "Software\\Classes\\SystemFileAssociations\\.mdx\\shell\\GGWar3View";
    let mdl_path = "Software\\Classes\\SystemFileAssociations\\.mdl\\shell\\GGWar3View";

    hkcu.open_subkey(mdx_path).is_ok() && hkcu.open_subkey(mdl_path).is_ok()
}

#[tauri::command]
fn register_copy_context_menu() -> Result<bool, String> {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let mut exe_path = std::env::current_exe()
        .map_err(|e| e.to_string())?
        .to_string_lossy()
        .to_string();

    if exe_path.starts_with("\\\\?\\") {
        exe_path = exe_path[4..].to_string();
    }

    let copy_exe = exe_path.clone();

    let extensions = ["mdx", "mdl"];

    for ext in &extensions {
        let shell_path = format!(
            "Software\\Classes\\SystemFileAssociations\\.{}\\shell\\GGWar3ViewCopy",
            ext
        );
        let command_path = format!("{}\\command", shell_path);

        let (shell_key, _) = hkcu
            .create_subkey(&shell_path)
            .map_err(|e| format!("Failed to create copy shell key for .{}: {}", ext, e))?;

        shell_key
            .set_value(
                "",
                &"\u{590d}\u{5236}\u{6a21}\u{578b}(\u{542b}\u{8d34}\u{56fe})",
            )
            .map_err(|e| format!("Failed to set copy display name: {}", e))?;

        shell_key
            .set_value("MultiSelectModel", &"Player")
            .map_err(|e| format!("Failed to set copy MultiSelectModel: {}", e))?;

        shell_key
            .set_value("Icon", &format!("\"{}\",0", exe_path))
            .map_err(|e| format!("Failed to set copy icon: {}", e))?;

        let (command_key, _) = hkcu
            .create_subkey(&command_path)
            .map_err(|e| format!("Failed to create copy command key: {}", e))?;

        command_key
            .set_value("", &format!("\"{}\" --copy-model \"%1\" %*", copy_exe))
            .map_err(|e| format!("Failed to set copy command: {}", e))?;
    }

    Ok(true)
}

#[tauri::command]
fn unregister_copy_context_menu() -> Result<bool, String> {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let extensions = ["mdx", "mdl"];

    for ext in &extensions {
        let shell_path = format!(
            "Software\\Classes\\SystemFileAssociations\\.{}\\shell\\GGWar3ViewCopy",
            ext
        );
        let _ = hkcu.delete_subkey_all(&shell_path);
    }

    Ok(true)
}

#[tauri::command]
fn check_copy_context_menu_status() -> bool {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let mdx_path = "Software\\Classes\\SystemFileAssociations\\.mdx\\shell\\GGWar3ViewCopy";
    let mdl_path = "Software\\Classes\\SystemFileAssociations\\.mdl\\shell\\GGWar3ViewCopy";

    hkcu.open_subkey(mdx_path).is_ok() && hkcu.open_subkey(mdl_path).is_ok()
}

#[tauri::command]
fn register_delete_context_menu() -> Result<bool, String> {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let mut exe_path = std::env::current_exe()
        .map_err(|e| e.to_string())?
        .to_string_lossy()
        .to_string();

    if exe_path.starts_with("\\\\?\\") {
        exe_path = exe_path[4..].to_string();
    }

    let delete_exe = exe_path.clone();

    let extensions = ["mdx", "mdl"];

    for ext in &extensions {
        let shell_path = format!(
            "Software\\Classes\\SystemFileAssociations\\.{}\\shell\\GGWar3ViewDelete",
            ext
        );
        let command_path = format!("{}\\command", shell_path);

        let (shell_key, _) = hkcu
            .create_subkey(&shell_path)
            .map_err(|e| format!("Failed to create delete shell key for .{}: {}", ext, e))?;

        shell_key
            .set_value(
                "",
                &"\u{5220}\u{9664}\u{6a21}\u{578b}(\u{542b}\u{8d34}\u{56fe})",
            )
            .map_err(|e| format!("Failed to set delete display name: {}", e))?;

        shell_key
            .set_value("MultiSelectModel", &"Player")
            .map_err(|e| format!("Failed to set delete MultiSelectModel: {}", e))?;

        shell_key
            .set_value("Icon", &format!("\"{}\",0", exe_path))
            .map_err(|e| format!("Failed to set delete icon: {}", e))?;

        let (command_key, _) = hkcu
            .create_subkey(&command_path)
            .map_err(|e| format!("Failed to create delete command key: {}", e))?;

        command_key
            .set_value("", &format!("\"{}\" --delete-model \"%1\" %*", delete_exe))
            .map_err(|e| format!("Failed to set delete command: {}", e))?;
    }

    Ok(true)
}

#[tauri::command]
fn unregister_delete_context_menu() -> Result<bool, String> {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let extensions = ["mdx", "mdl"];

    for ext in &extensions {
        let shell_path = format!(
            "Software\\Classes\\SystemFileAssociations\\.{}\\shell\\GGWar3ViewDelete",
            ext
        );
        let _ = hkcu.delete_subkey_all(&shell_path);
    }

    Ok(true)
}

#[tauri::command]
fn check_delete_context_menu_status() -> bool {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let mdx_path = "Software\\Classes\\SystemFileAssociations\\.mdx\\shell\\GGWar3ViewDelete";
    let mdl_path = "Software\\Classes\\SystemFileAssociations\\.mdl\\shell\\GGWar3ViewDelete";

    hkcu.open_subkey(mdx_path).is_ok() && hkcu.open_subkey(mdl_path).is_ok()
}

// ==================
// Download Command (for auto-update)
// ==================
#[tauri::command]
fn download_file(url: String, target_path: String) -> Result<String, String> {
    use std::io::Write;

    let client = reqwest::blocking::Client::builder()
        .user_agent("War3ModelEdit-Updater/1.0")
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

    let response = client
        .get(&url)
        .send()
        .map_err(|e| format!("HTTP request failed: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("Download failed: HTTP {}", response.status()));
    }

    let bytes = response
        .bytes()
        .map_err(|e| format!("Failed to read response body: {}", e))?;

    let mut file =
        std::fs::File::create(&target_path).map_err(|e| format!("Failed to create file: {}", e))?;

    file.write_all(&bytes)
        .map_err(|e| format!("Failed to write file: {}", e))?;

    Ok(target_path)
}

#[tauri::command]
fn launch_installer(path: String) -> Result<(), String> {
    use std::fs;
    use std::process::Command;

    // Get current executable path
    let exe_path =
        std::env::current_exe().map_err(|e| format!("Failed to get current exe path: {}", e))?;

    let exe_path_str = exe_path.to_string_lossy().to_string();

    // Remove UNC prefix if present
    let exe_path_str = if exe_path_str.starts_with("\\\\?\\") {
        exe_path_str[4..].to_string()
    } else {
        exe_path_str
    };

    let exe_name = exe_path
        .file_name()
        .ok_or("Failed to get exe name")?
        .to_string_lossy()
        .to_string();

    println!("[Update] New EXE path: {}", path);
    println!("[Update] Current EXE path: {}", exe_path_str);
    println!("[Update] Exe name: {}", exe_name);

    // Create a PowerShell script that waits for the app to close, then copies the new EXE
    let update_dir = app_paths::get_app_storage_root()?.join("update");
    std::fs::create_dir_all(&update_dir)
        .map_err(|e| format!("Failed to create update dir: {}", e))?;
    let ps_path = update_dir.join("war3modelview_update.ps1");

    // Convert paths for PowerShell script
    let new_exe_path = path.replace("/", "\\");
    let current_exe_path = exe_path_str.replace("/", "\\");

    // Get process name without extension for Get-Process
    let process_name = exe_name.trim_end_matches(".exe");

    // PowerShell script content:
    // 1. Wait for app to close
    // 2. Try to kill the process if still running
    // 3. Copy new EXE over old EXE
    // 4. Start the new version
    // 5. Clean up
    let ps_content = format!(
        r#"
Start-Sleep -Seconds 3

# Kill the process if still running
$proc = Get-Process -Name '{process}' -ErrorAction SilentlyContinue
if ($proc) {{
    $proc | Stop-Process -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
}}

# Copy new EXE over old EXE
try {{
    Copy-Item -Path '{new_exe}' -Destination '{current_exe}' -Force -ErrorAction Stop
    Start-Sleep -Seconds 1
    # Start the updated application
    Start-Process -FilePath '{current_exe}'
}} catch {{
    Add-Type -AssemblyName System.Windows.Forms
    [System.Windows.Forms.MessageBox]::Show("更新失败: $($_.Exception.Message)", "更新错误", 0, 16)
}}

# Clean up - remove the downloaded new EXE
Remove-Item -Path '{new_exe}' -Force -ErrorAction SilentlyContinue
"#,
        process = process_name.replace("'", "''"),
        new_exe = new_exe_path.replace("'", "''"),
        current_exe = current_exe_path.replace("'", "''")
    );

    // Write PowerShell script as UTF-8 with BOM
    let mut file_content = Vec::new();
    file_content.extend_from_slice(&[0xEF, 0xBB, 0xBF]); // UTF-8 BOM
    file_content.extend_from_slice(ps_content.as_bytes());

    fs::write(&ps_path, &file_content)
        .map_err(|e| format!("Failed to write PowerShell script: {}", e))?;

    // Launch PowerShell explicitly (not hidden) to reduce AV false positives.
    // Use -File to avoid inline command strings.
    let ps_path_str = ps_path.to_string_lossy().to_string();

    Command::new("powershell")
        .args(&[
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            ps_path_str.as_str(),
        ])
        .spawn()
        .map_err(|e| format!("Failed to launch update script: {}\nPath: {:?}", e, ps_path))?;

    Ok(())
}

#[tauri::command]
fn get_cli_file_path() -> Option<String> {
    let args: Vec<String> = std::env::args().collect();
    if args
        .iter()
        .any(|a| a == "--copy-model" || a == "--delete-model")
    {
        return None;
    }
    // First arg is the executable, second would be the file path
    for arg in args.iter().skip(1) {
        let lower = arg.to_lowercase();
        if lower.ends_with(".mdx") || lower.ends_with(".mdl") {
            return Some(arg.clone());
        }
    }
    None
}

#[tauri::command]
fn get_cli_file_paths() -> Vec<String> {
    if CLI_ARGS_CONSUMED.swap(true, Ordering::SeqCst) {
        return Vec::new();
    }

    let args: Vec<String> = std::env::args().collect();
    if args
        .iter()
        .any(|a| a == "--copy-model" || a == "--delete-model")
    {
        return Vec::new();
    }
    // Collect ALL model files from CLI args
    args.iter()
        .skip(1)
        .filter(|arg| {
            let lower = arg.to_lowercase();
            lower.ends_with(".mdx") || lower.ends_with(".mdl")
        })
        .cloned()
        .collect()
}

#[tauri::command]
fn get_pending_open_files() -> Vec<String> {
    let mut pending = PENDING_FILES.lock().unwrap();
    let files = pending.clone();
    pending.clear();
    files
}

#[tauri::command]
fn get_app_storage_root_cmd() -> Result<String, String> {
    let root = app_paths::get_app_storage_root()?;
    Ok(root.to_string_lossy().to_string())
}

#[tauri::command]
fn set_mpq_paths(paths: Vec<String>) -> Result<bool, String> {
    app_settings::update_mpq_paths(paths)?;
    Ok(true)
}

#[tauri::command]
fn set_copy_mpq_textures(enabled: bool) -> Result<bool, String> {
    app_settings::set_copy_mpq_textures(enabled)?;
    Ok(true)
}

#[tauri::command]
fn get_copy_mpq_textures_status() -> bool {
    app_settings::get_copy_mpq_textures()
}

// ==================
// File Deletion Command
// ==================
#[tauri::command]
fn delete_files(paths: Vec<String>) -> Vec<(String, bool, String)> {
    paths
        .into_iter()
        .map(|path| match std::fs::remove_file(&path) {
            Ok(_) => (path, true, "Deleted".to_string()),
            Err(e) => (path.clone(), false, e.to_string()),
        })
        .collect()
}

// ==================
// Model Copy Command (with textures)
// ==================
#[tauri::command]
fn copy_model_with_textures(model_path: String) -> Result<String, String> {
    let temp_root = app_paths::get_app_storage_root()?.join("temp");
    copy_utils::copy_model_with_textures(&model_path, &temp_root)
}

fn cleanup_temp_cache() {
    if let Ok(root) = app_paths::get_app_storage_root() {
        let temp_root = root.join("temp");
        copy_utils::cleanup_temp_root(&temp_root);
    }
}

fn main() {
    let delete_paths = get_cli_delete_paths();
    if let Some(delete_paths) = delete_paths {
        let log_root = match app_paths::get_app_storage_root() {
            Ok(root) => root,
            Err(_) => {
                return;
            }
        };
        let log_path = log_root.join("delete_log.txt");
        let result = if delete_paths.is_empty() {
            Err("No model paths provided".to_string())
        } else {
            delete_utils::delete_models_with_shared_textures(&delete_paths)
        };
        let arg_dump = std::env::args().collect::<Vec<_>>();
        let log_line = match &result {
            Ok(msg) => format!(
                "[DeleteCLI] OK: {} | paths={:?} | args={:?}\n",
                msg, delete_paths, arg_dump
            ),
            Err(e) => format!(
                "[DeleteCLI] ERR: {} | paths={:?} | args={:?}\n",
                e, delete_paths, arg_dump
            ),
        };
        let _ = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&log_path)
            .and_then(|mut f| std::io::Write::write_all(&mut f, log_line.as_bytes()));
        return;
    }

    let copy_paths = get_cli_copy_paths();
    if let Some(copy_paths) = copy_paths {
        let storage_root = match app_paths::get_app_storage_root() {
            Ok(root) => root.join("temp"),
            Err(_) => {
                return;
            }
        };
        let temp_root = storage_root;
        let log_root = match app_paths::get_app_storage_root() {
            Ok(root) => root,
            Err(_) => {
                return;
            }
        };
        let log_path = log_root.join("copy_log.txt");
        let queue_path = log_root.join("copy_queue.txt");
        let lock_path = log_root.join("copy_queue.lock");

        let result = if copy_paths.len() > 1 {
            copy_utils::copy_models_with_textures(&copy_paths, &temp_root).map(|(msg, _)| msg)
        } else {
            if !copy_paths.is_empty() {
                let _ = std::fs::OpenOptions::new()
                    .create(true)
                    .append(true)
                    .open(&queue_path)
                    .and_then(|mut f| {
                        for path in &copy_paths {
                            let line = format!("{}\n", path.replace('\n', " "));
                            let _ = std::io::Write::write_all(&mut f, line.as_bytes());
                        }
                        Ok(())
                    });
            }

            let lock_file = std::fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&lock_path);

            if lock_file.is_err() {
                return;
            }

            let mut queued_paths: Vec<String> = Vec::new();
            let mut stable_waits = 0;
            let max_waits = 4;
            let mut last_len: Option<u64> = None;
            while stable_waits < max_waits {
                let len = std::fs::metadata(&queue_path).map(|m| m.len()).unwrap_or(0);
                if let Some(prev) = last_len {
                    if len == prev {
                        stable_waits += 1;
                    } else {
                        stable_waits = 0;
                    }
                }
                last_len = Some(len);
                std::thread::sleep(std::time::Duration::from_millis(200));
            }

            if let Ok(content) = std::fs::read_to_string(&queue_path) {
                for line in content.lines() {
                    let trimmed = line.trim();
                    if !trimmed.is_empty() {
                        queued_paths.push(trimmed.to_string());
                    }
                }
            }

            let _ = std::fs::write(&queue_path, "");
            let _ = std::fs::remove_file(&lock_path);

            queued_paths.sort();
            queued_paths.dedup();

            if queued_paths.is_empty() {
                Err("No model paths provided".to_string())
            } else {
                copy_utils::copy_models_with_textures(&queued_paths, &temp_root).map(|(msg, _)| msg)
            }
        };
        let verify: Result<usize, String> = (|| {
            use clipboard_win::{formats::FileList, Clipboard, Getter};
            let _clip = Clipboard::new_attempts(10).map_err(|e| format!("{:?}", e))?;
            let mut items: Vec<String> = Vec::new();
            FileList
                .read_clipboard(&mut items)
                .map_err(|e| format!("{:?}", e))?;
            Ok(items.len())
        })();
        let arg_dump = std::env::args().collect::<Vec<_>>();
        let log_line = match &result {
            Ok(msg) => {
                let verify_info = match verify {
                    Ok(count) => format!("clipboard_items={}", count),
                    Err(e) => format!("clipboard_verify_err={}", e),
                };
                format!(
                    "[CopyCLI] OK: {} | {} | paths={:?} | args={:?}\n",
                    msg, verify_info, copy_paths, arg_dump
                )
            }
            Err(e) => format!(
                "[CopyCLI] ERR: {} | paths={:?} | args={:?}\n",
                e, copy_paths, arg_dump
            ),
        };
        let _ = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&log_path)
            .and_then(|mut f| std::io::Write::write_all(&mut f, log_line.as_bytes()));
        std::thread::sleep(std::time::Duration::from_millis(300));
        return;
    }

    // Run temp-cache cleanup in the background so it doesn't delay window creation
    std::thread::spawn(|| cleanup_temp_cache());

    tauri::Builder::default()
        .manage(MpqManager::new())
        .manage(TextureBatchCache::new())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            // Restore and focus main window (unminimize if needed, show if hidden)
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
            // Collect all model files from args and emit them
            let model_paths: Vec<String> = args
                .iter()
                .skip(1)
                .filter(|arg| {
                    let lower = arg.to_lowercase();
                    lower.ends_with(".mdx") || lower.ends_with(".mdl")
                })
                .cloned()
                .collect();

            if !model_paths.is_empty() {
                // Push to pending buffer (for missed events during startup)
                {
                    let mut pending = PENDING_FILES.lock().unwrap();
                    pending.extend(model_paths.clone());
                }
                // Emit all paths as a single event
                let _ = app.emit("open-files", model_paths);
            }
        }))
        .invoke_handler(tauri::generate_handler![
            load_mpq,
            read_mpq_file,
            read_mpq_files_batch,
            get_loaded_mpq_paths,
            list_mpq_files,
            set_mpq_priority,
            debug_mpq_probe,
            read_local_files_batch,
            load_textures_batch_bin,
            load_textures_batch_thumb_rgba,
            clear_texture_batch_cache,
            encode_texture_image,
            detect_warcraft_path,
            toggle_console,
            debug_log,
            // Activation Commands
            get_machine_id,
            get_activation_status,
            activate_software,
            open_qq_verification_window,
            check_qq_verification_window_status,
            close_qq_verification_window,
            // Context Menu Commands
            register_context_menu,
            unregister_context_menu,
            check_context_menu_status,
            get_cli_file_path,
            get_cli_file_paths,
            get_pending_open_files,
            get_cli_copy_path,
            get_cli_delete_path,
            register_copy_context_menu,
            unregister_copy_context_menu,
            check_copy_context_menu_status,
            register_delete_context_menu,
            unregister_delete_context_menu,
            check_delete_context_menu_status,
            // Download Command
            download_file,
            launch_installer,
            // File Deletion Command
            delete_files,
            // Storage Root
            get_app_storage_root_cmd,
            // MPQ Settings
            set_mpq_paths,
            set_copy_mpq_textures,
            get_copy_mpq_textures_status,
            // Model Copy Command
            copy_model_with_textures
        ])
        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        .run(|_, event| match event {
            tauri::RunEvent::ExitRequested { .. } | tauri::RunEvent::Exit => {
                cleanup_temp_cache();
            }
            _ => {}
        });
}
