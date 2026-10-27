//! Phones and tablets: the menu shows every place's boards in its own section (This phone, My
//! computer, servers). The page you're on only knows its own boards, so each place's page saves a
//! short list of them here (titles, colors, categories; no card contents), and every page reads all
//! the lists to draw the other sections. Kept in `places.json` in the app's data folder.
//!
//! A computer's or server's page shown in the app may save only its own list (the key is taken from
//! the page's address, not from the page), and can't change which places there are.

use serde_json::{json, Map, Value};
use std::fs;
use tauri::{AppHandle, Webview};

const FILE: &str = "places.json";

fn read(app: &AppHandle) -> Value {
    crate::data_dir(app)
        .ok()
        .and_then(|d| fs::read_to_string(d.join(FILE)).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .filter(Value::is_object)
        .unwrap_or_else(|| json!({ "list": [], "boards": {} }))
}

fn write(app: &AppHandle, v: &Value) -> Result<(), String> {
    let dir = crate::data_dir(app)?;
    crate::atomic_write(&dir.join(FILE), v.to_string().as_bytes())
}

/// The page's own place: "phone" for the app's own page, else its https origin.
fn place_of(webview: &Webview) -> Result<String, String> {
    let url = webview.url().map_err(|e| e.to_string())?;
    match url.scheme() {
        "https" => Ok(crate::servers::origin_of(&url)),
        "tauri" | "http" if url.host_str().is_some_and(|h| h.ends_with("localhost")) => Ok("phone".into()),
        _ => Err("Not a place".into()),
    }
}

/// Everything: `{ list: [{ origin, name, kind }], boards: { "<place>": { at, boards: [...] } }, me: "<place>" }`.
#[tauri::command]
pub fn places_read(app: AppHandle, webview: Webview) -> Value {
    let mut v = read(&app);
    // The link token stays in the app; pages only learn which computer it's linked with.
    if let Some(origin) = v["link"]["origin"].as_str().map(str::to_string) {
        v["linked"] = Value::String(origin);
    }
    if let Some(m) = v.as_object_mut() {
        m.remove("link");
    }
    if let Ok(me) = place_of(&webview) {
        v["me"] = Value::String(me);
    }
    v
}

/// Save the calling page's own board list (and its sections, which can be empty).
#[tauri::command]
pub fn places_save_boards(app: AppHandle, webview: Webview, boards: Value, sections: Option<Value>) -> Result<(), String> {
    let key = place_of(&webview)?;
    save_boards_of(&app, &key, &boards, &sections.unwrap_or(Value::Null))
}

/// A place's board list: from its own page, or (for the linked computer) sent over the link.
pub fn save_boards_of(app: &AppHandle, key: &str, boards: &Value, sections: &Value) -> Result<(), String> {
    if !boards.is_array() {
        return Err("boards must be a list".into());
    }
    let mut v = read(app);
    if !v["boards"].is_object() {
        v["boards"] = Value::Object(Map::new());
    }
    let sections = if sections.is_array() { sections.clone() } else { json!([]) };
    v["boards"][key] = json!({ "at": crate::now_secs(), "boards": boards, "sections": sections });
    write(app, &v)
}

/// The phone's own look (theme, style, colors, text size, accessibility). Any place's page shown in the
/// app uses it instead of that place's, and changing the look there changes the phone's.
#[tauri::command]
pub fn places_save_look(app: AppHandle, webview: Webview, look: Value) -> Result<(), String> {
    place_of(&webview)?;
    if !look.is_object() {
        return Err("look must be an object".into());
    }
    let mut v = read(&app);
    v["phoneLook"] = look;
    write(&app, &v)
}

/// The app's own page only (see capabilities): which places there are, in order.
#[tauri::command]
pub fn places_save_list(app: AppHandle, webview: Webview, list: Value) -> Result<(), String> {
    if place_of(&webview)? != "phone" {
        return Err("Only the app itself can change the places".into());
    }
    let mut v = read(&app);
    // Forget saved boards of places that were removed.
    let keep: Vec<String> = list.as_array().into_iter().flatten().filter_map(|p| p["origin"].as_str().map(str::to_string)).collect();
    if let Some(b) = v["boards"].as_object_mut() {
        b.retain(|k, _| k == "phone" || keep.contains(k));
    }
    if v["link"]["origin"].as_str().is_some_and(|o| !keep.iter().any(|k| k == o)) {
        // The computer was removed from the list: stop sharing with it.
        if let Some(m) = v.as_object_mut() {
            m.remove("link");
        }
    }
    v["list"] = list;
    write(&app, &v)
}

/// Your computer's page in the app: link this phone with it, so its boards show there while
/// both are on the same network. Only a computer in the list can, and only for itself.
#[tauri::command]
pub fn places_save_link(app: AppHandle, webview: Webview, token: String, ca: String) -> Result<(), String> {
    let me = place_of(&webview)?;
    let mut v = read(&app);
    let is_computer = v["list"].as_array().into_iter().flatten().any(|p| p["origin"] == me.as_str() && p["kind"] == "computer");
    if !is_computer {
        return Err("Only your computer can link with this phone".into());
    }
    if token.len() < 32 || !token.chars().all(|c| c.is_ascii_hexdigit()) || !ca.contains("BEGIN CERTIFICATE") {
        return Err("That isn't a link from Zomello".into());
    }
    v["link"] = json!({ "origin": me, "token": token, "ca": ca });
    write(&app, &v)
}

/// The link details (for link_client.rs).
pub fn link(app: &AppHandle) -> Option<Value> {
    Some(read(app).get("link")?.clone()).filter(Value::is_object)
}

/// Forget the link (the computer no longer knows this phone).
pub fn forget_link(app: &AppHandle) {
    let mut v = read(app);
    if let Some(m) = v.as_object_mut() {
        if m.remove("link").is_some() {
            let _ = write(app, &v);
        }
    }
}

// ---- Moving boards between places ----
//
// A board on its way from one place to another (say from your computer's page to this phone) waits
// here as a board file, in `transfers/<place>/`, until that place's page opens and takes it.

/// Biggest board (with its attached files) that can be handed over this way.
const MAX_TRANSFER: usize = 300 * 1024 * 1024;

fn transfer_dir(app: &AppHandle, place: &str) -> Result<std::path::PathBuf, String> {
    // The place key is "phone" or an https origin; keep only safe characters for the folder name.
    let name: String = place.chars().map(|c| if c.is_ascii_alphanumeric() || c == '.' || c == '-' { c } else { '_' }).collect();
    Ok(crate::data_dir(app)?.join("transfers").join(name))
}

/// Is `to` a place this app knows: the phone itself, or one in the list?
fn known_place(app: &AppHandle, to: &str) -> bool {
    to == "phone" || read(app)["list"].as_array().into_iter().flatten().any(|p| p["origin"] == to)
}

/// Hand a board file (raw body) to another place; `x-to` names it ("phone" or its origin).
#[tauri::command]
pub fn places_send_board(app: AppHandle, webview: Webview, request: tauri::ipc::Request) -> Result<(), String> {
    let from = place_of(&webview)?;
    // The app's own page sends the file as raw bytes; a computer's or server's page (another origin)
    // can only send it as a list of numbers.
    let owned: Vec<u8>;
    let bytes: &[u8] = match request.body() {
        tauri::ipc::InvokeBody::Raw(b) => b,
        tauri::ipc::InvokeBody::Json(serde_json::Value::Array(a)) => {
            owned = a.iter().map(|v| v.as_u64().unwrap_or(0) as u8).collect();
            &owned
        }
        tauri::ipc::InvokeBody::Json(v) if v.get("0").is_some() => {
            // A typed array serialized as an object: {"0": 80, "1": 75, …}
            let o = v.as_object().unwrap();
            owned = (0..o.len()).map(|i| o.get(&i.to_string()).and_then(serde_json::Value::as_u64).unwrap_or(0) as u8).collect();
            &owned
        }
        _ => return Err("expected a board file".into()),
    };
    let to = request.headers().get("x-to").and_then(|v| v.to_str().ok()).unwrap_or_default().to_string();
    if to == from || !known_place(&app, &to) {
        return Err("That place isn't in this app's list".into());
    }
    if bytes.len() > MAX_TRANSFER {
        return Err("This board is too big to move (its attached files add up to more than 300 MB)".into());
    }
    queue_board(&app, &to, bytes)
}

/// Leave a board file for a place's page to take (also used for boards your computer sends).
pub fn queue_board(app: &AppHandle, place: &str, bytes: &[u8]) -> Result<(), String> {
    if !bytes.starts_with(b"PK") {
        return Err("That isn't a board file".into());
    }
    let dir = transfer_dir(app, place)?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let stamp = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or_default();
    crate::atomic_write(&dir.join(format!("{stamp}.zomello")), bytes)
}

/// The oldest board waiting for the calling page's place (removed once taken); empty if none.
#[tauri::command]
pub fn places_take_board(app: AppHandle, webview: Webview) -> Result<tauri::ipc::Response, String> {
    let me = place_of(&webview)?;
    let dir = transfer_dir(&app, &me)?;
    let mut files: Vec<_> = fs::read_dir(&dir)
        .map(|r| r.flatten().map(|e| e.path()).filter(|p| p.extension().is_some_and(|x| x == "zomello")).collect())
        .unwrap_or_default();
    files.sort();
    let Some(first) = files.first() else { return Ok(tauri::ipc::Response::new(Vec::new())) };
    let bytes = fs::read(first).map_err(|e| e.to_string())?;
    let _ = fs::remove_file(first);
    Ok(tauri::ipc::Response::new(bytes))
}
