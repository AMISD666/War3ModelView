use crate::jumpx_import::binary::{
    checked_table_offset, decrypt_offset, read_c_string, read_f32_at, read_i32_at, read_matrix_at,
    read_raw_data, read_u16_at, read_u32_at,
};
use crate::jumpx_import::container::JumpxDirectory;
use crate::jumpx_import::geometry_data::{
    default_single_bone_palette, read_bone_palette, read_normals, read_vec2_array, read_vertices,
    GEO_ENABLE_BONE_PALETTE, GEO_ENABLE_UV2,
};
use crate::jumpx_import::math::{
    compute_extents_from_vertices, compute_radius, identity_matrix, invert_affine_matrix,
    is_plausible_extent,
};
use crate::jumpx_import::types::JumpxGeometryDto;

fn matrix_axis_scales(matrix: &[f32; 16]) -> [f32; 3] {
    [
        (matrix[0] * matrix[0] + matrix[1] * matrix[1] + matrix[2] * matrix[2]).sqrt(),
        (matrix[4] * matrix[4] + matrix[5] * matrix[5] + matrix[6] * matrix[6]).sqrt(),
        (matrix[8] * matrix[8] + matrix[9] * matrix[9] + matrix[10] * matrix[10]).sqrt(),
    ]
}

fn read_ancestor_object_transform(
    head: &[u8],
    dir: &JumpxDirectory,
    ancestor_bone: i32,
) -> Result<([f32; 3], [f32; 3]), String> {
    if ancestor_bone < 0 || ancestor_bone >= dir.get("nbon") as i32 {
        return Ok(([0.0, 0.0, 0.0], [1.0, 1.0, 1.0]));
    }

    let bone_offset = checked_table_offset(dir.get("abon"), ancestor_bone as usize, 0xac, "geometry ancestor bone")?;
    let inverse_matrix = read_matrix_at(head, bone_offset + 24)?;
    let bind_matrix = invert_affine_matrix(inverse_matrix).unwrap_or(identity_matrix());
    let scale = matrix_axis_scales(&inverse_matrix);
    let pivot = [bind_matrix[12], bind_matrix[13], bind_matrix[14]];
    Ok((pivot, scale))
}

pub(in crate::jumpx_import) fn parse_geometries(
    head: &[u8],
    data: &[u8],
    dir: &JumpxDirectory,
) -> Result<Vec<JumpxGeometryDto>, String> {
    let count = dir.get("ngeo") as usize;
    let mut out = Vec::with_capacity(count);
    for index in 0..count {
        let offset = checked_table_offset(dir.get("ageo"), index, 0x7c, "geometries")?;
        let save_flag = read_u32_at(head, offset + 4)?;
        let name_addr = read_u32_at(head, offset + 8)?;
        let material_id = read_i32_at(head, offset + 16)?;
        let geometry_type = read_u32_at(head, offset + 20)?;
        let flag = read_u32_at(head, offset + 24)?;
        let vertex_count = read_i32_at(head, offset + 28)?.max(0) as usize;
        let face_count = read_i32_at(head, offset + 32)?.max(0) as usize;
        let vertex_addr = read_u32_at(head, offset + 36)?;
        let vertex_comp_addr = read_u32_at(head, offset + 40)?;
        let normal_addr = read_u32_at(head, offset + 44)?;
        let normal_comp_addr = read_u32_at(head, offset + 48)?;
        let uv_addr = read_u32_at(head, offset + 52)?;
        let uv1_addr = read_u32_at(head, offset + 56)?;
        let vertex_color_addr = read_u32_at(head, offset + 60)?;
        let indices_addr = read_u32_at(head, offset + 76)?;
        let ancestor_bone = read_i32_at(head, offset + 88)?;
        let bone_palette_addr = read_u32_at(head, offset + 92)?;
        let stored_maximum_extent = [
            read_f32_at(head, offset + 96)?,
            read_f32_at(head, offset + 100)?,
            read_f32_at(head, offset + 104)?,
        ];
        let stored_minimum_extent = [
            read_f32_at(head, offset + 108)?,
            read_f32_at(head, offset + 112)?,
            read_f32_at(head, offset + 116)?,
        ];
        let name = read_c_string(head, name_addr)?;
        let vertices = read_vertices(
            data,
            save_flag,
            vertex_addr,
            vertex_comp_addr,
            vertex_count,
            stored_minimum_extent,
            stored_maximum_extent,
        )?;
        let normals = read_normals(data, save_flag, normal_addr, normal_comp_addr, vertex_count)?;
        let uvs = read_vec2_array(data, uv_addr, vertex_count)?;
        let uv2 = if save_flag & GEO_ENABLE_UV2 != 0 && uv1_addr != 0 {
            Some(read_vec2_array(data, uv1_addr, vertex_count)?)
        } else {
            None
        };
        let vertex_colors = if vertex_color_addr != 0 {
            Some(
                read_raw_data(data, decrypt_offset(vertex_color_addr)?, vertex_count * 4)?.to_vec(),
            )
        } else {
            None
        };
        let indices_offset = decrypt_offset(indices_addr)?;
        let mut indices = Vec::with_capacity(face_count * 3);
        for face_index in 0..(face_count * 3) {
            indices.push(read_u16_at(data, indices_offset + face_index * 2)?);
        }
        let (skin_weight_counts, skin_bone_ids, skin_weights) =
            if save_flag & GEO_ENABLE_BONE_PALETTE != 0 && bone_palette_addr != 0 {
                read_bone_palette(data, bone_palette_addr, vertex_count)?
            } else {
                default_single_bone_palette(vertex_count, ancestor_bone)
            };
        let (minimum_extent, maximum_extent) =
            if is_plausible_extent(stored_minimum_extent, stored_maximum_extent) {
                (stored_minimum_extent, stored_maximum_extent)
            } else {
                compute_extents_from_vertices(&vertices)
            };
        let (object_pivot, object_scale) =
            read_ancestor_object_transform(head, dir, ancestor_bone)?;

        out.push(JumpxGeometryDto {
            geometry_index: index as u32,
            name,
            material_id,
            geometry_type,
            ancestor_bone_id: ancestor_bone,
            vertex_count: vertex_count as u32,
            index_count: indices.len() as u32,
            vertices,
            normals,
            uvs,
            uv2,
            vertex_colors,
            indices,
            skin_weight_stride: 4,
            skin_weight_counts,
            skin_bone_ids,
            skin_weights,
            minimum_extent,
            maximum_extent,
            bounds_radius: compute_radius(minimum_extent, maximum_extent)
                * object_scale[0].max(object_scale[1]).max(object_scale[2]),
            object_pivot,
            object_scale,
            raw_flags: flag | geometry_type,
            save_flags: save_flag,
        });
    }
    Ok(out)
}
