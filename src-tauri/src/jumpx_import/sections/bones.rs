use crate::jumpx_import::binary::{
    checked_table_offset, read_c_string, read_i32_at, read_matrix_at, read_u32_at,
};
use crate::jumpx_import::container::JumpxDirectory;
use crate::jumpx_import::geometry_data::{
    read_quat_keys, read_vec3_keys, read_visibility_keys, GEO_COMPRESSED_NORMAL,
    GEO_COMPRESSED_VERTEX,
};
use crate::jumpx_import::math::{identity_matrix, invert_affine_matrix};
use crate::jumpx_import::types::{JumpxBoneDto, JumpxBoneGroupDto};

pub(in crate::jumpx_import) fn parse_bones(
    head: &[u8],
    data: &[u8],
    dir: &JumpxDirectory,
) -> Result<Vec<JumpxBoneDto>, String> {
    let count = dir.get("nbon") as usize;
    let mut out = Vec::with_capacity(count);
    for index in 0..count {
        let offset = checked_table_offset(dir.get("abon"), index, 0xac, "bones")?;
        let save_flag = read_u32_at(head, offset + 4)?;
        let name_addr = read_u32_at(head, offset + 8)?;
        let parent_id = read_i32_at(head, offset + 12)?;
        let num_key = read_i32_at(head, offset + 16)?.max(0) as usize;
        let inverse_matrix = read_matrix_at(head, offset + 24)?;
        let bind_matrix = invert_affine_matrix(inverse_matrix).unwrap_or(identity_matrix());
        let pivot = [bind_matrix[12], bind_matrix[13], bind_matrix[14]];
        let child_count = read_i32_at(head, offset + 116)?.max(0) as usize;
        let child_addr = read_u32_at(head, offset + 120)?;
        let visible_count = read_i32_at(head, offset + 132)?.max(0) as usize;
        let visible_addr = read_u32_at(head, offset + 136)?;
        let pos_count = read_i32_at(head, offset + 140)?.max(0) as usize;
        let pos_addr = read_u32_at(head, offset + 144)?;
        let pos_comp_addr = read_u32_at(head, offset + 148)?;
        let rot_count = read_i32_at(head, offset + 152)?.max(0) as usize;
        let rot_addr = read_u32_at(head, offset + 156)?;
        let rot_comp_addr = read_u32_at(head, offset + 160)?;
        let scale_count = read_i32_at(head, offset + 164)?.max(0) as usize;
        let scale_addr = read_u32_at(head, offset + 168)?;

        let mut children = Vec::with_capacity(child_count);
        if child_count > 0 && child_addr != 0 {
            let child_offset = child_addr as usize;
            for child_index in 0..child_count {
                children.push(read_i32_at(head, child_offset + child_index * 4)?);
            }
        }

        let visibility_keys = read_visibility_keys(data, visible_addr, visible_count)?;
        let position_keys = read_vec3_keys(
            data,
            save_flag & GEO_COMPRESSED_VERTEX != 0 && pos_addr == 0,
            pos_addr,
            pos_comp_addr,
            pos_count,
            None,
        )?;
        let rotation_keys = read_quat_keys(
            data,
            save_flag & GEO_COMPRESSED_NORMAL != 0 && rot_addr == 0,
            rot_addr,
            rot_comp_addr,
            rot_count,
        )?;
        let scale_keys = read_vec3_keys(data, false, scale_addr, 0, scale_count, None)?;

        out.push(JumpxBoneDto {
            bone_index: index as u32,
            name: read_c_string(head, name_addr)?,
            parent_id,
            world_translation: pivot,
            local_translation: None,
            inverse_bind_matrix: Some(inverse_matrix.to_vec()),
            bind_matrix: Some(bind_matrix.to_vec()),
            raw_flags: if num_key > 0 { 1 } else { 0 },
            save_flags: save_flag,
            position_keys,
            rotation_keys,
            scale_keys,
            visibility_keys,
        });
    }
    Ok(out)
}

pub(in crate::jumpx_import) fn parse_bone_groups(
    head: &[u8],
    dir: &JumpxDirectory,
) -> Result<Vec<JumpxBoneGroupDto>, String> {
    let count = dir.get("nbgp") as usize;
    let mut out = Vec::with_capacity(count);
    for index in 0..count {
        let offset = checked_table_offset(dir.get("abgp"), index, 0x0c, "bone groups")?;
        let _data_addr = read_u32_at(head, offset)?;
        let bone_count = read_i32_at(head, offset + 4)?.max(0) as usize;
        let bone_addr = read_u32_at(head, offset + 8)?;
        let mut bone_ids = Vec::with_capacity(bone_count);
        for bone_index in 0..bone_count {
            let value = read_i32_at(head, bone_addr as usize + bone_index * 4)?;
            if value >= 0 {
                bone_ids.push(value as u32);
            }
        }
        out.push(JumpxBoneGroupDto {
            bone_group_index: index as u32,
            name: format!("JumpX_BoneGroup_{index}"),
            bone_ids,
            raw_flags: 0,
            save_flags: 0,
        });
    }
    Ok(out)
}
