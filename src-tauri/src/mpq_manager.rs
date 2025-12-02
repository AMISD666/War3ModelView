use std::sync::Mutex;
use wow_mpq::Archive;

pub struct MpqManager {
    archives: Mutex<Vec<Archive>>,
}

impl MpqManager {
    pub fn new() -> Self {
        Self {
            archives: Mutex::new(Vec::new()),
        }
    }

    pub fn add_archive(&self, path: &str) -> Result<String, String> {
        // wow_mpq::Archive::open takes a path
        let archive = Archive::open(path).map_err(|e| format!("Failed to open MPQ: {:?}", e))?;
        
        let mut archives = self.archives.lock().unwrap();
        archives.push(archive);
        Ok(format!("Loaded MPQ: {}", path))
    }

    pub fn read_file(&self, filename: &str) -> Option<Vec<u8>> {
        println!("[Rust] MpqManager::read_file called for: {}", filename);
        let mut archives = self.archives.lock().unwrap();
        // Search in reverse order (newest loaded first)
        for (i, archive) in archives.iter_mut().rev().enumerate() {
            // wow_mpq usually has a read_file or similar method
            // Based on common Rust MPQ crates, let's try read_file
            if let Ok(data) = archive.read_file(filename) {
                println!("[Rust] Found file in archive {}", i);
                println!("[Rust] Successfully read {} bytes", data.len());
                
                // Safety check: Limit to 50MB
                if data.len() > 50 * 1024 * 1024 {
                     println!("[Rust] File too large, skipping: {} bytes", data.len());
                     continue;
                }

                return Some(data);
            }
        }
        println!("[Rust] File not found in any archive: {}", filename);
        None
    }
}
