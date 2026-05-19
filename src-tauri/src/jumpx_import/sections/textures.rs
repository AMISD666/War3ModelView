use crate::jumpx_import::binary::{checked_table_offset, read_c_string, read_u32_at};
use crate::jumpx_import::container::JumpxDirectory;
use crate::jumpx_import::types::JumpxTextureDto;

pub(in crate::jumpx_import) fn parse_textures(
    head: &[u8],
    dir: &JumpxDirectory,
) -> Result<Vec<JumpxTextureDto>, String> {
    let count = dir.get("ntex") as usize;
    let mut out = Vec::with_capacity(count);
    for index in 0..count {
        let offset = checked_table_offset(dir.get("atex"), index, 8, "textures")?;
        let data_addr = read_u32_at(head, offset)?;
        let name_addr = read_u32_at(head, offset + 4)?;
        let name = read_c_string(head, name_addr)?;
        out.push(JumpxTextureDto {
            texture_index: index as u32,
            path: name.clone(),
            name,
            raw_flags: data_addr,
            save_flags: 0,
        });
    }
    Ok(out)
}
