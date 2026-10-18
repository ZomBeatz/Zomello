//! Phone app: share this phone's boards with your computer, live, while both are on the same network.
//!
//! Runs in the app itself (not the page), so it works whichever boards are on screen. With the link
//! details your computer gave it (its address, a link token, and its certificate authority, saved by
//! the computer's page in places.json), it connects to the computer's phone & tablet server over https,
//! trusting only that certificate. It sends this phone's data when it connects and whenever it changes,
//! checks in every few seconds, and applies the edits made on the computer. If the computer can't be
//! reached it quietly tries again later; nothing is shared any other way.

// Started on phones and tablets only; on a computer this is the other end (link.rs).
#![cfg_attr(desktop, allow(dead_code))]

use crate::places;
use bytes::Bytes;
use http_body_util::{BodyExt, Empty, Full};
use hyper::{header, Request};
use hyper_util::rt::TokioIo;
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Mutex, OnceLock,
    },
    time::Duration,
};
use tauri::{AppHandle, Emitter};
use tokio::sync::{oneshot, Notify};

/// This phone's data changed (it gets sent at the next chance).
static DIRTY: AtomicBool = AtomicBool::new(true);
fn wake() -> &'static Notify {
    static N: OnceLock<Notify> = OnceLock::new();
    N.get_or_init(Notify::new)
}
/// Called after this phone's data is saved.
pub fn data_changed() {
    DIRTY.store(true, Ordering::SeqCst);
    wake().notify_one();
}

/// Edits from the computer handed to the page, waiting for it to say it applied them.
static ACKS: Mutex<Option<HashMap<u64, oneshot::Sender<()>>>> = Mutex::new(None);
static SEQ: AtomicU64 = AtomicU64::new(1);

/// The page applied edits `seq` (it saves them itself).
#[tauri::command]
pub fn link_ops_ack(seq: u64) {
    if let Some(tx) = ACKS.lock().unwrap().get_or_insert_with(HashMap::new).remove(&seq) {
        let _ = tx.send(());
    }
}

struct Link {
    origin: tauri::Url,
    token: String,
    tls: Arc<rustls::ClientConfig>,
}

fn link_of(app: &AppHandle) -> Option<Link> {
    let l = places::link(app)?;
    let origin = tauri::Url::parse(l["origin"].as_str()?).ok()?;
    let mut roots = rustls::RootCertStore::empty();
    for der in pem_certs(l["ca"].as_str()?) {
        roots.add(der.into()).ok()?;
    }
    let tls = rustls::ClientConfig::builder_with_provider(Arc::new(rustls::crypto::ring::default_provider()))
        .with_safe_default_protocol_versions()
        .ok()?
        .with_root_certificates(roots)
        .with_no_client_auth();
    Some(Link { origin, token: l["token"].as_str()?.to_string(), tls: Arc::new(tls) })
}

/// Start the link (phones and tablets). Runs while the app does.
pub fn start(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let mut wait = 2;
        loop {
            match link_of(&app) {
                Some(link) => match run(&app, &link).await {
                    Ok(()) => wait = 2,
                    Err(e) => {
                        log::info(&format!("link: {e}"));
                        wait = (wait * 2).min(30);
                    }
                },
                None => wait = 5,
            }
            tokio::time::sleep(Duration::from_secs(wait)).await;
        }
    });
}

mod log {
    pub fn info(s: &str) {
        eprintln!("{s}");
    }
}

/// One https request to the computer. Returns the status and the (streaming) body.
async fn request(link: &Link, method: &str, path: &str, body: Option<String>) -> Result<(u16, hyper::body::Incoming), String> {
    let host = link.origin.host_str().ok_or("no host")?.to_string();
    let port = link.origin.port_or_known_default().unwrap_or(443);
    let tcp = tokio::time::timeout(Duration::from_secs(6), tokio::net::TcpStream::connect((host.as_str(), port)))
        .await
        .map_err(|_| "computer not reachable".to_string())?
        .map_err(|e| e.to_string())?;
    let name = rustls::pki_types::ServerName::try_from(host.clone()).map_err(|e| e.to_string())?;
    let tls = tokio::time::timeout(Duration::from_secs(8), tokio_rustls::TlsConnector::from(link.tls.clone()).connect(name, tcp))
        .await
        .map_err(|_| "secure connection timed out".to_string())?
        .map_err(|e| format!("secure connection: {e}"))?;
    let (mut sender, conn) = hyper::client::conn::http1::handshake(TokioIo::new(tls)).await.map_err(|e| e.to_string())?;
    tokio::spawn(async move {
        let _ = conn.await;
    });
    let req = Request::builder()
        .method(method)
        .uri(path)
        .header(header::HOST, format!("{host}:{port}"))
        .header(header::AUTHORIZATION, format!("Bearer {}", link.token))
        .header(header::USER_AGENT, "Zomello phone link");
    let res = match body {
        Some(b) => sender
            .send_request(req.header(header::CONTENT_TYPE, "application/json").body(Full::new(Bytes::from(b)).boxed()).map_err(|e| e.to_string())?)
            .await,
        None => sender.send_request(req.body(Empty::<Bytes>::new().boxed()).map_err(|e| e.to_string())?).await,
    }
    .map_err(|e| e.to_string())?;
    Ok((res.status().as_u16(), res.into_body()))
}

async fn send_snapshot(app: &AppHandle, link: &Link) -> Result<(), String> {
    DIRTY.store(false, Ordering::SeqCst);
    let data = crate::read_data(app).unwrap_or_default();
    let (status, _) = request(link, "PUT", "/api/link/snapshot", Some(if data.is_empty() { "{}".into() } else { data })).await?;
    if status >= 300 {
        DIRTY.store(true, Ordering::SeqCst);
        return Err(format!("snapshot refused ({status})"));
    }
    Ok(())
}

/// Connected: listen for the computer's edits, send ours, check in.
async fn run(app: &AppHandle, link: &Link) -> Result<(), String> {
    let (status, mut body) = request(link, "GET", "/api/link/events", None).await?;
    if status == 401 {
        // Unlinked on the computer (or the phone was unpaired): stop until it's set up again.
        places::forget_link(app);
        return Err("the computer no longer knows this phone".into());
    }
    if status != 200 {
        return Err(format!("computer said {status}"));
    }
    send_snapshot(app, link).await?;
    let mut buf = String::new();
    let mut tick = tokio::time::interval(Duration::from_secs(15));
    tick.tick().await;
    loop {
        tokio::select! {
            frame = body.frame() => match frame {
                None => return Ok(()),
                Some(Err(e)) => return Err(e.to_string()),
                Some(Ok(f)) => {
                    if let Some(d) = f.data_ref() {
                        buf.push_str(&String::from_utf8_lossy(d).replace("\r\n", "\n"));
                        while let Some(i) = buf.find("\n\n") {
                            let event: String = buf.drain(..i + 2).collect();
                            handle(app, link, &event).await;
                        }
                    }
                }
            },
            _ = tick.tick() => {
                if DIRTY.load(Ordering::SeqCst) {
                    send_snapshot(app, link).await?;
                } else {
                    let (s, _) = request(link, "POST", "/api/link/ping", None).await?;
                    if s == 409 {
                        return Err("computer forgot this connection".into());
                    }
                }
            },
            _ = wake().notified() => {
                // A little pause gathers a burst of saves into one send.
                tokio::time::sleep(Duration::from_millis(600)).await;
                if DIRTY.load(Ordering::SeqCst) {
                    send_snapshot(app, link).await?;
                }
            },
        }
    }
}

/// An event from the computer: `event: ops` with the edits made there, or `event: board` with a board
/// it sent this phone.
async fn handle(app: &AppHandle, link: &Link, event: &str) {
    let mut name = "message";
    let mut data = String::new();
    for line in event.lines() {
        if let Some(v) = line.strip_prefix("event:") {
            name = v.trim();
        } else if let Some(v) = line.strip_prefix("data:") {
            data.push_str(v.trim_start());
        }
    }
    if name == "board" {
        return receive_board(app, link, &data).await;
    }
    if name != "ops" {
        return;
    }
    let Ok(ops) = serde_json::from_str::<Value>(&data) else { return };
    // The phone's own page, if it's on screen, applies them (and saves); otherwise apply them to the file.
    let seq = SEQ.fetch_add(1, Ordering::SeqCst);
    let (tx, rx) = oneshot::channel();
    ACKS.lock().unwrap().get_or_insert_with(HashMap::new).insert(seq, tx);
    let _ = app.emit("zomello://link-ops", json!({ "seq": seq, "ops": ops }));
    if tokio::time::timeout(Duration::from_millis(1500), rx).await.is_ok() {
        return;
    }
    ACKS.lock().unwrap().get_or_insert_with(HashMap::new).remove(&seq);
    let Ok(text) = crate::read_data(app) else { return };
    let Ok(mut data) = serde_json::from_str::<Value>(if text.is_empty() { "{}" } else { &text }) else { return };
    apply_ops(&mut data, &ops);
    if crate::write_data(app, &data.to_string()).is_ok() {
        data_changed();
    }
}

/// A board your computer sent: it waits in the app for this phone's page (which adds it right away if
/// it's on screen), and the computer hears that it arrived.
async fn receive_board(app: &AppHandle, link: &Link, data: &str) {
    let Ok(v) = serde_json::from_str::<Value>(data) else { return };
    let Some(bytes) = v["file"].as_str().and_then(base64_decode) else { return };
    if places::queue_board(app, "phone", &bytes).is_err() {
        return;
    }
    let _ = app.emit("zomello://boards-arrived", ());
    let _ = request(link, "POST", "/api/link/board-received", Some(json!({ "id": v["id"] }).to_string())).await;
}

/// Upserts and deletes of boards, buckets ("lists") and cards, by id.
pub fn apply_ops(data: &mut Value, ops: &Value) {
    for kind in ["boards", "lists", "cards"] {
        if !data[kind].is_object() {
            data[kind] = json!({});
        }
        for e in ops["upserts"][kind].as_array().into_iter().flatten() {
            if let Some(id) = e["id"].as_str() {
                data[kind][id] = e.clone();
            }
        }
        for id in ops["deletes"][kind].as_array().into_iter().flatten().filter_map(Value::as_str) {
            if let Some(m) = data[kind].as_object_mut() {
                m.remove(id);
            }
        }
    }
}

/// The certificates in a PEM text (base64 between BEGIN/END lines).
fn pem_certs(pem: &str) -> Vec<Vec<u8>> {
    let mut out = Vec::new();
    let mut cur: Option<String> = None;
    for line in pem.lines().map(str::trim) {
        if line.starts_with("-----BEGIN CERTIFICATE") {
            cur = Some(String::new());
        } else if line.starts_with("-----END CERTIFICATE") {
            if let Some(b) = cur.take().and_then(|s| base64_decode(&s)) {
                out.push(b);
            }
        } else if let Some(s) = cur.as_mut() {
            s.push_str(line);
        }
    }
    out
}

fn base64_decode(s: &str) -> Option<Vec<u8>> {
    let val = |c: u8| -> Option<u32> {
        Some(match c {
            b'A'..=b'Z' => c - b'A',
            b'a'..=b'z' => c - b'a' + 26,
            b'0'..=b'9' => c - b'0' + 52,
            b'+' => 62,
            b'/' => 63,
            _ => return None,
        } as u32)
    };
    let bytes: Vec<u8> = s.bytes().filter(|c| !c.is_ascii_whitespace() && *c != b'=').collect();
    let mut out = Vec::with_capacity(bytes.len() * 3 / 4);
    for chunk in bytes.chunks(4) {
        let mut n = 0u32;
        for (i, &c) in chunk.iter().enumerate() {
            n |= val(c)? << (18 - 6 * i);
        }
        out.push((n >> 16) as u8);
        if chunk.len() > 2 {
            out.push((n >> 8) as u8);
        }
        if chunk.len() > 3 {
            out.push(n as u8);
        }
    }
    Some(out)
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    #[test]
    fn applies_edits_by_id() {
        let mut d = json!({ "boards": { "b": { "id": "b", "title": "Old" } }, "cards": { "c1": { "id": "c1" }, "c2": { "id": "c2" } } });
        super::apply_ops(&mut d, &json!({ "upserts": { "boards": [{ "id": "b", "title": "New" }], "lists": [{ "id": "l" }] }, "deletes": { "cards": ["c1"] } }));
        assert_eq!(d["boards"]["b"]["title"], "New");
        assert_eq!(d["lists"]["l"]["id"], "l");
        assert!(d["cards"].get("c1").is_none() && d["cards"].get("c2").is_some());
    }

    #[test]
    fn reads_pem() {
        let pem = "-----BEGIN CERTIFICATE-----\nAAEC\nAw==\n-----END CERTIFICATE-----\n";
        assert_eq!(super::pem_certs(pem), vec![vec![0, 1, 2, 3]]);
    }
}
