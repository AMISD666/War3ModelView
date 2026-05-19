use super::binary::{decode_ascii_tag, Cursor};
use flate2::read::ZlibDecoder;
use std::collections::HashMap;
use std::io::Read;

const JUMPX_FILE_HEAD: &[u8; 80] = b"JUMPX V5.01     WWW.JUMPW.COM   \xB4\xAC\xB3\xA4  \xB0\xD1\xBA\xDA\xB6\xB4\xD7\xB0\xD4\xDA\xC6\xBF\xD7\xD3\xC0\xEF\xB5\xC4\xC8\xCB!WEIBO.COM/WUYAXIT\0\0\0\0";
const JUMPX_INDEX_HEAD: &[u8; 15] = b"WUYAXI@SINA.CN\0";

#[derive(Clone)]
pub(super) struct JumpxDirectory {
    values: HashMap<String, u32>,
}

impl JumpxDirectory {
    pub(super) fn get(&self, key: &str) -> u32 {
        self.values.get(key).copied().unwrap_or(0)
    }
}

pub(super) struct ParsedContainer {
    pub(super) version: i32,
    pub(super) head_size: u32,
    pub(super) data_size: u32,
    pub(super) head_compressed_size: u32,
    pub(super) data_compressed_size: u32,
    pub(super) dir: JumpxDirectory,
    pub(super) head: Vec<u8>,
    pub(super) data: Vec<u8>,
}

pub(super) fn parse_container(bytes: &[u8]) -> Result<ParsedContainer, String> {
    let mut cursor = Cursor::new(bytes);
    let file_head = cursor.bytes(JUMPX_FILE_HEAD.len())?;
    if file_head != JUMPX_FILE_HEAD {
        return Err("Invalid JumpX file header".to_string());
    }

    let version = cursor.i32()?;
    let header_table_bytes = cursor.u32()?;
    if header_table_bytes % 12 != 0 {
        return Err("Corrupted JumpX header table size".to_string());
    }

    let mut values = HashMap::new();
    for _ in 0..(header_table_bytes / 12) {
        let tag = decode_ascii_tag(cursor.bytes(4)?);
        let value_size = cursor.u32()?;
        if value_size != 4 {
            return Err(format!(
                "Corrupted JumpX header entry {tag}: value size {value_size}"
            ));
        }
        let value = cursor.u32()?;
        values.insert(tag.clone(), value);
    }

    let head_size = cursor.u32()?;
    let data_size = cursor.u32()?;
    let head_compressed_size = cursor.u32()?;
    let data_compressed_size = cursor.u32()?;
    let head_comp = cursor.bytes(head_compressed_size as usize)?;
    let data_comp = cursor.bytes(data_compressed_size as usize)?;
    if cursor.remaining() != 0 {
        return Err("JumpX file has trailing bytes after compressed data chunks".to_string());
    }

    let head = inflate_exact(head_comp, head_size as usize, "head")?;
    let data = inflate_exact(data_comp, data_size as usize, "data")?;
    if !head.starts_with(JUMPX_INDEX_HEAD) {
        return Err("Invalid JumpX index header after decompression".to_string());
    }

    Ok(ParsedContainer {
        version,
        head_size,
        data_size,
        head_compressed_size,
        data_compressed_size,
        dir: JumpxDirectory { values },
        head,
        data,
    })
}

fn inflate_exact(input: &[u8], expected_size: usize, label: &str) -> Result<Vec<u8>, String> {
    let mut decoder = ZlibDecoder::new(input);
    let mut out = Vec::with_capacity(expected_size);
    decoder
        .read_to_end(&mut out)
        .map_err(|error| format!("Failed to inflate JumpX {label} chunk: {error}"))?;
    if out.len() != expected_size {
        return Err(format!(
            "Corrupted JumpX {label} chunk: inflated {} bytes, expected {expected_size}",
            out.len()
        ));
    }
    Ok(out)
}
