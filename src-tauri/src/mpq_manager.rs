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
        let mut archives = self.archives.lock().unwrap();
        // Search in reverse order (newest loaded first)
        for archive in archives.iter_mut().rev() {
            if let Ok(data) = archive.read_file(filename) {
                // Safety check: Limit to 50MB
                if data.len() > 50 * 1024 * 1024 {
                    continue;
                }
                return Some(data);
            }
        }
        None
    }

    /// Read multiple files in a single batch operation
    /// Returns a Vec of Option<Vec<u8>> in the same order as input paths
    pub fn read_files_batch(&self, filenames: &[String]) -> Vec<Option<Vec<u8>>> {
        let mut archives = self.archives.lock().unwrap();
        let mut results = Vec::with_capacity(filenames.len());
        
        for filename in filenames {
            let mut found = None;
            // Search in reverse order (newest loaded first)
            for archive in archives.iter_mut().rev() {
                if let Ok(data) = archive.read_file(filename) {
                    // Safety check: Limit to 50MB
                    if data.len() <= 50 * 1024 * 1024 {
                        found = Some(data);
                        break;
                    }
                }
            }
            results.push(found);
        }
        results
    }
}
