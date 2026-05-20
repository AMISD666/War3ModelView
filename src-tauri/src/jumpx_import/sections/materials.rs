use crate::jumpx_import::binary::{
    checked_table_offset, decrypt_offset, read_f32_at, read_i32_at, read_u32_at,
};
use crate::jumpx_import::container::JumpxDirectory;
use crate::jumpx_import::geometry_data::EPSILON;
use crate::jumpx_import::types::{JumpxMaterialDto, JumpxScalarKeyDto, JumpxVec3KeyDto};

const MATERIAL_SAMPLE_RECORD_SIZE: usize = 16;
const MATERIAL_SAMPLE_COLOR_OFFSET: usize = 0;
const MATERIAL_SAMPLE_UV_OFFSET: usize = 4;
const MATERIAL_SAMPLE_BLEND_OFFSET: usize = 12;
const MATERIAL_TRACK_START_FRAME: u32 = 320;
const MATERIAL_TRACK_FPS: f32 = 30.0;
const MATERIAL_TRACK_LINE_TYPE: u32 = 1;

struct MaterialSampleTracks {
    alpha_keys: Vec<JumpxScalarKeyDto>,
    color_keys: Vec<JumpxVec3KeyDto>,
    uv_offset_keys: Vec<JumpxVec3KeyDto>,
}

pub(in crate::jumpx_import) fn parse_materials(
    data: &[u8],
    head: &[u8],
    dir: &JumpxDirectory,
) -> Result<Vec<JumpxMaterialDto>, String> {
    let count = dir.get("nmtl") as usize;
    let mut out = Vec::with_capacity(count);
    for index in 0..count {
        let offset = checked_table_offset(dir.get("amtl"), index, 0x30, "materials")?;
        let data_addr = read_u32_at(head, offset)?;
        let save_flag = read_u32_at(head, offset + 4)?;
        let flag = read_u32_at(head, offset + 8)?;
        let texture_id = read_i32_at(head, offset + 12)?;
        let sample_count = read_u32_at(head, offset + 40)? as usize;
        let sample_addr = read_u32_at(head, offset + 44)?;
        let playback_rate = read_f32_at(head, offset + 28)?;
        let uv_speed = [
            read_f32_at(head, offset + 32)?,
            read_f32_at(head, offset + 36)?,
        ];
        let sample_tracks = read_material_sample_tracks(data, sample_addr, sample_count)?;
        out.push(JumpxMaterialDto {
            material_index: index as u32,
            name: format!("JumpX_Material_{index}"),
            texture_id,
            raw_flags: flag,
            save_flags: save_flag,
            sample_count: sample_count as u32,
            diffuse_color: None,
            emissive_color: None,
            alpha: None,
            color_keys: sample_tracks.color_keys,
            alpha_keys: sample_tracks.alpha_keys,
            uv_offset_keys: sample_tracks.uv_offset_keys,
            uv_speed: Some(uv_speed)
                .filter(|value| value[0].abs() > EPSILON || value[1].abs() > EPSILON),
        });
        let _ = data_addr;
        let _ = playback_rate;
    }
    Ok(out)
}

fn read_material_sample_tracks(
    data: &[u8],
    sample_addr: u32,
    sample_count: usize,
) -> Result<MaterialSampleTracks, String> {
    if sample_addr == 0 || sample_count == 0 {
        return Ok(MaterialSampleTracks {
            alpha_keys: Vec::new(),
            color_keys: Vec::new(),
            uv_offset_keys: Vec::new(),
        });
    }

    let offset = decrypt_offset(sample_addr)?;
    let mut alpha_keys = Vec::with_capacity(sample_count);
    let mut color_keys = Vec::with_capacity(sample_count);
    let mut uv_offset_keys = Vec::with_capacity(sample_count);
    for index in 0..sample_count {
        let sample_offset = offset + index * MATERIAL_SAMPLE_RECORD_SIZE;
        let color_rgba = read_u32_at(data, sample_offset + MATERIAL_SAMPLE_COLOR_OFFSET)?;
        let r = (color_rgba & 0xff) as f32 / 255.0;
        let g = ((color_rgba >> 8) & 0xff) as f32 / 255.0;
        let b = ((color_rgba >> 16) & 0xff) as f32 / 255.0;
        let a = ((color_rgba >> 24) & 0xff) as f32 / 255.0;
        let uv_x = read_f32_at(data, sample_offset + MATERIAL_SAMPLE_UV_OFFSET)?;
        let uv_y = read_f32_at(data, sample_offset + MATERIAL_SAMPLE_UV_OFFSET + 4)?;
        let frame = MATERIAL_TRACK_START_FRAME + index as u32;
        alpha_keys.push(JumpxScalarKeyDto {
            frame,
            time_ms: Some(frame as f32 * 1000.0 / MATERIAL_TRACK_FPS),
            value: a,
            raw_flags: MATERIAL_TRACK_LINE_TYPE,
        });
        color_keys.push(JumpxVec3KeyDto {
            frame,
            time_ms: Some(frame as f32 * 1000.0 / MATERIAL_TRACK_FPS),
            value: [r, g, b],
            raw_flags: MATERIAL_TRACK_LINE_TYPE,
        });
        uv_offset_keys.push(JumpxVec3KeyDto {
            frame,
            time_ms: Some(frame as f32 * 1000.0 / MATERIAL_TRACK_FPS),
            value: [uv_x, uv_y, 0.0],
            raw_flags: MATERIAL_TRACK_LINE_TYPE,
        });
        let _ = read_u32_at(data, sample_offset + MATERIAL_SAMPLE_BLEND_OFFSET)?;
    }
    Ok(MaterialSampleTracks {
        alpha_keys,
        color_keys,
        uv_offset_keys,
    })
}
