use crate::jumpx_import::binary::{
    checked_table_offset, read_c_string, read_f32_at, read_fixed_string, read_i32_at,
    read_matrix_at, read_u32_at,
};
use crate::jumpx_import::container::JumpxDirectory;
use crate::jumpx_import::types::{JumpxAttachmentDto, JumpxRibbonDto};

pub(in crate::jumpx_import) fn parse_attachments(
    head: &[u8],
    dir: &JumpxDirectory,
) -> Result<Vec<JumpxAttachmentDto>, String> {
    let count = dir.get("natt") as usize;
    let mut out = Vec::with_capacity(count);
    for index in 0..count {
        let offset = checked_table_offset(dir.get("aatt"), index, 0x98, "attachments")?;
        let data_addr = read_u32_at(head, offset)?;
        let parent_bone_id = read_i32_at(head, offset + 4)?;
        let name = read_fixed_string(head, offset + 8, 80)?;
        let matrix = read_matrix_at(head, offset + 88)?;
        out.push(JumpxAttachmentDto {
            attachment_index: index as u32,
            name,
            parent_bone_id,
            path: String::new(),
            pivot: [matrix[12], matrix[13], matrix[14]],
            raw_flags: data_addr,
            save_flags: 0,
        });
    }
    Ok(out)
}

pub(in crate::jumpx_import) fn parse_ribbons(
    head: &[u8],
    dir: &JumpxDirectory,
) -> Result<Vec<JumpxRibbonDto>, String> {
    let count = dir.get("nrib") as usize;
    let mut out = Vec::with_capacity(count);
    for index in 0..count {
        let offset = checked_table_offset(dir.get("arib"), index, 0x3c, "ribbons")?;
        let data_addr = read_u32_at(head, offset)?;
        let start_pos = [
            read_f32_at(head, offset + 4)?,
            read_f32_at(head, offset + 8)?,
            read_f32_at(head, offset + 12)?,
        ];
        let name_addr = read_u32_at(head, offset + 28)?;
        let parent_bone_id = read_i32_at(head, offset + 32)?;
        let texture_slot = read_i32_at(head, offset + 36)?;
        let blend_mode = read_u32_at(head, offset + 48)?;
        out.push(JumpxRibbonDto {
            ribbon_index: index as u32,
            name: read_c_string(head, name_addr)?,
            parent_bone_id,
            material_id: texture_slot,
            texture_slot,
            pivot: start_pos,
            raw_flags: blend_mode,
            save_flags: data_addr,
        });
    }
    Ok(out)
}
