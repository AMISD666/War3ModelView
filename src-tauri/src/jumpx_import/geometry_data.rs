use super::binary::{
    decrypt_offset, read_f32_at, read_i8_at, read_u32_at, read_u64_at, read_u8_at,
};
use super::math::{axis_angle_to_quat, invert_quat, uncompress_bbox};
use super::types::{JumpxQuatKeyDto, JumpxScalarKeyDto, JumpxVec3KeyDto};

pub(super) const EPSILON: f32 = 1e-4;
pub(super) const GEO_COMPRESSED_VERTEX: u32 = 1;
pub(super) const GEO_COMPRESSED_NORMAL: u32 = 2;
pub(super) const GEO_ENABLE_BONE_PALETTE: u32 = 64;
pub(super) const GEO_ENABLE_UV2: u32 = 128;
pub(super) const DEFAULT_SAMPLE_START_FRAME: u32 = 320;
pub(super) const DEFAULT_SAMPLE_FPS: f32 = 30.0;

fn sample_frame(index: usize) -> u32 {
    DEFAULT_SAMPLE_START_FRAME + index as u32
}

fn sample_time_ms(frame: u32) -> f32 {
    frame as f32 * 1000.0 / DEFAULT_SAMPLE_FPS
}

pub(super) fn read_vertices(
    data: &[u8],
    save_flag: u32,
    raw_addr: u32,
    comp_addr: u32,
    count: usize,
    min: [f32; 3],
    max: [f32; 3],
) -> Result<Vec<f32>, String> {
    if save_flag & GEO_COMPRESSED_VERTEX != 0 && comp_addr != 0 {
        let offset = decrypt_offset(comp_addr)?;
        let mut out = Vec::with_capacity(count * 3);
        for index in 0..count {
            let packed = read_u32_at(data, offset + index * 4)?;
            let value = uncompress_bbox(packed, min, max);
            out.extend_from_slice(&value);
        }
        return Ok(out);
    }
    read_vec3_array(data, raw_addr, count)
}

pub(super) fn read_normals(
    data: &[u8],
    save_flag: u32,
    raw_addr: u32,
    comp_addr: u32,
    count: usize,
) -> Result<Vec<f32>, String> {
    if save_flag & GEO_COMPRESSED_NORMAL != 0 && comp_addr != 0 {
        let offset = decrypt_offset(comp_addr)?;
        let mut out = Vec::with_capacity(count * 3);
        for index in 0..count {
            let x = read_i8_at(data, offset + index * 3)? as f32 / 127.0;
            let y = read_i8_at(data, offset + index * 3 + 1)? as f32 / 127.0;
            let z = read_i8_at(data, offset + index * 3 + 2)? as f32 / 127.0;
            let len = (x * x + y * y + z * z).sqrt();
            if len > 0.0 {
                out.extend_from_slice(&[x / len, y / len, z / len]);
            } else {
                out.extend_from_slice(&[0.0, 0.0, 1.0]);
            }
        }
        return Ok(out);
    }
    read_vec3_array(data, raw_addr, count)
}

pub(super) fn read_vec3_array(data: &[u8], addr: u32, count: usize) -> Result<Vec<f32>, String> {
    if addr == 0 {
        return Ok(vec![0.0; count * 3]);
    }
    let offset = decrypt_offset(addr)?;
    let mut out = Vec::with_capacity(count * 3);
    for index in 0..(count * 3) {
        out.push(read_f32_at(data, offset + index * 4)?);
    }
    Ok(out)
}

pub(super) fn read_vec2_array(data: &[u8], addr: u32, count: usize) -> Result<Vec<f32>, String> {
    if addr == 0 {
        return Ok(vec![0.0; count * 2]);
    }
    let offset = decrypt_offset(addr)?;
    let mut out = Vec::with_capacity(count * 2);
    for index in 0..(count * 2) {
        out.push(read_f32_at(data, offset + index * 4)?);
    }
    Ok(out)
}

pub(super) fn read_bone_palette(
    data: &[u8],
    addr: u32,
    count: usize,
) -> Result<(Vec<u8>, Vec<u32>, Vec<f32>), String> {
    let offset = decrypt_offset(addr)?;
    let mut counts = Vec::with_capacity(count);
    let mut bone_ids = Vec::with_capacity(count * 4);
    let mut weights = Vec::with_capacity(count * 4);
    for vertex_index in 0..count {
        let base = offset + vertex_index * 0x18;
        let mut count_value = read_u8_at(data, base)?.min(4);
        let mut bones = [0u32; 4];
        let mut local_weights = [0.0f32; 4];
        for influence_index in 0..4 {
            bones[influence_index] = read_u8_at(data, base + 1 + influence_index)? as u32;
            local_weights[influence_index] = read_f32_at(data, base + 8 + influence_index * 4)?;
        }
        let mut filtered = Vec::new();
        for influence_index in 0..count_value as usize {
            if local_weights[influence_index] >= EPSILON {
                filtered.push((bones[influence_index], local_weights[influence_index]));
            }
        }
        count_value = filtered.len() as u8;
        counts.push(count_value);
        for influence_index in 0..4 {
            if let Some((bone, weight)) = filtered.get(influence_index) {
                bone_ids.push(*bone);
                weights.push(*weight);
            } else {
                bone_ids.push(0);
                weights.push(0.0);
            }
        }
    }
    Ok((counts, bone_ids, weights))
}

pub(super) fn default_single_bone_palette(
    count: usize,
    ancestor_bone: i32,
) -> (Vec<u8>, Vec<u32>, Vec<f32>) {
    let bone = ancestor_bone.max(0) as u32;
    let mut counts = Vec::with_capacity(count);
    let mut bone_ids = Vec::with_capacity(count * 4);
    let mut weights = Vec::with_capacity(count * 4);
    for _ in 0..count {
        counts.push(1);
        bone_ids.extend_from_slice(&[bone, 0, 0, 0]);
        weights.extend_from_slice(&[1.0, 0.0, 0.0, 0.0]);
    }
    (counts, bone_ids, weights)
}

pub(super) fn read_visibility_keys(
    data: &[u8],
    addr: u32,
    count: usize,
) -> Result<Vec<JumpxScalarKeyDto>, String> {
    if addr == 0 || count == 0 {
        return Ok(Vec::new());
    }
    let offset = decrypt_offset(addr)?;
    let mut out = Vec::with_capacity(count);
    for index in 0..count {
        let frame = sample_frame(index);
        out.push(JumpxScalarKeyDto {
            frame,
            time_ms: Some(sample_time_ms(frame)),
            value: read_u32_at(data, offset + index * 4)? as f32,
            raw_flags: 0,
        });
    }
    Ok(out)
}

pub(super) fn read_vec3_keys(
    data: &[u8],
    compressed: bool,
    raw_addr: u32,
    comp_addr: u32,
    count: usize,
    bbox: Option<([f32; 3], [f32; 3])>,
) -> Result<Vec<JumpxVec3KeyDto>, String> {
    if count == 0 {
        return Ok(Vec::new());
    }
    if compressed {
        let offset = decrypt_offset(comp_addr)?;
        let (min, max) = bbox.unwrap_or(([-10000000.0; 3], [10000000.0; 3]));
        let mut out = Vec::with_capacity(count);
        for index in 0..count {
            let frame = sample_frame(index);
            out.push(JumpxVec3KeyDto {
                frame,
                time_ms: Some(sample_time_ms(frame)),
                value: uncompress_bbox(read_u32_at(data, offset + index * 4)?, min, max),
                raw_flags: 0,
            });
        }
        return Ok(out);
    }
    if raw_addr == 0 {
        return Ok(Vec::new());
    }
    let offset = decrypt_offset(raw_addr)?;
    let mut out = Vec::with_capacity(count);
    for index in 0..count {
        let frame = sample_frame(index);
        out.push(JumpxVec3KeyDto {
            frame,
            time_ms: Some(sample_time_ms(frame)),
            value: [
                read_f32_at(data, offset + index * 12)?,
                read_f32_at(data, offset + index * 12 + 4)?,
                read_f32_at(data, offset + index * 12 + 8)?,
            ],
            raw_flags: 0,
        });
    }
    Ok(out)
}

pub(super) fn read_quat_keys(
    data: &[u8],
    compressed: bool,
    raw_addr: u32,
    comp_addr: u32,
    count: usize,
) -> Result<Vec<JumpxQuatKeyDto>, String> {
    if count == 0 {
        return Ok(Vec::new());
    }
    if compressed {
        let offset = decrypt_offset(comp_addr)?;
        let mut out = Vec::with_capacity(count);
        for index in 0..count {
            let frame = sample_frame(index);
            let packed = read_u64_at(data, offset + index * 8)?;
            let angle = ((packed & 0xfff) as i16 as f32) * std::f32::consts::PI / 180.0;
            let x = (((packed >> 16) & 0xfff) as i16 as f32) / 2048.0;
            let y = (((packed >> 32) & 0xfff) as i16 as f32) / 2048.0;
            let z = (((packed >> 48) & 0xfff) as i16 as f32) / 2048.0;
            out.push(JumpxQuatKeyDto {
                frame,
                time_ms: Some(sample_time_ms(frame)),
                value: invert_quat(axis_angle_to_quat(x, y, z, angle)),
                raw_flags: 0,
            });
        }
        return Ok(out);
    }
    if raw_addr == 0 {
        return Ok(Vec::new());
    }
    let offset = decrypt_offset(raw_addr)?;
    let mut out = Vec::with_capacity(count);
    for index in 0..count {
        let frame = sample_frame(index);
        out.push(JumpxQuatKeyDto {
            frame,
            time_ms: Some(sample_time_ms(frame)),
            value: invert_quat([
                read_f32_at(data, offset + index * 16)?,
                read_f32_at(data, offset + index * 16 + 4)?,
                read_f32_at(data, offset + index * 16 + 8)?,
                read_f32_at(data, offset + index * 16 + 12)?,
            ]),
            raw_flags: 0,
        });
    }
    Ok(out)
}
