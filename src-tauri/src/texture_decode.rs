use image::{ImageFormat};
use std::collections::HashSet;

pub struct DecodedImage {
    pub width: u32,
    pub height: u32,
    pub data: Vec<u8>,
}

const BLP1_MAGIC: u32 = u32::from_le_bytes(*b"BLP1");
const BLP_HEADER_SIZE: usize = 156;
const BLP_PALETTE_SIZE: usize = 256 * 4;

fn read_u32_le(bytes: &[u8], offset: usize) -> Result<u32, String> {
    if offset + 4 > bytes.len() {
        return Err("BLP header truncated".to_string());
    }
    Ok(u32::from_le_bytes([
        bytes[offset],
        bytes[offset + 1],
        bytes[offset + 2],
        bytes[offset + 3],
    ]))
}

fn decode_blp(bytes: &[u8]) -> Result<DecodedImage, String> {
    if bytes.len() < BLP_HEADER_SIZE {
        return Err("BLP too small".to_string());
    }

    let magic = read_u32_le(bytes, 0)?;
    if magic != BLP1_MAGIC {
        return Err("Unsupported BLP magic".to_string());
    }

    let compression = read_u32_le(bytes, 4)?;
    let width = read_u32_le(bytes, 12)?;
    let height = read_u32_le(bytes, 16)?;
    let picture_type = read_u32_le(bytes, 20)?;

    let mut offsets = [0u32; 16];
    let mut sizes = [0u32; 16];
    for i in 0..16 {
        offsets[i] = read_u32_le(bytes, 28 + i * 4)?;
        sizes[i] = read_u32_le(bytes, 92 + i * 4)?;
    }

    match compression {
        0 => {
            // JPEG-compressed BLP1
            let jpeg_header_size = read_u32_le(bytes, BLP_HEADER_SIZE)? as usize;
            let jpeg_header_start = BLP_HEADER_SIZE + 4;
            let jpeg_header_end = jpeg_header_start + jpeg_header_size;
            if jpeg_header_end > bytes.len() {
                return Err("BLP JPEG header out of range".to_string());
            }

            let mip_offset = offsets[0] as usize;
            let mip_size = sizes[0] as usize;
            if mip_offset + mip_size > bytes.len() || mip_size == 0 {
                return Err("BLP mip0 out of range".to_string());
            }

            let mut jpeg = Vec::with_capacity(jpeg_header_size + mip_size);
            jpeg.extend_from_slice(&bytes[jpeg_header_start..jpeg_header_end]);
            jpeg.extend_from_slice(&bytes[mip_offset..mip_offset + mip_size]);

            let img = image::load_from_memory_with_format(&jpeg, ImageFormat::Jpeg)
                .map_err(|e| format!("BLP JPEG decode failed: {e:?}"))?;
            let rgba = img.to_rgba8();
            Ok(DecodedImage {
                width: rgba.width(),
                height: rgba.height(),
                data: rgba.into_raw(),
            })
        }
        1 => {
            // Uncompressed palette BLP1
            if bytes.len() < BLP_HEADER_SIZE + BLP_PALETTE_SIZE {
                return Err("BLP palette out of range".to_string());
            }

            let palette_start = BLP_HEADER_SIZE;
            let palette = &bytes[palette_start..palette_start + BLP_PALETTE_SIZE];
            let pixel_start = palette_start + BLP_PALETTE_SIZE;
            let pixel_count = (width as usize).saturating_mul(height as usize);

            if bytes.len() < pixel_start + pixel_count {
                return Err("BLP pixel data out of range".to_string());
            }

            let indices = &bytes[pixel_start..pixel_start + pixel_count];
            let mut rgba = vec![0u8; pixel_count * 4];

            match picture_type {
                3 | 4 => {
                    let alpha_start = pixel_start + pixel_count;
                    if bytes.len() < alpha_start + pixel_count {
                        return Err("BLP alpha data out of range".to_string());
                    }
                    let alpha = &bytes[alpha_start..alpha_start + pixel_count];
                    for i in 0..pixel_count {
                        let idx = indices[i] as usize * 4;
                        let out = i * 4;
                        rgba[out] = palette[idx];
                        rgba[out + 1] = palette[idx + 1];
                        rgba[out + 2] = palette[idx + 2];
                        rgba[out + 3] = alpha[i];
                    }
                }
                5 => {
                    for i in 0..pixel_count {
                        let idx = indices[i] as usize * 4;
                        let out = i * 4;
                        rgba[out] = palette[idx];
                        rgba[out + 1] = palette[idx + 1];
                        rgba[out + 2] = palette[idx + 2];
                        rgba[out + 3] = 255u8.saturating_sub(palette[idx + 3]);
                    }
                }
                _ => return Err("Unsupported BLP picture type".to_string()),
            }

            Ok(DecodedImage { width, height, data: rgba })
        }
        _ => Err("Unsupported BLP compression".to_string()),
    }
}

fn decode_tga(bytes: &[u8]) -> Result<DecodedImage, String> {
    let img = image::load_from_memory_with_format(bytes, ImageFormat::Tga)
        .map_err(|e| format!("TGA decode failed: {e:?}"))?;
    let rgba = img.to_rgba8();
    Ok(DecodedImage {
        width: rgba.width(),
        height: rgba.height(),
        data: rgba.into_raw(),
    })
}

pub fn decode_texture_bytes(bytes: &[u8], path: &str) -> Result<DecodedImage, String> {
    let lower = path.to_lowercase();
    if lower.ends_with(".tga") {
        return decode_tga(bytes);
    }
    if lower.ends_with(".blp") {
        return decode_blp(bytes);
    }

    let img = image::load_from_memory(bytes)
        .map_err(|e| format!("Image decode failed: {e:?}"))?;
    let rgba = img.to_rgba8();
    Ok(DecodedImage {
        width: rgba.width(),
        height: rgba.height(),
        data: rgba.into_raw(),
    })
}

pub fn normalize_path(path: &str) -> String {
    let mut normalized = path.replace('\0', "");
    normalized = normalized.trim().replace('/', "\\");
    if normalized.starts_with(".\\") {
        normalized = normalized[2..].to_string();
    }
    if normalized.starts_with("\\\\") {
        return normalized;
    }
    while normalized.starts_with('\\') {
        normalized = normalized[1..].to_string();
    }
    while normalized.contains("\\\\") {
        normalized = normalized.replace("\\\\", "\\");
    }
    normalized
}

pub fn get_texture_candidate_paths(model_path: &str, texture_path: &str) -> Vec<String> {
    let texture_rel = normalize_path(texture_path);
    let normalized_model_path = normalize_path(model_path);
    let model_dir = match normalized_model_path.rfind('\\') {
        Some(idx) => &normalized_model_path[..idx],
        None => normalized_model_path.as_str(),
    };

    let mut candidates: Vec<String> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();

    let primary = format!("{}\\{}", model_dir, texture_rel);
    if seen.insert(primary.clone()) {
        candidates.push(primary);
    }

    let filename = texture_rel.rsplit('\\').next().unwrap_or("");
    if filename != texture_rel {
        let alt = format!("{}\\{}", model_dir, filename);
        if seen.insert(alt.clone()) {
            candidates.push(alt);
        }
    }

    let mut current_dir = model_dir.to_string();
    loop {
        let last = match current_dir.rfind('\\') {
            Some(idx) => idx,
            None => break,
        };
        current_dir = current_dir[..last].to_string();
        if current_dir.is_empty() || current_dir.ends_with(':') {
            let root_candidate = format!("{}\\{}", current_dir, texture_rel);
            if seen.insert(root_candidate.clone()) {
                candidates.push(root_candidate);
            }
            break;
        }
        let parent_candidate = format!("{}\\{}", current_dir, texture_rel);
        if seen.insert(parent_candidate.clone()) {
            candidates.push(parent_candidate);
        }
    }

    candidates
}
