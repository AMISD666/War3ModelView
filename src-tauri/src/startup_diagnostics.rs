use once_cell::sync::Lazy;
use serde_json::Value;
use std::fs::OpenOptions;
use std::io::Write;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{Instant, SystemTime, UNIX_EPOCH};

static STARTUP_BEGIN: Lazy<Instant> = Lazy::new(Instant::now);
static LOG_LOCK: Lazy<Mutex<()>> = Lazy::new(|| Mutex::new(()));

const LOG_FILE_NAME: &str = "startup_diagnostics.log";

fn log_path() -> Option<PathBuf> {
    let exe_path = std::env::current_exe().ok()?;
    exe_path.parent().map(|dir| dir.join(LOG_FILE_NAME))
}

fn epoch_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
}

fn elapsed_ms() -> u128 {
    STARTUP_BEGIN.elapsed().as_millis()
}

fn sanitize_line(value: &str) -> String {
    value.replace('\r', " ").replace('\n', " ")
}

pub fn reset_log() {
    let _guard = LOG_LOCK.lock().ok();
    if let Some(path) = log_path() {
        let header = format!(
            "War3ModelView startup diagnostics\nlogPath={}\nepochMs={}\n\n",
            path.display(),
            epoch_ms()
        );
        let _ = std::fs::write(path, header);
    }
}

pub fn mark(mark: &str, detail: Value) {
    let _guard = LOG_LOCK.lock().ok();
    let Some(path) = log_path() else {
        return;
    };
    let detail_text = sanitize_line(&detail.to_string());
    let line = format!(
        "[{:>8}ms][{}] {} {}\n",
        elapsed_ms(),
        epoch_ms(),
        sanitize_line(mark),
        detail_text
    );
    let _ = OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .and_then(|mut file| file.write_all(line.as_bytes()));
}

#[tauri::command]
pub fn startup_diagnostics_mark(mark: String, detail: Option<Value>) {
    self::mark(&mark, detail.unwrap_or(Value::Null));
}
