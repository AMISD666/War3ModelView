use image::{imageops::FilterType, ImageFormat, RgbaImage};
use std::collections::HashSet;

pub struct DecodedImage {
    pub width: u32,
    pub height: u32,
    pub data: Vec<u8>,
}

const BLP1_MAGIC: u32 = u32::from_le_bytes(*b"BLP1");
const BLP_HEADER_SIZE: usize = 156;
const BLP_PALETTE_SIZE: usize = 256 * 4;

fn normalize_max_dimension(max_dimension: Option<u32>) -> Option<u32> {
    max_dimension.map(|v| v.clamp(16, 2048))
}

fn mip_dimensions(width: u32, height: u32, level: usize) -> (u32, u32) {
    let shift = level.min(31) as u32;
    ((width >> shift).max(1), (height >> shift).max(1))
}

fn choose_blp_mip_level(
    width: u32,
    height: u32,
    max_dimension: Option<u32>,
    offsets: &[u32; 16],
    sizes: &[u32; 16],
) -> usize {
    let max_dim = match normalize_max_dimension(max_dimension) {
        Some(v) if v > 0 => v,
        _ => return 0,
    };

    let mut level = 0usize;
    loop {
        let (w, h) = mip_dimensions(width, height, level);
        if w <= max_dim && h <= max_dim {
            break;
        }
        let next = level + 1;
        if next >= 16 || offsets[next] == 0 || sizes[next] == 0 {
            break;
        }
        level = next;
    }

    level
}

fn downscale_decoded_if_needed(
    decoded: DecodedImage,
    max_dimension: Option<u32>,
) -> Result<DecodedImage, String> {
    let max_dim = match normalize_max_dimension(max_dimension) {
        Some(v) => v,
        None => return Ok(decoded),
    };

    if decoded.width <= max_dim && decoded.height <= max_dim {
        return Ok(decoded);
    }

    let src = RgbaImage::from_raw(decoded.width, decoded.height, decoded.data)
        .ok_or_else(|| "Invalid RGBA buffer length".to_string())?;

    let scale = (max_dim as f32 / (decoded.width.max(decoded.height) as f32)).min(1.0);
    let target_w = ((decoded.width as f32 * scale).round() as u32).max(1);
    let target_h = ((decoded.height as f32 * scale).round() as u32).max(1);

    let resized = image::imageops::resize(&src, target_w, target_h, FilterType::Triangle);
    Ok(DecodedImage {
        width: resized.width(),
        height: resized.height(),
        data: resized.into_raw(),
    })
}

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

fn bit_val(data: &[u8], bit_count: u8, index: usize) -> u8 {
    if bit_count == 0 {
        return 0;
    }
    let bits = bit_count as usize;
    let bit_pos = index.saturating_mul(bits);
    let byte_index = bit_pos / 8;
    if byte_index >= data.len() {
        return 0;
    }
    let vals_per_byte = 8 / bits.max(1);
    let shift = vals_per_byte
        .saturating_sub(index % vals_per_byte)
        .saturating_sub(1)
        .saturating_mul(bits);
    let mask = ((1u16 << bit_count) - 1) as u8;
    (data[byte_index] >> shift) & mask
}

fn decode_blp(bytes: &[u8], max_dimension: Option<u32>) -> Result<DecodedImage, String> {
    if bytes.len() < BLP_HEADER_SIZE {
        return Err("BLP too small".to_string());
    }

    let magic = read_u32_le(bytes, 0)?;
    if magic != BLP1_MAGIC {
        return Err("Unsupported BLP magic".to_string());
    }

    let compression = read_u32_le(bytes, 4)?;
    let alpha_bits = read_u32_le(bytes, 8)? as u8;
    let width = read_u32_le(bytes, 12)?;
    let height = read_u32_le(bytes, 16)?;
    let _picture_type = read_u32_le(bytes, 20)?;

    let mut offsets = [0u32; 16];
    let mut sizes = [0u32; 16];
    for i in 0..16 {
        offsets[i] = read_u32_le(bytes, 28 + i * 4)?;
        sizes[i] = read_u32_le(bytes, 92 + i * 4)?;
    }

    let mut mip_level = choose_blp_mip_level(width, height, max_dimension, &offsets, &sizes);
    if offsets[mip_level] == 0 || sizes[mip_level] == 0 {
        mip_level = 0;
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

            let mip_offset = offsets[mip_level] as usize;
            let mip_size = sizes[mip_level] as usize;
            if mip_size == 0 || mip_offset + mip_size > bytes.len() {
                return Err(format!("BLP mip{mip_level} out of range"));
            }

            let mut jpeg = Vec::with_capacity(jpeg_header_size + mip_size);
            jpeg.extend_from_slice(&bytes[jpeg_header_start..jpeg_header_end]);
            jpeg.extend_from_slice(&bytes[mip_offset..mip_offset + mip_size]);

            let img = image::load_from_memory_with_format(&jpeg, ImageFormat::Jpeg)
                .map_err(|e| format!("BLP JPEG decode failed: {e:?}"))?;
            let rgba = img.to_rgba8();
            downscale_decoded_if_needed(DecodedImage {
                width: rgba.width(),
                height: rgba.height(),
                data: rgba.into_raw(),
            }, max_dimension)
        }
        1 => {
            // Uncompressed palette BLP1.
            // Keep this path aligned with `vendor/war3-model/blp/decode.ts`:
            // - pixel indices at mip offset
            // - BGRA palette channel order
            // - alpha decoded from packed alphaBits stream
            if bytes.len() < BLP_HEADER_SIZE + BLP_PALETTE_SIZE {
                return Err("BLP palette out of range".to_string());
            }

            let palette_start = BLP_HEADER_SIZE;
            let palette = &bytes[palette_start..palette_start + BLP_PALETTE_SIZE];
            let (mip_width, mip_height) = mip_dimensions(width, height, mip_level);
            let pixel_count = (mip_width as usize).saturating_mul(mip_height as usize);

            let default_pixel_start = palette_start + BLP_PALETTE_SIZE;
            let mut pixel_start = offsets[mip_level] as usize;
            if pixel_start == 0 {
                pixel_start = default_pixel_start;
            }
            if bytes.len() < pixel_start + pixel_count {
                if pixel_start != default_pixel_start && bytes.len() >= default_pixel_start + pixel_count {
                    pixel_start = default_pixel_start;
                } else {
                    return Err(format!("BLP mip{mip_level} pixel data out of range"));
                }
            }

            let indices = &bytes[pixel_start..pixel_start + pixel_count];
            let mut rgba = vec![0u8; pixel_count * 4];
            let alpha_len = ((pixel_count.saturating_mul(alpha_bits as usize)) + 7) / 8;
            let alpha_start = pixel_start.saturating_add(pixel_count);
            let alpha_data = if alpha_bits > 0 {
                if alpha_start + alpha_len > bytes.len() {
                    return Err("BLP alpha data out of range".to_string());
                }
                Some(&bytes[alpha_start..alpha_start + alpha_len])
            } else {
                None
            };

            let val_per_alpha = if alpha_bits > 0 {
                255.0f32 / ((1u32 << alpha_bits) as f32 - 1.0)
            } else {
                255.0
            };

            for i in 0..pixel_count {
                let idx = indices[i] as usize * 4;
                let out = i * 4;
                // Warcraft BLP1 palette is stored in BGRA order.
                rgba[out] = palette[idx + 2];
                rgba[out + 1] = palette[idx + 1];
                rgba[out + 2] = palette[idx];

                if let Some(alpha) = alpha_data {
                    let a = bit_val(alpha, alpha_bits, i) as f32;
                    rgba[out + 3] = (a * val_per_alpha).round().clamp(0.0, 255.0) as u8;
                } else {
                    rgba[out + 3] = 255;
                }
            }

            downscale_decoded_if_needed(DecodedImage {
                width: mip_width,
                height: mip_height,
                data: rgba,
            }, max_dimension)
        }
        _ => Err("Unsupported BLP compression".to_string()),
    }
}

fn decode_tga(bytes: &[u8], max_dimension: Option<u32>) -> Result<DecodedImage, String> {
    let img = image::load_from_memory_with_format(bytes, ImageFormat::Tga)
        .map_err(|e| format!("TGA decode failed: {e:?}"))?;
    let rgba = img.to_rgba8();
    downscale_decoded_if_needed(DecodedImage {
        width: rgba.width(),
        height: rgba.height(),
        data: rgba.into_raw(),
    }, max_dimension)
}

#[allow(dead_code)]
pub fn decode_texture_bytes(bytes: &[u8], path: &str) -> Result<DecodedImage, String> {
    decode_texture_bytes_with_max_dimension(bytes, path, None)
}

pub fn decode_texture_bytes_with_max_dimension(
    bytes: &[u8],
    path: &str,
    max_dimension: Option<u32>,
) -> Result<DecodedImage, String> {
    let lower = path.to_lowercase();
    if lower.ends_with(".tga") {
        return decode_tga(bytes, max_dimension);
    }
    if lower.ends_with(".blp") {
        return decode_blp(bytes, max_dimension);
    }

    let img = image::load_from_memory(bytes)
        .map_err(|e| format!("Image decode failed: {e:?}"))?;
    let rgba = img.to_rgba8();
    downscale_decoded_if_needed(DecodedImage {
        width: rgba.width(),
        height: rgba.height(),
        data: rgba.into_raw(),
    }, max_dimension)
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
