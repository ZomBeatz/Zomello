use serde::Serialize;
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};

mod calendar;
#[cfg(desktop)]
mod desktop;
#[cfg(desktop)]
mod link;
#[cfg(desktop)]
mod remote;
mod link_client;
mod places;
mod private;
mod servers;

const DATA_FILE: &str = "zomello.json";
const BACKUP_DIR: &str = "backups";
const ATTACH_DIR: &str = "attachments";
/// Minimum seconds between automatic backups.
const BACKUP_INTERVAL: u64 = 30 * 60;
const MAX_BACKUPS: usize = 30;

/// Where the app lived before it was renamed from Planwise.
const LEGACY_DIR: &str = "com.zombeatz.planwise";
const LEGACY_FILE: &str = "planwise.json";

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
fn atomic_write(path: &Path, contents: &[u8]) -> Result<(), String> {
    let tmp = path.with_extension("tmp");
    fs::write(&tmp, contents).map_err(|e| e.to_string())?;
    fs::rename(&tmp, path).map_err(|e| e.to_string())
}

/// One-time copy of Planwise data (and backups) into the Zomello data dir.
fn migrate_legacy(dir: &Path) {
    let target = dir.join(DATA_FILE);
    if target.exists() {
        return;
    }
    let Some(legacy) = dir.parent().map(|p| p.join(LEGACY_DIR)) else { return };
    if let Ok(data) = fs::read(legacy.join(LEGACY_FILE)) {
        let _ = atomic_write(&target, &data);
        let (from, to) = (legacy.join(BACKUP_DIR), dir.join(BACKUP_DIR));
        if let (Ok(rd), Ok(())) = (fs::read_dir(&from), fs::create_dir_all(&to)) {
            for e in rd.flatten() {
                let _ = fs::copy(e.path(), to.join(e.file_name()));
            }
        }
    }
}

/// Backup files are named `backup-<unix seconds>.json`, oldest first after sorting.
fn backup_files(dir: &Path) -> Vec<(u64, PathBuf)> {
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

fn maybe_backup(dir: &Path, contents: &str) -> Result<(), String> {
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

fn safe_name(name: &str) -> String {
    let s: String = name
        .chars()
        .map(|c| if c.is_alphanumeric() || "-_. ".contains(c) { c } else { '_' })
        .collect();
    let s = s.trim().trim_start_matches('.').to_string();
    if s.is_empty() { "file".into() } else { s.chars().take(120).collect() }
}

/// Resolve `attachments/...` relative paths, refusing anything that escapes the folder.
fn attachment_path(app: &AppHandle, rel: &str) -> Result<PathBuf, String> {
    let rel = Path::new(rel);
    if !rel.starts_with(ATTACH_DIR) || rel.components().any(|c| !matches!(c, Component::Normal(_))) {
        return Err("invalid attachment path".into());
    }
    Ok(data_dir(app)?.join(rel))
}

/// The data file's contents ("" if there is none yet).
fn read_data(app: &AppHandle) -> Result<String, String> {
    let path = data_dir(app)?.join(DATA_FILE);
    if !path.exists() {
        return Ok(String::new());
    }
    fs::read_to_string(path).map_err(|e| e.to_string())
}

fn write_data(app: &AppHandle, data: &str) -> Result<(), String> {
    serde_json::from_str::<serde_json::Value>(data).map_err(|e| format!("refusing to save invalid JSON: {e}"))?;
    let dir = data_dir(app)?;
    atomic_write(&dir.join(DATA_FILE), data.as_bytes())?;
    maybe_backup(&dir, data)
}

/// Store raw bytes as a new attachment; returns `attachments/<id>/<name>`.
fn store_bytes(app: &AppHandle, name: &str, bytes: &[u8]) -> Result<String, String> {
    let rel = new_attachment_rel(name);
    let abs = data_dir(app)?.join(&rel);
    fs::create_dir_all(abs.parent().unwrap()).map_err(|e| e.to_string())?;
    fs::write(&abs, bytes).map_err(|e| e.to_string())?;
    Ok(rel.to_string_lossy().replace('\\', "/"))
}

#[tauri::command]
fn load_data(app: AppHandle) -> Result<Option<String>, String> {
    let dir = data_dir(&app)?;
    migrate_legacy(&dir);
    let path = dir.join(DATA_FILE);
    if !path.exists() {
        return Ok(None);
    }
    fs::read_to_string(path).map(Some).map_err(|e| e.to_string())
}

#[tauri::command]
fn save_data(app: AppHandle, data: String) -> Result<(), String> {
    write_data(&app, &data)?;
    #[cfg(desktop)]
    remote::notify_desktop_save(&app, &data);
    // Phones: a computer showing this phone's boards gets the change.
    link_client::data_changed();
    Ok(())
}

/// Writes an export file to the user's Downloads folder (falls back to the data dir).
#[tauri::command]
fn export_data(app: AppHandle, data: String, file_name: String) -> Result<String, String> {
    let dir = app.path().download_dir().or_else(|_| data_dir(&app))?;
    let path = dir.join(safe_name(&file_name));
    fs::write(&path, data).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().to_string())
}

/// Writes a binary export (a `.zomello` board file) to Downloads; raw body, name in `x-name`.
/// Returns the full path, so the app can offer to show it in the file manager.
#[tauri::command]
fn export_bytes(app: AppHandle, request: tauri::ipc::Request) -> Result<String, String> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("expected a raw file body".into());
    };
    let name = request.headers().get("x-name").and_then(|v| v.to_str().ok()).map(percent_decode).unwrap_or_else(|| "board.zomello".into());
    let dir = app.path().download_dir().or_else(|_| data_dir(&app))?;
    let path = unused_path(&dir, &safe_name(&name));
    fs::write(&path, bytes).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().to_string())
}

/// `name.ext`, or `name (2).ext` etc. if that's taken, so an export never overwrites another file.
fn unused_path(dir: &Path, name: &str) -> PathBuf {
    let first = dir.join(name);
    if !first.exists() {
        return first;
    }
    let (stem, ext) = match name.rsplit_once('.') {
        Some((s, e)) => (s.to_string(), format!(".{e}")),
        None => (name.to_string(), String::new()),
    };
    (2..1000).map(|n| dir.join(format!("{stem} ({n}){ext}"))).find(|p| !p.exists()).unwrap_or(first)
}

// ---- Board files opened from the file manager ----

/// `.zomello` files the system asked us to open that the page hasn't picked up yet.
static OPENED: std::sync::Mutex<Vec<String>> = std::sync::Mutex::new(Vec::new());

/// Board files among launch arguments (Windows/Linux pass the file as an argument; it may be a file:// URL).
#[cfg(any(desktop, target_os = "ios"))]
fn board_files_in(args: impl IntoIterator<Item = String>) -> Vec<String> {
    args.into_iter()
        .map(|a| match a.strip_prefix("file://") {
            Some(rest) => percent_decode(rest.strip_prefix("localhost").unwrap_or(rest)),
            None => a,
        })
        .filter(|a| a.to_ascii_lowercase().ends_with(".zomello") && Path::new(a).is_file())
        .collect()
}

/// Queue files for the page and tell it (if it's already running it picks them up right away).
#[cfg(any(desktop, target_os = "ios"))]
fn hand_over_files(app: &AppHandle, files: Vec<String>) {
    if files.is_empty() {
        return;
    }
    OPENED.lock().unwrap().extend(files);
    #[cfg(desktop)]
    desktop::show_main(app);
    use tauri::Emitter;
    let _ = app.emit("zomello://open-files", ());
}

/// The page asks for (and clears) the files waiting to be opened.
#[tauri::command]
fn take_opened_files() -> Vec<String> {
    std::mem::take(&mut *OPENED.lock().unwrap())
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

/// Unique folder for one stored file: `attachments/<id>/`.
fn new_attachment_rel(name: &str) -> PathBuf {
    let id = format!(
        "{:x}{:x}",
        now_secs(),
        SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.subsec_nanos()).unwrap_or(0)
    );
    PathBuf::from(ATTACH_DIR).join(id).join(safe_name(name))
}

#[derive(Serialize)]
struct StoredFile {
    rel: String,
    name: String,
    size: u64,
}

/// Copy a file the user dropped (we only get its path from the file manager) into storage.
#[tauri::command]
fn store_file_from_path(app: AppHandle, path: String) -> Result<StoredFile, String> {
    let src = PathBuf::from(&path);
    let meta = fs::metadata(&src).map_err(|e| format!("{path}: {e}"))?;
    if !meta.is_file() {
        return Err(format!("{path} is a folder, not a file"));
    }
    let name = src.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_else(|| "file".into());
    let rel = new_attachment_rel(&name);
    let abs = data_dir(&app)?.join(&rel);
    fs::create_dir_all(abs.parent().unwrap()).map_err(|e| e.to_string())?;
    fs::copy(&src, &abs).map_err(|e| e.to_string())?;
    Ok(StoredFile { rel: rel.to_string_lossy().replace('\\', "/"), name, size: meta.len() })
}

/// Read a file the user dropped (by path), e.g. a Trello/Planner export, as raw bytes.
#[tauri::command]
fn read_dropped_file(path: String) -> Result<tauri::ipc::Response, String> {
    fs::read(&path).map(tauri::ipc::Response::new).map_err(|e| format!("{path}: {e}"))
}

/// Store an uploaded file (raw request body; name in the `x-name` header, URI-encoded).
/// Returns the path relative to the data dir, e.g. `attachments/<id>/<name>`.
#[tauri::command]
fn save_attachment(app: AppHandle, request: tauri::ipc::Request) -> Result<String, String> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("expected a raw file body".into());
    };
    let name = request
        .headers()
        .get("x-name")
        .and_then(|v| v.to_str().ok())
        .map(|v| percent_decode(v))
        .unwrap_or_else(|| "file".into());
    store_bytes(&app, &name, bytes)
}

#[tauri::command]
fn attachment_abs_path(app: AppHandle, rel: String) -> Result<String, String> {
    Ok(attachment_path(&app, &rel)?.to_string_lossy().to_string())
}

/// Every stored file, as `attachments/<id>/<name>` paths.
#[tauri::command]
fn list_attachments(app: AppHandle) -> Result<Vec<String>, String> {
    let root = data_dir(&app)?.join(ATTACH_DIR);
    let mut out = Vec::new();
    for dir in fs::read_dir(&root).into_iter().flatten().flatten() {
        for f in fs::read_dir(dir.path()).into_iter().flatten().flatten() {
            if f.path().is_file() {
                out.push(format!(
                    "{ATTACH_DIR}/{}/{}",
                    dir.file_name().to_string_lossy(),
                    f.file_name().to_string_lossy()
                ));
            }
        }
    }
    Ok(out)
}

#[tauri::command]
fn delete_attachment(app: AppHandle, rel: String) -> Result<(), String> {
    let path = attachment_path(&app, &rel)?;
    let _ = fs::remove_file(&path);
    if let Some(parent) = path.parent() {
        let _ = fs::remove_dir(parent); // only succeeds when empty
    }
    Ok(())
}

fn mime_for(path: &Path) -> &'static str {
    match path.extension().and_then(|e| e.to_str()).map(|e| e.to_ascii_lowercase()).as_deref() {
        Some("png") => "image/png",
        Some("jpg" | "jpeg") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("webp") => "image/webp",
        Some("avif") => "image/avif",
        Some("bmp") => "image/bmp",
        Some("svg") => "image/svg+xml",
        Some("ico") => "image/x-icon",
        Some("pdf") => "application/pdf",
        Some("mp4") => "video/mp4",
        Some("webm") => "video/webm",
        Some("mp3") => "audio/mpeg",
        Some("wav") => "audio/wav",
        Some("txt" | "md") => "text/plain; charset=utf-8",
        _ => "application/octet-stream",
    }
}

/// Serves stored attachments to the webview at `zfile://localhost/attachments/<id>/<name>`
/// (`http://zfile.localhost/...` on Windows). Only the attachments folder is reachable.
fn serve_attachment(app: &AppHandle, request: &tauri::http::Request<Vec<u8>>) -> tauri::http::Response<Vec<u8>> {
    let respond = |status: u16, mime: &str, body: Vec<u8>| {
        tauri::http::Response::builder()
            .status(status)
            .header("Content-Type", mime)
            .header("Access-Control-Allow-Origin", "*")
            .body(body)
            .unwrap()
    };
    let rel = percent_decode(request.uri().path().trim_start_matches('/'));
    match attachment_path(app, &rel) {
        Ok(path) => match fs::read(&path) {
            Ok(bytes) => respond(200, mime_for(&path), bytes),
            Err(_) => respond(404, "text/plain", b"not found".to_vec()),
        },
        Err(_) => respond(403, "text/plain", b"forbidden".to_vec()),
    }
}

fn percent_decode(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' && i + 2 < b.len() {
            if let Ok(v) = u8::from_str_radix(&s[i + 1..i + 3], 16) {
                out.push(v);
                i += 3;
                continue;
            }
        }
        out.push(b[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// Linux: turn on WebKitGTK's spell checker for a window (Windows' WebView2 has it built in).
#[cfg(desktop)]
pub(crate) fn enable_spellcheck(window: &tauri::WebviewWindow) {
    #[cfg(target_os = "linux")]
    let _ = window.with_webview(|webview| {
        use webkit2gtk::{WebContextExt, WebViewExt};
        if let Some(ctx) = webview.inner().context() {
            // Use the system language (e.g. en_US from LANG); falls back to US English.
            let lang = std::env::var("LANG")
                .ok()
                .and_then(|l| l.split('.').next().map(str::to_string))
                .filter(|l| l.len() >= 2 && l != "C" && l != "POSIX")
                .unwrap_or_else(|| "en_US".into());
            ctx.set_spell_checking_enabled(true);
            ctx.set_spell_checking_languages(&[lang.as_str()]);
        }
    });
    #[cfg(not(target_os = "linux"))]
    let _ = window;
}

/// Open a board in its own window (or focus it if it's already open).
/// Async so window creation doesn't block the main thread (required on Windows).
#[cfg(desktop)]
#[tauri::command]
async fn open_board_window(app: AppHandle, board_id: String, title: String) -> Result<(), String> {
    let id: String = board_id.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '-').collect();
    let label = format!("board-{id}");
    if let Some(w) = app.get_webview_window(&label) {
        let _ = w.unminimize();
        let _ = w.set_focus();
        return Ok(());
    }
    let window = tauri::WebviewWindowBuilder::new(&app, &label, tauri::WebviewUrl::App(format!("index.html?board={id}").into()))
        .title(format!("{title} · Zomello"))
        .inner_size(1200.0, 820.0)
        .min_inner_size(700.0, 500.0)
        .build()
        .map_err(|e| e.to_string())?;
    enable_spellcheck(&window);
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // WebKitGTK's DMA-BUF renderer shows a blank window on many NVIDIA/Wayland setups.
    #[cfg(target_os = "linux")]
    if std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none() {
        std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
    }

    let builder = tauri::Builder::default();
    // Phones and tablets: scan the QR code your computer shows to connect to it.
    #[cfg(mobile)]
    let builder = builder.plugin(tauri_plugin_barcode_scanner::init());
    // Desktop: one running copy, start at login, and the tray (closing the window can keep it running).
    #[cfg(desktop)]
    let builder = builder
        // Must be first: a second launch just focuses the running window, so two
        // processes never write the same data file.
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            // Launching again brings the main window back (from the tray, or re-created if it was closed).
            desktop::show_main(app);
            // Double-clicking a board file while Zomello runs arrives here.
            hand_over_files(app, board_files_in(args.into_iter().skip(1)));
        }))
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec![desktop::HIDDEN_ARG]),
        ))
        // In background mode, closing the main window just hides it to the tray.
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" && desktop::in_background_mode() {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .manage(remote::Remote::new())
        .manage(link::Links::default());

    #[cfg(desktop)]
    let handlers: Box<dyn Fn(tauri::ipc::Invoke) -> bool + Send + Sync> = Box::new(tauri::generate_handler![
        load_data,
        save_data,
        export_data,
        export_bytes,
        take_opened_files,
        servers::check_server,
        servers::find_servers,
        servers::allow_place,
        places::places_read,
        places::places_save_boards,
        places::places_save_list,
        places::places_save_look,
        places::places_save_link,
        places::places_send_board,
        places::places_take_board,
        link_client::link_ops_ack,
        servers::open_server_window,
        list_backups,
        read_backup,
        data_location,
        save_attachment,
        store_file_from_path,
        open_board_window,
        read_dropped_file,
        attachment_abs_path,
        list_attachments,
        delete_attachment,
        remote::remote_status,
        remote::remote_set_enabled,
        remote::remote_start_pairing,
        remote::remote_cancel_pairing,
        remote::remote_unlink,
        remote::remote_rename,
        calendar::fetch_calendar,
        desktop::set_background_mode,
        desktop::show_main_window,
        desktop::get_autostart,
        desktop::set_autostart,
        desktop::store_package,
        remote::remote_open_firewall,
        remote::remote_set_address,
        remote::remote_regenerate_cert,
        remote::remote_export_cert,
        remote::remote_qr,
        remote::remote_show_boards,
        link::linked_devices,
        link::linked_data,
        link::linked_send,
        link::linked_send_board,
        link::open_device_window
    ]);
    // Phones and tablets: the same app with its own boards, minus windows, tray and the phone server.
    #[cfg(mobile)]
    let handlers: Box<dyn Fn(tauri::ipc::Invoke) -> bool + Send + Sync> = Box::new(tauri::generate_handler![
        load_data,
        save_data,
        export_data,
        export_bytes,
        take_opened_files,
        servers::check_server,
        servers::find_servers,
        servers::allow_place,
        places::places_read,
        places::places_save_boards,
        places::places_save_list,
        places::places_save_look,
        places::places_save_link,
        places::places_send_board,
        places::places_take_board,
        link_client::link_ops_ack,
        list_backups,
        read_backup,
        data_location,
        save_attachment,
        store_file_from_path,
        read_dropped_file,
        attachment_abs_path,
        list_attachments,
        delete_attachment,
        calendar::fetch_calendar
    ]);

    builder
        // Safety net: the app window only ever shows the app itself. Links open in the browser
        // instead, and a stray dropped file can never replace the UI.
        .plugin(
            tauri::plugin::Builder::<tauri::Wry, ()>::new("nav-guard")
                .on_navigation(|webview, url| {
                    // A Zomello Server window stays on its server; links elsewhere open in the browser.
                    if let Some(ok) = servers::allows(webview.label(), url) {
                        if !ok && matches!(url.scheme(), "http" | "https" | "mailto") {
                            use tauri_plugin_opener::OpenerExt;
                            let _ = webview.app_handle().opener().open_url(url.as_str(), None::<&str>);
                        }
                        return ok;
                    }
                    matches!(url.scheme(), "tauri" | "asset")
                        || matches!(url.host_str(), Some("localhost") | Some("tauri.localhost") | Some("asset.localhost"))
                })
                .build(),
        )
        .register_uri_scheme_protocol("zfile", |ctx, request| serve_attachment(ctx.app_handle(), &request))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .invoke_handler(handlers)
        .setup(|app| {
            #[cfg(desktop)]
            {
                if let Some(window) = app.get_webview_window("main") {
                    enable_spellcheck(&window);
                    // Started at login: stay in the tray until opened (the page turns the tray on).
                    if !desktop::started_hidden() {
                        let _ = window.show();
                    }
                }
                remote::init(app.handle());
                // Opened by double-clicking a board file (Windows/Linux).
                OPENED.lock().unwrap().extend(board_files_in(std::env::args().skip(1)));
            }
            // Phones and tablets: share this phone's boards with your computer while on the same network.
            #[cfg(mobile)]
            link_client::start(app.handle().clone());
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while running Zomello")
        .run(|_app, _event| {
            // macOS hands over double-clicked files as an event instead of arguments.
            #[cfg(any(target_os = "macos", target_os = "ios"))]
            if let tauri::RunEvent::Opened { urls } = _event {
                let files = urls.into_iter().filter_map(|u| u.to_file_path().ok()).map(|p| p.to_string_lossy().to_string());
                hand_over_files(_app, board_files_in(files));
            }
        });
}

#[cfg(test)]
mod command_permissions {
    /// Every command the app registers must be listed in build.rs (and so get a permission), or the
    /// app's own pages are refused it ("Command not found"). Catches a forgotten one at `cargo test`.
    #[test]
    fn every_command_has_a_permission() {
        let lib = include_str!("lib.rs").split("mod command_permissions").next().unwrap();
        let build = include_str!("../build.rs");
        let default = include_str!("../capabilities/default.json");
        for list in lib.split("tauri::generate_handler![").skip(1) {
            for cmd in list.split(']').next().unwrap().split(',').map(|c| c.trim()).filter(|c| !c.is_empty()) {
                let name = cmd.rsplit("::").next().unwrap();
                assert!(build.contains(&format!("\"{name}\"")), "{name} is missing from build.rs");
                let perm = format!("\"allow-{}\"", name.replace('_', "-"));
                assert!(default.contains(&perm), "{perm} is missing from capabilities/default.json");
            }
        }
    }
}
