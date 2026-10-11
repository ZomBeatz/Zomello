//! Phone & tablet access: a small web server on the home network that serves the Zomello UI and
//! its data to paired devices. Devices pair once with a short-lived code shown on the PC and can be
//! unlinked from Settings. Device tokens are stored hashed, in `remote.json` (never in the data file,
//! which is sent to every device).

use axum::{
    body::Bytes,
    extract::{DefaultBodyLimit, Path as UrlPath, State},
    http::{header, HeaderMap, StatusCode},
    response::{sse, IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use futures_util::stream::{self, Stream};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    convert::Infallible,
    fs,
    sync::Mutex,
    time::{Duration, Instant},
};
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::{broadcast, oneshot};

const CONFIG_FILE: &str = "remote.json";
const DEFAULT_PORT: u16 = 7311;
const PAIR_TTL: Duration = Duration::from_secs(10 * 60);
const PAIR_TRIES: u32 = 5;
const COOKIE: &str = "zomello_device";

#[derive(Serialize, Deserialize, Clone)]
struct Device {
    id: String,
    name: String,
    token_hash: String,
    created: u64,
    last_seen: u64,
}

#[derive(Serialize, Deserialize)]
struct Config {
    enabled: bool,
    port: u16,
    devices: Vec<Device>,
}

impl Default for Config {
    fn default() -> Self {
        Config { enabled: false, port: DEFAULT_PORT, devices: vec![] }
    }
}

struct Pairing {
    code: String,
    expires: Instant,
    tries: u32,
}

#[derive(Clone)]
enum Msg {
    /// The data file changed; `from` is the client id that saved it ("desktop" for the PC).
    Data { from: String, json: String },
    /// A device was unlinked: its open connections close.
    Revoked(String),
    /// The server is stopping.
    Shutdown,
}

#[derive(Default)]
struct Inner {
    config: Config,
    pairing: Option<Pairing>,
    shutdown: Option<oneshot::Sender<()>>,
    error: Option<String>,
}

pub struct Remote {
    inner: Mutex<Inner>,
    tx: broadcast::Sender<Msg>,
}

impl Remote {
    pub fn new() -> Self {
        Remote { inner: Mutex::new(Inner::default()), tx: broadcast::channel(16).0 }
    }
}

fn random_hex(bytes: usize) -> String {
    let mut b = vec![0u8; bytes];
    getrandom::fill(&mut b).expect("system random source");
    b.iter().map(|x| format!("{x:02x}")).collect()
}

fn hash(token: &str) -> String {
    Sha256::digest(token.as_bytes()).iter().map(|x| format!("{x:02x}")).collect()
}

fn save_config(app: &AppHandle, c: &Config) {
    if let Ok(dir) = crate::data_dir(app) {
        if let Ok(json) = serde_json::to_vec_pretty(c) {
            let _ = crate::atomic_write(&dir.join(CONFIG_FILE), &json);
        }
    }
}

/// This PC's address on the home network (no packets are sent; this only asks the OS for a route).
fn lan_ip() -> Option<String> {
    let s = std::net::UdpSocket::bind("0.0.0.0:0").ok()?;
    s.connect("192.0.2.1:80").ok()?;
    Some(s.local_addr().ok()?.ip().to_string())
}

/// Called after the desktop app saves, so devices pick up the change.
pub fn notify_desktop_save(app: &AppHandle, json: &str) {
    if let Some(r) = app.try_state::<Remote>() {
        let _ = r.tx.send(Msg::Data { from: "desktop".into(), json: json.to_string() });
    }
}

/// Start the server at launch if it was left on.
pub fn init(app: &AppHandle) {
    let config: Config = crate::data_dir(app)
        .ok()
        .and_then(|d| fs::read(d.join(CONFIG_FILE)).ok())
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or_default();
    let enabled = config.enabled;
    app.state::<Remote>().inner.lock().unwrap().config = config;
    if enabled {
        start(app);
    }
}

fn stop(app: &AppHandle) {
    let r = app.state::<Remote>();
    let shutdown = r.inner.lock().unwrap().shutdown.take();
    if let Some(tx) = shutdown {
        let _ = tx.send(());
        let _ = r.tx.send(Msg::Shutdown);
    }
}

fn start(app: &AppHandle) {
    stop(app);
    let r = app.state::<Remote>();
    let port = { r.inner.lock().unwrap().config.port };
    let listener = match std::net::TcpListener::bind(("0.0.0.0", port)).and_then(|l| l.set_nonblocking(true).map(|_| l)) {
        Ok(l) => l,
        Err(e) => {
            r.inner.lock().unwrap().error = Some(format!("Couldn't use port {port}: {e}"));
            return;
        }
    };
    let (tx, rx) = oneshot::channel();
    {
        let mut inner = r.inner.lock().unwrap();
        inner.shutdown = Some(tx);
        inner.error = None;
    }
    let router = Router::new()
        .route("/api/status", get(status))
        .route("/api/pair", post(pair))
        .route("/api/data", get(get_data).put(put_data))
        .route("/api/events", get(events))
        .route("/api/attachment", post(upload))
        .route("/api/file/{*rel}", get(file))
        .fallback(get(asset))
        .layer(DefaultBodyLimit::max(512 * 1024 * 1024))
        .with_state(app.clone());
    tauri::async_runtime::spawn(async move {
        if let Ok(l) = tokio::net::TcpListener::from_std(listener) {
            let _ = axum::serve(l, router).with_graceful_shutdown(async { let _ = rx.await; }).await;
        }
    });
}

// ---- Auth ----

/// The paired device making this request, if any (also records when it was last seen).
fn device(app: &AppHandle, headers: &HeaderMap) -> Option<Device> {
    let token = headers
        .get_all(header::COOKIE)
        .iter()
        .filter_map(|v| v.to_str().ok())
        .flat_map(|v| v.split(';'))
        .find_map(|kv| kv.trim().strip_prefix(&format!("{COOKIE}=")).map(str::to_string))?;
    let h = hash(&token);
    let r = app.state::<Remote>();
    let mut inner = r.inner.lock().unwrap();
    let now = crate::now_secs();
    let d = inner.config.devices.iter_mut().find(|d| d.token_hash == h)?;
    let stale = now.saturating_sub(d.last_seen) > 600;
    d.last_seen = now;
    let found = d.clone();
    if stale {
        save_config(app, &inner.config);
    }
    Some(found)
}

fn unauthorized() -> Response {
    (StatusCode::UNAUTHORIZED, "This device isn't paired with Zomello").into_response()
}

// ---- Routes ----

async fn status(State(app): State<AppHandle>, headers: HeaderMap) -> Json<serde_json::Value> {
    let d = device(&app, &headers);
    Json(serde_json::json!({ "paired": d.is_some(), "name": d.map(|d| d.name) }))
}

#[derive(Deserialize)]
struct PairReq {
    code: String,
    name: String,
}

async fn pair(State(app): State<AppHandle>, Json(req): Json<PairReq>) -> Response {
    let r = app.state::<Remote>();
    let mut inner = r.inner.lock().unwrap();
    let ok = match inner.pairing.as_mut() {
        Some(p) if p.expires > Instant::now() && p.tries < PAIR_TRIES => {
            p.tries += 1;
            p.code == req.code.trim()
        }
        _ => false,
    };
    if !ok {
        return (StatusCode::FORBIDDEN, "That code is wrong or has expired. Make a new one on your PC.").into_response();
    }
    inner.pairing = None; // single use
    let token = random_hex(32);
    let name: String = req.name.trim().chars().take(60).collect();
    let now = crate::now_secs();
    inner.config.devices.push(Device {
        id: random_hex(8),
        name: if name.is_empty() { "Device".into() } else { name },
        token_hash: hash(&token),
        created: now,
        last_seen: now,
    });
    save_config(&app, &inner.config);
    drop(inner);
    let _ = app.emit("zomello://remote-changed", ());
    let cookie = format!("{COOKIE}={token}; Path=/; Max-Age=315360000; HttpOnly; SameSite=Strict");
    ([(header::SET_COOKIE, cookie)], "paired").into_response()
}

async fn get_data(State(app): State<AppHandle>, headers: HeaderMap) -> Response {
    if device(&app, &headers).is_none() {
        return unauthorized();
    }
    match crate::read_data(&app) {
        Ok(json) => ([(header::CONTENT_TYPE, "application/json")], json).into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, e).into_response(),
    }
}

async fn put_data(State(app): State<AppHandle>, headers: HeaderMap, body: String) -> Response {
    if device(&app, &headers).is_none() {
        return unauthorized();
    }
    if let Err(e) = crate::write_data(&app, &body) {
        return (StatusCode::BAD_REQUEST, e).into_response();
    }
    let from = headers.get("x-client").and_then(|v| v.to_str().ok()).unwrap_or("device").to_string();
    let _ = app.state::<Remote>().tx.send(Msg::Data { from, json: body.clone() });
    // Desktop windows adopt it the same way they adopt each other's saves.
    let _ = app.emit("zomello://data-changed", serde_json::json!({ "from": "remote", "json": body }));
    StatusCode::NO_CONTENT.into_response()
}

/// Server-sent events: the current data on connect, then every change.
async fn events(State(app): State<AppHandle>, headers: HeaderMap) -> Response {
    let Some(dev) = device(&app, &headers) else { return unauthorized() };
    let first = crate::read_data(&app).unwrap_or_default();
    let rx = app.state::<Remote>().tx.subscribe();
    let initial = stream::once(async move { Ok::<_, Infallible>(sse::Event::default().event("data").id("server").data(first)) });
    let updates = stream::unfold((rx, dev.id), |(mut rx, id)| async move {
        loop {
            match rx.recv().await {
                Ok(Msg::Data { from, json }) => {
                    return Some((Ok(sse::Event::default().event("data").id(from).data(json)), (rx, id)))
                }
                Ok(Msg::Revoked(d)) if d == id => return None,
                Ok(Msg::Shutdown) | Err(broadcast::error::RecvError::Closed) => return None,
                _ => continue,
            }
        }
    });
    let s: std::pin::Pin<Box<dyn Stream<Item = Result<sse::Event, Infallible>> + Send>> =
        Box::pin(futures_util::StreamExt::chain(initial, updates));
    sse::Sse::new(s).keep_alive(sse::KeepAlive::default()).into_response()
}

async fn upload(State(app): State<AppHandle>, headers: HeaderMap, body: Bytes) -> Response {
    if device(&app, &headers).is_none() {
        return unauthorized();
    }
    let name = headers.get("x-name").and_then(|v| v.to_str().ok()).map(crate::percent_decode).unwrap_or_else(|| "file".into());
    match crate::store_bytes(&app, &name, &body) {
        Ok(rel) => rel.into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, e).into_response(),
    }
}

async fn file(State(app): State<AppHandle>, headers: HeaderMap, UrlPath(rel): UrlPath<String>) -> Response {
    if device(&app, &headers).is_none() {
        return unauthorized();
    }
    match crate::attachment_path(&app, &rel) {
        Ok(path) => match fs::read(&path) {
            Ok(bytes) => ([(header::CONTENT_TYPE, crate::mime_for(&path))], bytes).into_response(),
            Err(_) => StatusCode::NOT_FOUND.into_response(),
        },
        Err(_) => StatusCode::FORBIDDEN.into_response(),
    }
}

/// The app itself (the same files the desktop window uses). index.html is marked so the page knows
/// it's running on a device.
async fn asset(State(app): State<AppHandle>, uri: axum::http::Uri) -> Response {
    let path = uri.path();
    let resolver = app.asset_resolver();
    let found = if path == "/" { None } else { resolver.get(path.to_string()) };
    match found {
        Some(a) => {
            // The resolver doesn't know .webmanifest; Chrome wants the proper type to offer "Install app".
            let mime = if path.ends_with(".webmanifest") { "application/manifest+json".to_string() } else { a.mime_type().to_string() };
            ([(header::CONTENT_TYPE, mime)], a.bytes().to_vec()).into_response()
        }
        None => match resolver.get("/index.html".into()) {
            Some(a) => {
                let html = String::from_utf8_lossy(&a.bytes()).replacen("<head>", "<head><script>window.__ZOMELLO_REMOTE__=1</script>", 1);
                ([(header::CONTENT_TYPE, "text/html; charset=utf-8"), (header::CACHE_CONTROL, "no-cache")], html).into_response()
            }
            None => (StatusCode::NOT_FOUND, "Zomello's app files aren't available in this build").into_response(),
        },
    }
}

// ---- Commands for the Settings page ----

#[derive(Serialize)]
pub struct DeviceInfo {
    id: String,
    name: String,
    created: u64,
    last_seen: u64,
}

#[derive(Serialize)]
pub struct Status {
    enabled: bool,
    running: bool,
    port: u16,
    url: Option<String>,
    error: Option<String>,
    devices: Vec<DeviceInfo>,
}

fn status_of(app: &AppHandle) -> Status {
    let r = app.state::<Remote>();
    let inner = r.inner.lock().unwrap();
    let port = inner.config.port;
    Status {
        enabled: inner.config.enabled,
        running: inner.shutdown.is_some(),
        port,
        url: lan_ip().map(|ip| format!("http://{ip}:{port}/")),
        error: inner.error.clone(),
        devices: inner
            .config
            .devices
            .iter()
            .map(|d| DeviceInfo { id: d.id.clone(), name: d.name.clone(), created: d.created, last_seen: d.last_seen })
            .collect(),
    }
}

#[tauri::command]
pub fn remote_status(app: AppHandle) -> Status {
    status_of(&app)
}

#[tauri::command]
pub fn remote_set_enabled(app: AppHandle, enabled: bool, port: Option<u16>) -> Status {
    {
        let r = app.state::<Remote>();
        let mut inner = r.inner.lock().unwrap();
        inner.config.enabled = enabled;
        if let Some(p) = port.filter(|p| *p >= 1024) {
            inner.config.port = p;
        }
        save_config(&app, &inner.config);
    }
    if enabled { start(&app) } else { stop(&app) }
    status_of(&app)
}

#[derive(Serialize)]
pub struct PairingInfo {
    code: String,
    url: String,
    qr_svg: String,
    expires_in: u64,
}

#[tauri::command]
pub fn remote_start_pairing(app: AppHandle) -> Result<PairingInfo, String> {
    let st = status_of(&app);
    let url = st.url.ok_or("Couldn't find this PC's address on the network")?;
    let mut b = [0u8; 4];
    getrandom::fill(&mut b).map_err(|e| e.to_string())?;
    let code = format!("{:06}", u32::from_le_bytes(b) % 1_000_000);
    app.state::<Remote>().inner.lock().unwrap().pairing =
        Some(Pairing { code: code.clone(), expires: Instant::now() + PAIR_TTL, tries: 0 });
    // The code rides in the #fragment, which browsers never send to the server.
    let link = format!("{url}#pair={code}");
    let qr_svg = qrcode::QrCode::new(link.as_bytes())
        .map_err(|e| e.to_string())?
        .render::<qrcode::render::svg::Color>()
        .min_dimensions(220, 220)
        .build();
    Ok(PairingInfo { code, url, qr_svg, expires_in: PAIR_TTL.as_secs() })
}

#[tauri::command]
pub fn remote_cancel_pairing(app: AppHandle) {
    app.state::<Remote>().inner.lock().unwrap().pairing = None;
}

#[tauri::command]
pub fn remote_unlink(app: AppHandle, id: String) -> Status {
    {
        let r = app.state::<Remote>();
        let mut inner = r.inner.lock().unwrap();
        inner.config.devices.retain(|d| d.id != id);
        save_config(&app, &inner.config);
        let _ = r.tx.send(Msg::Revoked(id));
    }
    status_of(&app)
}

#[tauri::command]
pub fn remote_rename(app: AppHandle, id: String, name: String) -> Status {
    {
        let r = app.state::<Remote>();
        let mut inner = r.inner.lock().unwrap();
        if let Some(d) = inner.config.devices.iter_mut().find(|d| d.id == id) {
            d.name = name.trim().chars().take(60).collect();
        }
        save_config(&app, &inner.config);
    }
    status_of(&app)
}
