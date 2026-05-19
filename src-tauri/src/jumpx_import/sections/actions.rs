use crate::jumpx_import::binary::{checked_table_offset, read_fixed_string, read_i16_at};
use crate::jumpx_import::container::JumpxDirectory;
use crate::jumpx_import::types::JumpxActionDto;

pub(in crate::jumpx_import) fn parse_actions(
    head: &[u8],
    dir: &JumpxDirectory,
) -> Result<Vec<JumpxActionDto>, String> {
    let count = dir.get("nact") as usize;
    let mut out = Vec::with_capacity(count);
    for index in 0..count {
        let offset = checked_table_offset(dir.get("aact"), index, 0x5a, "actions")?;
        out.push(JumpxActionDto {
            action_index: index as u32,
            name: read_fixed_string(head, offset, 80)?,
            start_frame: read_i16_at(head, offset + 80)?,
            end_frame: read_i16_at(head, offset + 82)?,
            raw_flags: read_i16_at(head, offset + 84)? as u32,
            save_flags: 0,
        });
    }
    Ok(out)
}
