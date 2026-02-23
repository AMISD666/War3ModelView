use std::sync::Mutex;
use wow_mpq::Archive;

pub struct MpqManager {
    archives: Mutex<Vec<MpqArchive>>,
}

struct MpqArchive {
    path: String,
    archive: Archive,
}

fn normalize_mpq_path(path: &str) -> String {
    let mut normalized = path.replace('\0', "");
    let normalized_trimmed = normalized.trim().to_string();
    normalized = normalized_trimmed.replace('/', "\\");
    if normalized.starts_with(".\\") {
        normalized = normalized[2..].to_string();
    }
    if normalized.starts_with("\\\\") {
        // MPQ internal paths should not be UNC, but keep as-is if present.
        return normalized;
    }
    while normalized.starts_with('\\') {
        normalized = normalized[1..].to_string();
    }
    while normalized.contains("\\\\") {
        normalized = normalized.replace("\\\\", "\\");
    }
    normalized
}

fn normalize_archive_fs_path(path: &str) -> String {
    path.replace('/', "\\").trim().to_lowercase()
}

fn build_mpq_candidates(path: &str) -> Vec<String> {
    let mut candidates = Vec::new();
    let normalized = normalize_mpq_path(path);
    candidates.push(normalized.clone());

    let alt_slash = normalized.replace("\\", "/");
    if alt_slash != normalized {
        candidates.push(alt_slash);
    }

    if path != normalized && !candidates.iter().any(|p| p == path) {
        candidates.push(path.to_string());
    }

    candidates
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
        archives.push(MpqArchive {
            path: path.to_string(),
            archive,
        });
        Ok(format!("Loaded MPQ: {}", path))
    }

    pub fn read_file(&self, filename: &str) -> Option<Vec<u8>> {
        let mut archives = self.archives.lock().unwrap();
        let candidates = build_mpq_candidates(filename);
        // Search in reverse order (newest loaded first)
        for archive in archives.iter_mut().rev() {
            for candidate in &candidates {
                if let Ok(data) = archive.archive.read_file(candidate) {
                    // Safety check: Limit to 50MB
                    if data.len() > 50 * 1024 * 1024 {
                        continue;
                    }
                    return Some(data);
                }
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
            let candidates = build_mpq_candidates(filename);
            // Search in reverse order (newest loaded first)
            for archive in archives.iter_mut().rev() {
                for candidate in &candidates {
                    if let Ok(data) = archive.archive.read_file(candidate) {
                        // Safety check: Limit to 50MB
                        if data.len() <= 50 * 1024 * 1024 {
                            found = Some(data);
                            break;
                        }
                    }
                }
                if found.is_some() {
                    break;
                }
            }
            results.push(found);
        }
        results
    }

    pub fn archive_count(&self) -> usize {
        let archives = self.archives.lock().unwrap();
        archives.len()
    }

    pub fn archive_paths(&self) -> Vec<String> {
        let archives = self.archives.lock().unwrap();
        archives.iter().map(|a| a.path.clone()).collect()
    }

    pub fn list_files_for_archive(&self, archive_path: &str) -> Result<Vec<String>, String> {
        let target = normalize_archive_fs_path(archive_path);
        let mut archives = self.archives.lock().unwrap();

        let archive = archives
            .iter_mut()
            .find(|item| normalize_archive_fs_path(&item.path) == target)
            .ok_or_else(|| format!("MPQ not loaded: {}", archive_path))?;

        let mut entries = archive
            .archive
            .list()
            .map_err(|e| format!("Failed to list MPQ files: {:?}", e))?
            .into_iter()
            .map(|entry| normalize_mpq_path(&entry.name))
            .collect::<Vec<_>>();

        entries.sort_unstable();
        entries.dedup();
        Ok(entries)
    }

    pub fn prioritize_archive(&self, archive_path: &str) -> Result<(), String> {
        let target = normalize_archive_fs_path(archive_path);
        let mut archives = self.archives.lock().unwrap();
        let index = archives
            .iter()
            .position(|item| normalize_archive_fs_path(&item.path) == target)
            .ok_or_else(|| format!("MPQ not loaded: {}", archive_path))?;

        if index + 1 == archives.len() {
            return Ok(());
        }

        let archive = archives.remove(index);
        archives.push(archive);
        Ok(())
    }

    pub fn probe_file(&self, filename: &str) -> (String, Vec<String>, Option<usize>, usize) {
        let mut archives = self.archives.lock().unwrap();
        let normalized = normalize_mpq_path(filename);
        let candidates = build_mpq_candidates(filename);
        let mut found_size: Option<usize> = None;

        for archive in archives.iter_mut().rev() {
            for candidate in &candidates {
                if let Ok(data) = archive.archive.read_file(candidate) {
                    if data.len() > 50 * 1024 * 1024 {
                        continue;
                    }
                    found_size = Some(data.len());
                    break;
                }
            }
            if found_size.is_some() {
                break;
            }
        }

        (normalized, candidates, found_size, archives.len())
    }
}
