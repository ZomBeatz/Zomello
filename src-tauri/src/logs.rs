//! A small log file on this device, for bug reports: app starts, errors from the page, and crashes
//! (Rust panics, with where they happened). Nothing is sent anywhere; Settings > About can copy or
//! save it, and Send feedback can add the last lines to the email.
//!
//! The file lives in the app's log folder (`zomello.log`). At 256 KB it becomes `zomello.old.log`,
//! so the two together never pass about half a megabyte.

use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

use tauri::{AppHandle, Manager};

const FILE: &str = "zomello.log";
const OLD_FILE: &str = "zomello.old.log";
const MAX_BYTES: u64 = 256 * 1024;
/// One line from the page is at most this long (a huge error message shouldn't fill the file).
const MAX_LINE: usize = 2000;

static DIR: OnceLock<PathBuf> = OnceLock::new();
static WRITE: Mutex<()> = Mutex::new(());

/// Finds the log folder and starts logging. Called once, when the app starts.
pub fn init(app: &AppHandle) {
    if let Ok(dir) = app.path().app_log_dir() {
        if fs::create_dir_all(&dir).is_ok() {
            let _ = DIR.set(dir);
        }
    }
    let info = app.package_info();
    write("info", &format!("Zomello {} started ({} {})", info.version, std::env::consts::OS, std::env::consts::ARCH));
}

/// Writes crashes to the log before the app goes down. Set before anything else runs, so a panic
/// while starting up is caught too (it's only written once the folder is known).
pub fn catch_panics() {
    let previous = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |panic| {
        let what = panic
            .payload()
            .downcast_ref::<&str>()
            .map(|s| s.to_string())
            .or_else(|| panic.payload().downcast_ref::<String>().cloned())
            .unwrap_or_else(|| "unknown panic".into());
        let at = panic.location().map(|l| format!(" at {}:{}", l.file(), l.line())).unwrap_or_default();
        let thread = std::thread::current().name().unwrap_or("unnamed").to_string();
        write("crash", &format!("{what}{at} (thread {thread})\n{}", std::backtrace::Backtrace::force_capture()));
        previous(panic);
    }));
}

/// Adds one line: `2026-11-05 19:40:12Z [error] message`.
pub fn write(level: &str, message: &str) {
    let Some(dir) = DIR.get() else { return };
    let _lock = WRITE.lock().unwrap_or_else(|e| e.into_inner());
    let path = dir.join(FILE);
    if fs::metadata(&path).map(|m| m.len() > MAX_BYTES).unwrap_or(false) {
        let _ = fs::rename(&path, dir.join(OLD_FILE));
    }
    if let Ok(mut f) = OpenOptions::new().create(true).append(true).open(&path) {
        let _ = writeln!(f, "{} [{level}] {message}", timestamp());
    }
}

/// The page's errors and notes ("error", "warn" or "info").
#[tauri::command]
pub fn log_write(level: String, message: String) {
    let level = match level.as_str() {
        "error" | "warn" | "info" => level,
        _ => "info".into(),
    };
    let message: String = message.chars().take(MAX_LINE).collect();
    write(&level, &message);
}

/// The whole log, oldest first (the older file, then the current one).
#[tauri::command]
pub fn log_read() -> String {
    let Some(dir) = DIR.get() else { return String::new() };
    let _lock = WRITE.lock().unwrap_or_else(|e| e.into_inner());
    let old = fs::read_to_string(dir.join(OLD_FILE)).unwrap_or_default();
    let now = fs::read_to_string(dir.join(FILE)).unwrap_or_default();
    old + &now
}

/// Empties the log (Settings > About > Clear).
#[tauri::command]
pub fn log_clear() {
    let Some(dir) = DIR.get() else { return };
    let _lock = WRITE.lock().unwrap_or_else(|e| e.into_inner());
    let _ = fs::remove_file(dir.join(OLD_FILE));
    let _ = fs::remove_file(dir.join(FILE));
}

/// UTC, without pulling in a date library.
fn timestamp() -> String {
    let secs = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    let (days, rest) = (secs / 86_400, secs % 86_400);
    let (y, m, d) = civil_from_days(days as i64);
    format!("{y:04}-{m:02}-{d:02} {:02}:{:02}:{:02}Z", rest / 3600, rest % 3600 / 60, rest % 60)
}

/// Days since 1970-01-01 to a calendar date (Howard Hinnant's algorithm).
fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (yoe + era * 400 + i64::from(m <= 2), m, d)
}

#[cfg(test)]
mod tests {
    #[test]
    fn dates() {
        assert_eq!(super::civil_from_days(0), (1970, 1, 1));
        assert_eq!(super::civil_from_days(20_762), (2026, 11, 5));
        assert_eq!(super::civil_from_days(11_016), (2000, 2, 29));
    }
}
