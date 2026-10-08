use serde::Serialize;
use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};

const DATA_FILE: &str = "planwise.json";
const BACKUP_DIR: &str = "backups";
/// Minimum seconds between automatic backups.
const BACKUP_INTERVAL: u64 = 30 * 60;
const MAX_BACKUPS: usize = 30;

fn data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// Write via a temp file + rename so a crash never leaves a half-written file.
fn atomic_write(path: &PathBuf, contents: &str) -> Result<(), String> {
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, contents).map_err(|e| e.to_string())?;
    fs::rename(&tmp, path).map_err(|e| e.to_string())
}

/// Backup files are named `backup-<unix seconds>.json`, newest last after sorting.
fn backup_files(dir: &PathBuf) -> Vec<(u64, PathBuf)> {
    let mut files: Vec<(u64, PathBuf)> = fs::read_dir(dir)
        .map(|rd| {
            rd.filter_map(|e| e.ok())
                .filter_map(|e| {
                    let name = e.file_name().to_string_lossy().to_string();
                    let ts = name.strip_prefix("backup-")?.strip_suffix(".json")?.parse().ok()?;
                    Some((ts, e.path()))
                })
                .collect()
        })
        .unwrap_or_default();
    files.sort_by_key(|(ts, _)| *ts);
    files
}

fn maybe_backup(dir: &PathBuf, contents: &str) -> Result<(), String> {
    let bdir = dir.join(BACKUP_DIR);
    fs::create_dir_all(&bdir).map_err(|e| e.to_string())?;
    let files = backup_files(&bdir);
    let now = now_secs();
    if files.last().map_or(true, |(ts, _)| now.saturating_sub(*ts) >= BACKUP_INTERVAL) {
        fs::write(bdir.join(format!("backup-{now}.json")), contents).map_err(|e| e.to_string())?;
        let files = backup_files(&bdir);
        if files.len() > MAX_BACKUPS {
            for (_, p) in &files[..files.len() - MAX_BACKUPS] {
                let _ = fs::remove_file(p);
            }
        }
    }
    Ok(())
}

#[tauri::command]
fn load_data(app: AppHandle) -> Result<Option<String>, String> {
    let path = data_dir(&app)?.join(DATA_FILE);
    if !path.exists() {
        return Ok(None);
    }
    fs::read_to_string(path).map(Some).map_err(|e| e.to_string())
}

#[tauri::command]
fn save_data(app: AppHandle, data: String) -> Result<(), String> {
    serde_json::from_str::<serde_json::Value>(&data).map_err(|e| format!("refusing to save invalid JSON: {e}"))?;
    let dir = data_dir(&app)?;
    atomic_write(&dir.join(DATA_FILE), &data)?;
    maybe_backup(&dir, &data)
}

/// Writes an export file to the user's Downloads folder (falls back to the data dir).
#[tauri::command]
fn export_data(app: AppHandle, data: String, file_name: String) -> Result<String, String> {
    let safe: String = file_name
        .chars()
        .map(|c| if c.is_alphanumeric() || "-_.".contains(c) { c } else { '_' })
        .collect();
    let dir = app.path().download_dir().or_else(|_| data_dir(&app))?;
    let path = dir.join(safe);
    fs::write(&path, data).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().to_string())
}

#[derive(Serialize)]
struct BackupInfo {
    timestamp: u64,
    size: u64,
}

#[tauri::command]
fn list_backups(app: AppHandle) -> Result<Vec<BackupInfo>, String> {
    let bdir = data_dir(&app)?.join(BACKUP_DIR);
    Ok(backup_files(&bdir)
        .into_iter()
        .rev()
        .map(|(timestamp, p)| BackupInfo {
            timestamp,
            size: fs::metadata(p).map(|m| m.len()).unwrap_or(0),
        })
        .collect())
}

#[tauri::command]
fn read_backup(app: AppHandle, timestamp: u64) -> Result<String, String> {
    let path = data_dir(&app)?.join(BACKUP_DIR).join(format!("backup-{timestamp}.json"));
    fs::read_to_string(path).map_err(|e| e.to_string())
}

#[tauri::command]
fn data_location(app: AppHandle) -> Result<String, String> {
    Ok(data_dir(&app)?.join(DATA_FILE).to_string_lossy().to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // WebKitGTK's DMA-BUF renderer shows a blank window on many NVIDIA/Wayland setups.
    #[cfg(target_os = "linux")]
    if std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none() {
        std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            load_data,
            save_data,
            export_data,
            list_backups,
            read_backup,
            data_location
        ])
        .run(tauri::generate_context!())
        .expect("error while running Planwise");
}
