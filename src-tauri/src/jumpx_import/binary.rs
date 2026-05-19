const OFFSET_BIAS: u32 = 1_000_000_000;

pub(super) fn decrypt_offset(value: u32) -> Result<usize, String> {
    if value < OFFSET_BIAS {
        return Err(format!("Invalid JumpX encrypted data offset {value}"));
    }
    Ok((value - OFFSET_BIAS) as usize)
}

pub(super) fn checked_table_offset(
    base: u32,
    index: usize,
    stride: usize,
    label: &str,
) -> Result<usize, String> {
    if base == 0 && stride > 0 {
        return Err(format!("JumpX {label} table offset is zero"));
    }
    (base as usize)
        .checked_add(
            index
                .checked_mul(stride)
                .ok_or_else(|| format!("JumpX {label} table index overflow"))?,
        )
        .ok_or_else(|| format!("JumpX {label} table offset overflow"))
}

pub(super) fn read_c_string(buf: &[u8], offset: u32) -> Result<String, String> {
    read_c_string_usize(buf, offset as usize)
}

pub(super) fn read_c_string_usize(buf: &[u8], offset: usize) -> Result<String, String> {
    if offset >= buf.len() {
        return Err(format!("JumpX string offset {offset} is outside buffer"));
    }
    let end = buf[offset..]
        .iter()
        .position(|value| *value == 0)
        .map(|pos| offset + pos)
        .unwrap_or(buf.len());
    Ok(decode_lossy_ansi(&buf[offset..end]))
}

pub(super) fn read_fixed_string(buf: &[u8], offset: usize, len: usize) -> Result<String, String> {
    let raw = read_raw_data(buf, offset, len)?;
    let end = raw
        .iter()
        .position(|value| *value == 0)
        .unwrap_or(raw.len());
    Ok(decode_lossy_ansi(&raw[..end]))
}

pub(super) fn decode_ascii_tag(bytes: &[u8]) -> String {
    String::from_utf8_lossy(bytes).to_string()
}

fn decode_lossy_ansi(bytes: &[u8]) -> String {
    String::from_utf8_lossy(bytes)
        .trim_end_matches('\0')
        .to_string()
}

pub(super) struct Cursor<'a> {
    bytes: &'a [u8],
    pos: usize,
}

impl<'a> Cursor<'a> {
    pub(super) fn new(bytes: &'a [u8]) -> Self {
        Self { bytes, pos: 0 }
    }

    pub(super) fn remaining(&self) -> usize {
        self.bytes.len().saturating_sub(self.pos)
    }

    pub(super) fn bytes(&mut self, len: usize) -> Result<&'a [u8], String> {
        let end = self
            .pos
            .checked_add(len)
            .ok_or_else(|| "JumpX cursor overflow".to_string())?;
        if end > self.bytes.len() {
            return Err("Unexpected end of JumpX file".to_string());
        }
        let out = &self.bytes[self.pos..end];
        self.pos = end;
        Ok(out)
    }

    pub(super) fn u32(&mut self) -> Result<u32, String> {
        let bytes = self.bytes(4)?;
        Ok(u32::from_le_bytes(bytes.try_into().unwrap()))
    }

    pub(super) fn i32(&mut self) -> Result<i32, String> {
        let bytes = self.bytes(4)?;
        Ok(i32::from_le_bytes(bytes.try_into().unwrap()))
    }
}

pub(super) fn read_raw_data(buf: &[u8], offset: usize, len: usize) -> Result<&[u8], String> {
    let end = offset
        .checked_add(len)
        .ok_or_else(|| "JumpX buffer range overflow".to_string())?;
    if end > buf.len() {
        return Err(format!(
            "JumpX read out of bounds: offset {offset}, len {len}, buffer {}",
            buf.len()
        ));
    }
    Ok(&buf[offset..end])
}

pub(super) fn read_u8_at(buf: &[u8], offset: usize) -> Result<u8, String> {
    Ok(*read_raw_data(buf, offset, 1)?.first().unwrap())
}

pub(super) fn read_i8_at(buf: &[u8], offset: usize) -> Result<i8, String> {
    Ok(read_u8_at(buf, offset)? as i8)
}

pub(super) fn read_u16_at(buf: &[u8], offset: usize) -> Result<u16, String> {
    Ok(u16::from_le_bytes(
        read_raw_data(buf, offset, 2)?.try_into().unwrap(),
    ))
}

pub(super) fn read_i16_at(buf: &[u8], offset: usize) -> Result<i16, String> {
    Ok(i16::from_le_bytes(
        read_raw_data(buf, offset, 2)?.try_into().unwrap(),
    ))
}

pub(super) fn read_u32_at(buf: &[u8], offset: usize) -> Result<u32, String> {
    Ok(u32::from_le_bytes(
        read_raw_data(buf, offset, 4)?.try_into().unwrap(),
    ))
}

pub(super) fn read_i32_at(buf: &[u8], offset: usize) -> Result<i32, String> {
    Ok(i32::from_le_bytes(
        read_raw_data(buf, offset, 4)?.try_into().unwrap(),
    ))
}

pub(super) fn read_u64_at(buf: &[u8], offset: usize) -> Result<u64, String> {
    Ok(u64::from_le_bytes(
        read_raw_data(buf, offset, 8)?.try_into().unwrap(),
    ))
}

pub(super) fn read_f32_at(buf: &[u8], offset: usize) -> Result<f32, String> {
    Ok(f32::from_le_bytes(
        read_raw_data(buf, offset, 4)?.try_into().unwrap(),
    ))
}

pub(super) fn read_u32x3_at(buf: &[u8], offset: usize) -> Result<[u32; 3], String> {
    Ok([
        read_u32_at(buf, offset)?,
        read_u32_at(buf, offset + 4)?,
        read_u32_at(buf, offset + 8)?,
    ])
}

pub(super) fn read_i32x3_at(buf: &[u8], offset: usize) -> Result<[i32; 3], String> {
    Ok([
        read_i32_at(buf, offset)?,
        read_i32_at(buf, offset + 4)?,
        read_i32_at(buf, offset + 8)?,
    ])
}

pub(super) fn read_matrix_at(buf: &[u8], offset: usize) -> Result<[f32; 16], String> {
    let mut out = [0.0; 16];
    for (index, value) in out.iter_mut().enumerate() {
        *value = read_f32_at(buf, offset + index * 4)?;
    }
    Ok(out)
}
