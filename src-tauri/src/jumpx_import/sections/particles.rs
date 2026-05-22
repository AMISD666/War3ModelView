use crate::jumpx_import::binary::{
    checked_table_offset, decrypt_offset, read_f32_at, read_fixed_string, read_i32_at,
    read_i32x3_at, read_u32_at, read_u32x3_at,
};
use crate::jumpx_import::container::JumpxDirectory;
use crate::jumpx_import::geometry_data::{DEFAULT_SAMPLE_FPS, DEFAULT_SAMPLE_START_FRAME};
use crate::jumpx_import::types::{JumpxParticleDto, JumpxScalarKeyDto};

const VISIBILITY_TRACK_LINE_TYPE: u32 = 0;
const UNINITIALIZED_PRIORITY_PLANE_I32: i32 = i32::from_ne_bytes([0xcd, 0xcd, 0xcd, 0xcd]);

fn normalize_priority_plane(value: i32) -> i32 {
    if value == UNINITIALIZED_PRIORITY_PLANE_I32 {
        0
    } else {
        value
    }
}

pub(in crate::jumpx_import) fn parse_particles(
    head: &[u8],
    data: &[u8],
    dir: &JumpxDirectory,
    version: i32,
) -> Result<Vec<JumpxParticleDto>, String> {
    let count = dir.get("nprt") as usize;
    let stride = if version >= 8 { 0x42c } else { 0x418 };
    let mut out = Vec::with_capacity(count);
    for index in 0..count {
        let offset = checked_table_offset(dir.get("aprt"), index, stride, "particles")?;
        let data_addr = read_u32_at(head, offset)?;
        let flag = read_u32_at(head, offset + 4)?;
        let name = read_fixed_string(head, offset + 8, 80)?;
        let parent_bone_id = read_i32_at(head, offset + 88)?;
        let pivot = [
            read_f32_at(head, offset + 92)?,
            read_f32_at(head, offset + 96)?,
            read_f32_at(head, offset + 100)?,
        ];
        let count_value = read_i32_at(head, offset + 104)?;
        let speed = read_f32_at(head, offset + 108)?;
        let speed_variation = read_f32_at(head, offset + 112)?;
        let cone_angle = read_f32_at(head, offset + 116)?;
        let gravity = read_f32_at(head, offset + 120)?;
        let life_span = read_f32_at(head, offset + 124)?;
        let emission_rate = read_f32_at(head, offset + 128)?;
        let width = read_f32_at(head, offset + 132)?;
        let height = read_f32_at(head, offset + 136)?;
        let blend_mode = read_u32_at(head, offset + 140)?;
        let rows = read_i32_at(head, offset + 144)?;
        let columns = read_i32_at(head, offset + 148)?;
        let part_flag = read_u32_at(head, offset + 152)?;
        let tail_length = read_f32_at(head, offset + 156)?;
        let middle_time = read_f32_at(head, offset + 160)?;
        let start_color = read_i32x3_at(head, offset + 164)?;
        let mid_color = read_i32x3_at(head, offset + 176)?;
        let end_color = read_i32x3_at(head, offset + 188)?;
        let alpha = read_i32x3_at(head, offset + 200)?;
        let particle_scaling = [
            read_f32_at(head, offset + 212)?,
            read_f32_at(head, offset + 216)?,
            read_f32_at(head, offset + 220)?,
        ];
        let life_span_head_uv_anim = read_u32x3_at(head, offset + 228)?;
        let decay_head_uv_anim = read_u32x3_at(head, offset + 240)?;
        let life_span_tail_uv_anim = read_u32x3_at(head, offset + 252)?;
        let decay_tail_uv_anim = read_u32x3_at(head, offset + 264)?;
        let texture_id = read_i32_at(head, offset + 276)?;
        let priority_plane = normalize_priority_plane(read_i32_at(head, offset + 280)?);
        let normal = [
            read_f32_at(head, offset + 284)?,
            read_f32_at(head, offset + 288)?,
            read_f32_at(head, offset + 292)?,
        ];
        let x_axis = [
            read_f32_at(head, offset + 296)?,
            read_f32_at(head, offset + 300)?,
            read_f32_at(head, offset + 304)?,
        ];
        let y_axis = [
            read_f32_at(head, offset + 308)?,
            read_f32_at(head, offset + 312)?,
            read_f32_at(head, offset + 316)?,
        ];
        let rot_vec = [
            read_f32_at(head, offset + 320)?,
            read_f32_at(head, offset + 324)?,
            read_f32_at(head, offset + 328)?,
        ];
        let rot_vel = [
            read_f32_at(head, offset + 332)?,
            read_f32_at(head, offset + 336)?,
            read_f32_at(head, offset + 340)?,
        ];
        let enable_life_random_offset = offset + 0x418;
        let life_random = if version >= 8 && read_u32_at(head, enable_life_random_offset)? != 0 {
            Some([
                read_f32_at(head, enable_life_random_offset + 4)?,
                read_f32_at(head, enable_life_random_offset + 8)?,
            ])
        } else {
            None
        };
        let gravity_x = if version >= 8 {
            Some(read_f32_at(head, enable_life_random_offset + 12)?)
        } else {
            None
        };
        let gravity_y = if version >= 8 {
            Some(read_f32_at(head, enable_life_random_offset + 16)?)
        } else {
            None
        };
        let mut unsupported_notes = Vec::new();
        if count_value > 0 {
            unsupported_notes.push(format!(
                "JumpX particle count field {count_value} is used as a runtime capacity hint only."
            ));
        }
        let visibility_keys = read_parent_visibility_keys(head, data, dir, parent_bone_id)?;
        let emission_rate_keys = visibility_keys
            .iter()
            .map(|key| JumpxScalarKeyDto {
                frame: key.frame,
                time_ms: key.time_ms,
                value: if key.value > 0.0 { emission_rate } else { 0.0 },
                raw_flags: key.raw_flags,
            })
            .collect();

        out.push(JumpxParticleDto {
            particle_index: index as u32,
            name,
            parent_bone_id,
            pivot,
            texture_id,
            raw_flags: flag,
            save_flags: 0,
            raw_data_addr: data_addr,
            particle_flags: flag,
            blend_mode,
            part_flags: part_flag,
            emission_rate,
            speed,
            speed_variation,
            cone_angle,
            gravity,
            gravity_x,
            gravity_y,
            life_random,
            life_span,
            width,
            height,
            rows,
            columns,
            priority_plane,
            start_color,
            mid_color,
            end_color,
            alpha,
            particle_scaling,
            middle_time,
            tail_length,
            normal,
            x_axis,
            y_axis,
            rot_vec,
            rot_vel,
            life_span_head_uv_anim,
            decay_head_uv_anim,
            life_span_tail_uv_anim,
            decay_tail_uv_anim,
            emission_rate_keys,
            visibility_keys,
            unsupported_notes: Some(unsupported_notes).filter(|notes| !notes.is_empty()),
        });
    }
    Ok(out)
}

fn read_parent_visibility_keys(
    head: &[u8],
    data: &[u8],
    dir: &JumpxDirectory,
    parent_bone_id: i32,
) -> Result<Vec<JumpxScalarKeyDto>, String> {
    if parent_bone_id < 0 {
        return Ok(Vec::new());
    }
    let bone_index = parent_bone_id as usize;
    if bone_index >= dir.get("nbon") as usize {
        return Ok(Vec::new());
    }
    let bone_offset = checked_table_offset(dir.get("abon"), bone_index, 0xac, "particle parent bone")?;
    let visible_count = read_i32_at(head, bone_offset + 132)?.max(0) as usize;
    let visible_addr = read_u32_at(head, bone_offset + 136)?;
    if visible_count == 0 || visible_addr == 0 {
        return Ok(Vec::new());
    }
    let offset = decrypt_offset(visible_addr)?;
    let mut out = Vec::with_capacity(visible_count);
    for index in 0..visible_count {
        let frame = DEFAULT_SAMPLE_START_FRAME + index as u32;
        out.push(JumpxScalarKeyDto {
            frame,
            time_ms: Some(frame as f32 * 1000.0 / DEFAULT_SAMPLE_FPS),
            value: if read_u32_at(data, offset + index * 4)? > 0 { 1.0 } else { 0.0 },
            raw_flags: VISIBILITY_TRACK_LINE_TYPE,
        });
    }
    Ok(out)
}
