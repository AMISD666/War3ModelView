use blp::{AnyImage, AnyImageEncodeOptions};
use image::{DynamicImage, ImageFormat, RgbaImage};
use tauri::ipc::Response;

fn encode_blp_from_rgba(
    rgba: Vec<u8>,
    width: u32,
    height: u32,
    quality: u8,
) -> Result<Vec<u8>, String> {
    let image = AnyImage::from_rgba(rgba, width, height).map_err(|e| format!("BLP source error: {e}"))?;
    image
        .encode(&AnyImageEncodeOptions::Blp {
            quality,
            mip_options: None,
            raw: None,
        })
        .map_err(|e| format!("BLP encode failed: {e}"))
}

fn encode_tga_from_rgba(rgba: Vec<u8>, width: u32, height: u32) -> Result<Vec<u8>, String> {
    let image = RgbaImage::from_raw(width, height, rgba)
        .ok_or_else(|| "Invalid RGBA buffer length for TGA".to_string())?;
    let dynamic = DynamicImage::ImageRgba8(image);
    let mut cursor = std::io::Cursor::new(Vec::new());
    dynamic
        .write_to(&mut cursor, ImageFormat::Tga)
        .map_err(|e| format!("TGA encode failed: {e}"))?;
    Ok(cursor.into_inner())
}

#[tauri::command]
pub fn encode_texture_image(
    rgba: Vec<u8>,
    width: u32,
    height: u32,
    format: String,
    blp_quality: Option<u8>,
) -> Result<Response, String> {
    if width == 0 || height == 0 {
        return Err("Invalid texture size".to_string());
    }
    let expected = (width as usize)
        .saturating_mul(height as usize)
        .saturating_mul(4);
    if rgba.len() != expected {
        return Err(format!(
            "Invalid RGBA buffer size: expected {expected}, got {}",
            rgba.len()
        ));
    }

    let lower = format.to_lowercase();
    let bytes = match lower.as_str() {
        "blp" => {
            let quality = blp_quality.unwrap_or(90).clamp(1, 100);
            encode_blp_from_rgba(rgba, width, height, quality)?
        }
        "tga" => encode_tga_from_rgba(rgba, width, height)?,
        _ => return Err(format!("Unsupported encode format: {format}")),
    };

    Ok(Response::new(bytes))
}
