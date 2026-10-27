//! Your phone's boards on this computer, live, while the phone is on the same network.
//!
//! The phone app (src/link_client.rs on the phone) connects here over the phone & tablet server's
//! https, signed in with a link token it got while paired (see `link_token`). It sends its boards
//! (`PUT /api/link/snapshot`) when it connects and whenever they change, and listens for edits made
//! here (`GET /api/link/events`). Nothing is kept: when the phone goes away (no word from it for a
//! little while), its boards disappear from this computer.

use crate::remote;
use axum::{
    body::Bytes,
    extract::{Path as UrlPath, State},
    http::{header, HeaderMap, StatusCode},
    response::{sse, IntoResponse, Response},
    Json,
};
use futures_util::stream::{self, Stream};
use serde_json::{json, Value};
use std::{collections::HashMap, convert::Infallible, sync::Mutex, time::Duration};
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::mpsc;

/// A phone connected right now.
struct Linked {
    name: String,
    /// The phone's data file as it last sent it (None until the first snapshot arrives).
    snapshot: Option<String>,
    /// When we last heard from it (unix seconds).
    last: u64,
    /// This connection (a reconnect replaces it).
    conn: String,
    /// Edits (and boards) sent from here, on their way to the phone: (event name, data).
    tx: mpsc::UnboundedSender<(String, String)>,
}

#[derive(Default)]
pub struct Links {
    phones: Mutex<HashMap<String, Linked>>,
    /// The board list last sent to the phones (see `send_board_list`).
    board_list: Mutex<String>,
}

/// No word for this long: the phone has gone (out of range, app put away).
const GONE_AFTER: u64 = 45;

fn changed(app: &AppHandle, id: &str) {
    let _ = app.emit("zomello://linked-changed", json!({ "id": id }));
    remote::notify_linked(app, id);
}

/// The phone signed in with its link token (`Authorization: Bearer …`).
fn phone(app: &AppHandle, headers: &HeaderMap) -> Option<remote::DeviceRef> {
    let token = headers.get(header::AUTHORIZATION)?.to_str().ok()?.strip_prefix("Bearer ")?.trim();
    remote::device_by_link_token(app, token)
}

/// `POST /api/link/token` (a paired device's own page): a token for its app to link with.
pub async fn link_token(State(app): State<AppHandle>, headers: HeaderMap) -> Response {
    match remote::new_link_token(&app, &headers) {
        Some(token) => Json(json!({ "token": token })).into_response(),
        None => (StatusCode::UNAUTHORIZED, "This device isn't paired with Zomello").into_response(),
    }
}

/// Removes the phone when its connection ends (unless a newer connection replaced it).
struct Leave {
    app: AppHandle,
    id: String,
    conn: String,
}
impl Drop for Leave {
    fn drop(&mut self) {
        let links = self.app.state::<Links>();
        let mut phones = links.phones.lock().unwrap();
        if phones.get(&self.id).is_some_and(|p| p.conn == self.conn) {
            phones.remove(&self.id);
            drop(phones);
            changed(&self.app, &self.id);
        }
    }
}

/// `GET /api/link/events`: the phone listens here for edits made on this computer.
pub async fn link_events(State(app): State<AppHandle>, headers: HeaderMap) -> Response {
    let Some(dev) = phone(&app, &headers) else { return StatusCode::UNAUTHORIZED.into_response() };
    let (tx, rx) = mpsc::unbounded_channel::<(String, String)>();
    let conn = remote::random_hex(8);
    app.state::<Links>().phones.lock().unwrap().insert(
        dev.id.clone(),
        Linked { name: dev.name.clone(), snapshot: None, last: crate::now_secs(), conn: conn.clone(), tx },
    );
    // Its menu shows this computer's boards and sections; send them now, and again whenever they change.
    if let Some(p) = app.state::<Links>().phones.lock().unwrap().get(&dev.id) {
        let _ = p.tx.send(("boards".into(), board_list(&crate::read_data(&app).unwrap_or_default()).to_string()));
    }
    let leave = Leave { app: app.clone(), id: dev.id, conn };
    let s = stream::unfold((rx, leave), |(mut rx, leave)| async move {
        let (name, data) = rx.recv().await?;
        Some((Ok::<_, Infallible>(sse::Event::default().event(name).data(data)), (rx, leave)))
    });
    let s: std::pin::Pin<Box<dyn Stream<Item = Result<sse::Event, Infallible>> + Send>> = Box::pin(s);
    sse::Sse::new(s).keep_alive(sse::KeepAlive::new().interval(Duration::from_secs(15))).into_response()
}

/// This computer's boards as a phone's menu shows them: titles, colors, sections and stars, in order (no
/// card contents, and no private boards).
pub fn board_list(json: &str) -> Value {
    let data: Value = serde_json::from_str(&crate::private::without_private(json)).unwrap_or_default();
    let mut boards: Vec<&Value> = data["boards"].as_object().into_iter().flatten().map(|(_, b)| b).filter(|b| b["archived"] != true).collect();
    boards.sort_by(|a, b| a["order"].as_f64().unwrap_or(0.0).total_cmp(&b["order"].as_f64().unwrap_or(0.0)));
    let boards: Vec<Value> = boards
        .iter()
        .map(|b| json!({ "id": b["id"], "title": b["title"], "color": b["color"], "category": b["category"], "starred": b["starred"] == true }))
        .collect();
    let sections = data["settings"]["sections"].as_array().cloned().unwrap_or_default();
    json!({ "boards": boards, "sections": sections })
}

/// After a save here: if the boards or sections changed, tell the connected phones, so their menus match
/// without opening this computer's boards first.
pub fn send_board_list(app: &AppHandle, json: &str) {
    let Some(links) = app.try_state::<Links>() else { return };
    let list = board_list(json).to_string();
    {
        let mut last = links.board_list.lock().unwrap();
        if *last == list {
            return;
        }
        *last = list.clone();
    }
    for p in links.phones.lock().unwrap().values() {
        let _ = p.tx.send(("boards".into(), list.clone()));
    }
}

/// `PUT /api/link/snapshot`: the phone's boards (its whole data file).
pub async fn link_snapshot(State(app): State<AppHandle>, headers: HeaderMap, body: Bytes) -> Response {
    let Some(dev) = phone(&app, &headers) else { return StatusCode::UNAUTHORIZED.into_response() };
    let Ok(mut v) = serde_json::from_slice::<Value>(&body) else {
        return (StatusCode::BAD_REQUEST, "not JSON").into_response();
    };
    // Locked private boards only go into the backup; nothing here can open them.
    let locked = v.as_object_mut().and_then(|m| m.remove("privateBackup")).and_then(|x| x.as_str().map(str::to_string));
    let text = v.to_string();
    if v["settings"]["backupToComputer"] == true {
        crate::backup::keep(&app, &dev.id, &dev.name, &text, locked.as_deref());
    }
    {
        let links = app.state::<Links>();
        let mut phones = links.phones.lock().unwrap();
        let Some(p) = phones.get_mut(&dev.id) else { return StatusCode::CONFLICT.into_response() };
        p.snapshot = Some(text);
        p.last = crate::now_secs();
    }
    changed(&app, &dev.id);
    StatusCode::NO_CONTENT.into_response()
}

/// Locked private boards from a backup, for the phone to open with its password.
#[tauri::command]
pub fn linked_send_private(app: AppHandle, id: String, blob: String) -> Result<(), String> {
    let links = app.state::<Links>();
    let phones = links.phones.lock().unwrap();
    let p = phones.get(&id).ok_or("That device isn't connected right now.")?;
    p.tx.send(("private-backup".into(), blob)).map_err(|_| "That device isn't connected right now.".to_string())
}

/// `POST /api/link/board-received` `{ id }`: the phone has a board this computer sent it.
pub async fn link_board_received(State(app): State<AppHandle>, headers: HeaderMap, Json(body): Json<Value>) -> Response {
    let Some(dev) = phone(&app, &headers) else { return StatusCode::UNAUTHORIZED.into_response() };
    let _ = app.emit("zomello://linked-board-received", json!({ "device": dev.id, "id": body["id"] }));
    StatusCode::NO_CONTENT.into_response()
}

/// `POST /api/link/ping`: still here.
pub async fn link_ping(State(app): State<AppHandle>, headers: HeaderMap) -> Response {
    let Some(dev) = phone(&app, &headers) else { return StatusCode::UNAUTHORIZED.into_response() };
    match app.state::<Links>().phones.lock().unwrap().get_mut(&dev.id) {
        Some(p) => {
            p.last = crate::now_secs();
            StatusCode::NO_CONTENT.into_response()
        }
        None => StatusCode::CONFLICT.into_response(),
    }
}

/// Every few seconds: forget phones we haven't heard from (their connection may never say goodbye).
pub async fn prune(app: AppHandle) {
    loop {
        tokio::time::sleep(Duration::from_secs(10)).await;
        let now = crate::now_secs();
        let gone: Vec<String> = {
            let links = app.state::<Links>();
            let mut phones = links.phones.lock().unwrap();
            let gone: Vec<String> = phones.iter().filter(|(_, p)| now.saturating_sub(p.last) > GONE_AFTER).map(|(k, _)| k.clone()).collect();
            for id in &gone {
                phones.remove(id);
            }
            gone
        };
        for id in gone {
            changed(&app, &id);
        }
    }
}

/// A device was unlinked (or the server stopped): its boards go.
pub fn forget(app: &AppHandle, id: Option<&str>) {
    let ids: Vec<String> = {
        let links = app.state::<Links>();
        let mut phones = links.phones.lock().unwrap();
        let ids: Vec<String> = phones.keys().filter(|k| id.is_none_or(|i| i == k.as_str())).cloned().collect();
        for i in &ids {
            phones.remove(i);
        }
        ids
    };
    for i in ids {
        changed(app, &i);
    }
}

// ---- For this computer's windows ----

/// Phones connected now, with their boards (for the sidebar). Hidden ones are left out.
#[tauri::command]
pub fn linked_devices(app: AppHandle) -> Vec<Value> {
    let hidden = remote::hidden_devices(&app);
    device_list(&app, |id| !hidden.iter().any(|h| h == id))
}

/// Every phone and tablet connected right now, `[{ id, name }]` (for sending a backup back to one).
#[tauri::command]
pub fn linked_connected(app: AppHandle) -> Vec<Value> {
    let links = app.state::<Links>();
    let phones = links.phones.lock().unwrap();
    let mut out: Vec<Value> = phones.iter().map(|(id, p)| json!({ "id": id, "name": p.name })).collect();
    out.sort_by(|a, b| a["name"].as_str().cmp(&b["name"].as_str()));
    out
}

/// Connected phones (with a snapshot) that `keep` allows, with their boards, by name.
fn device_list(app: &AppHandle, keep: impl Fn(&str) -> bool) -> Vec<Value> {
    let links = app.state::<Links>();
    let phones = links.phones.lock().unwrap();
    let mut out: Vec<Value> = phones
        .iter()
        .filter(|(id, p)| p.snapshot.is_some() && keep(id))
        .map(|(id, p)| {
            let d: Value = serde_json::from_str(p.snapshot.as_deref().unwrap_or("{}")).unwrap_or(Value::Null);
            let mut boards: Vec<Value> = d["boards"]
                .as_object()
                .map(|m| {
                    m.values()
                        .filter(|b| b["archived"] != Value::Bool(true))
                        .map(|b| json!({ "id": b["id"], "title": b["title"], "color": b["color"], "icon": b["icon"], "category": b["category"], "order": b["order"] }))
                        .collect()
                })
                .unwrap_or_default();
            boards.sort_by(|a, b| a["order"].as_f64().unwrap_or(0.0).total_cmp(&b["order"].as_f64().unwrap_or(0.0)));
            json!({ "id": id, "name": p.name, "boards": boards, "sections": d["settings"]["sections"] })
        })
        .collect();
    out.sort_by(|a, b| a["name"].as_str().cmp(&b["name"].as_str()));
    out
}

// ---- For your other devices (a phone or tablet viewing this computer's boards) ----

/// Devices whose owner turned on "Let my other devices see this device's boards" (a setting on
/// the device itself, which arrives with its data).
fn sharing_devices(app: &AppHandle) -> Vec<String> {
    let links = app.state::<Links>();
    let phones = links.phones.lock().unwrap();
    phones
        .iter()
        .filter(|(_, p)| {
            p.snapshot
                .as_deref()
                .and_then(|s| serde_json::from_str::<Value>(s).ok())
                .is_some_and(|d| d["settings"]["shareWithDevices"] == Value::Bool(true))
        })
        .map(|(id, _)| id.clone())
        .collect()
}

/// May the device making this request see phone `id`? That device shares with your other devices,
/// and it isn't the requester itself.
fn may_see(app: &AppHandle, headers: &HeaderMap, id: &str) -> Result<(), Response> {
    let Some(me) = remote::requester(app, headers) else { return Err(StatusCode::UNAUTHORIZED.into_response()) };
    if me == id || !sharing_devices(app).iter().any(|d| d == id) {
        return Err(StatusCode::FORBIDDEN.into_response());
    }
    Ok(())
}

/// `GET /api/devices`: your other devices connected now that share their boards.
pub async fn shared_devices(State(app): State<AppHandle>, headers: HeaderMap) -> Response {
    let Some(me) = remote::requester(&app, &headers) else { return StatusCode::UNAUTHORIZED.into_response() };
    let sharing = sharing_devices(&app);
    Json(device_list(&app, |id| id != me && sharing.iter().any(|s| s == id))).into_response()
}

/// `GET /api/devices/{id}/data`: that device's data file, as it last sent it.
pub async fn shared_data(State(app): State<AppHandle>, headers: HeaderMap, UrlPath(id): UrlPath<String>) -> Response {
    if let Err(r) = may_see(&app, &headers, &id) {
        return r;
    }
    match app.state::<Links>().phones.lock().unwrap().get(&id).and_then(|p| p.snapshot.clone()) {
        Some(json) => ([(header::CONTENT_TYPE, "application/json")], json).into_response(),
        None => (StatusCode::NOT_FOUND, "That device isn't connected right now.").into_response(),
    }
}

/// `POST /api/devices/{id}/ops`: edits made on another device, on their way to that device.
pub async fn shared_ops(State(app): State<AppHandle>, headers: HeaderMap, UrlPath(id): UrlPath<String>, Json(ops): Json<Value>) -> Response {
    if let Err(r) = may_see(&app, &headers, &id) {
        return r;
    }
    match linked_send(app, id, ops) {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(e) => (StatusCode::NOT_FOUND, e).into_response(),
    }
}

/// A connected phone's data (its whole file), or None if it isn't connected.
#[tauri::command]
pub fn linked_data(app: AppHandle, id: String) -> Option<String> {
    app.state::<Links>().phones.lock().unwrap().get(&id).and_then(|p| p.snapshot.clone())
}

/// Send edits made here to the phone (boards, buckets and cards that changed or were deleted).
#[tauri::command]
pub fn linked_send(app: AppHandle, id: String, ops: Value) -> Result<(), String> {
    let links = app.state::<Links>();
    let phones = links.phones.lock().unwrap();
    let p = phones.get(&id).ok_or("Your phone isn't connected right now.")?;
    p.tx.send(("ops".into(), ops.to_string())).map_err(|_| "Your phone isn't connected right now.".to_string())
}

/// Send a board file (raw body) to a connected phone; `x-device` names it. Returns the transfer's id,
/// which comes back in `zomello://linked-board-received` once the phone has it.
#[tauri::command]
pub fn linked_send_board(app: AppHandle, request: tauri::ipc::Request) -> Result<String, String> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("expected a board file".into());
    };
    if !bytes.starts_with(b"PK") {
        return Err("That isn't a board file".into());
    }
    let id = request.headers().get("x-device").and_then(|v| v.to_str().ok()).unwrap_or_default().to_string();
    let links = app.state::<Links>();
    let phones = links.phones.lock().unwrap();
    let p = phones.get(&id).ok_or("Your phone isn't connected right now.")?;
    let tid = remote::random_hex(8);
    let data = json!({ "id": tid, "file": crate::link_client::base64_encode(bytes) }).to_string();
    p.tx.send(("board".into(), data)).map_err(|_| "Your phone isn't connected right now.".to_string())?;
    Ok(tid)
}


/// Open a phone's boards in their own window (or bring it forward).
#[tauri::command]
pub async fn open_device_window(app: AppHandle, id: String, board: Option<String>) -> Result<(), String> {
    let id: String = id.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '-').collect();
    let name = app.state::<Links>().phones.lock().unwrap().get(&id).map(|p| p.name.clone()).ok_or("Your phone isn't connected right now.")?;
    let label = format!("device-{id}");
    let hash = board.map(|b| format!("#/board/{}", b.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '-').collect::<String>())).unwrap_or_default();
    if let Some(w) = app.get_webview_window(&label) {
        let _ = w.unminimize();
        let _ = w.set_focus();
        if !hash.is_empty() {
            let _ = w.eval(format!("location.hash = {:?}", hash.trim_start_matches('#')));
        }
        return Ok(());
    }
    let window = tauri::WebviewWindowBuilder::new(&app, &label, tauri::WebviewUrl::App(format!("index.html?device={id}{hash}").into()))
        .title(format!("{name} · Zomello"))
        .inner_size(1250.0, 840.0)
        .min_inner_size(700.0, 500.0)
        .build()
        .map_err(|e| e.to_string())?;
    crate::enable_spellcheck(&window);
    crate::app_icon::apply(&window);
    Ok(())
}
