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
    if let Ok(me) = place_of(&webview) {
        v["me"] = Value::String(me);
    }
    v
}

/// Save the calling page's own board list (and its sections, which can be empty).
#[tauri::command]
pub fn places_save_boards(app: AppHandle, webview: Webview, boards: Value, sections: Option<Value>) -> Result<(), String> {
    let key = place_of(&webview)?;
    if !boards.is_array() {
        return Err("boards must be a list".into());
    }
    let mut v = read(&app);
    if !v["boards"].is_object() {
        v["boards"] = Value::Object(Map::new());
    }
    let sections = sections.filter(Value::is_array).unwrap_or_else(|| json!([]));
    v["boards"][key] = json!({ "at": crate::now_secs(), "boards": boards, "sections": sections });
    write(&app, &v)
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
    v["list"] = list;
    write(&app, &v)
}
