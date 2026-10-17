//! Zomello Servers, Plex style: the app keeps your own boards, and you can also add any number of
//! Zomello Servers (yours, or ones other people invite you to). Each server opens in its own window
//! showing that server's web app, signed in with your account there. The window only ever shows
//! that one server; links elsewhere open in the browser.

use serde::Serialize;
use std::collections::HashMap;
use std::sync::Mutex;
#[cfg(desktop)]
use tauri::{AppHandle, Manager};

/// Window label → the one origin (scheme://host:port) that window may show.
static ORIGINS: Mutex<Option<HashMap<String, String>>> = Mutex::new(None);

pub fn origin_of(url: &tauri::Url) -> String {
    format!("{}://{}", url.scheme(), url.host_str().unwrap_or("")) + &url.port().map(|p| format!(":{p}")).unwrap_or_default()
}

/// Navigation rule for server windows: stay on the server. `None` means "not a server window".
pub fn allows(label: &str, url: &tauri::Url) -> Option<bool> {
    let map = ORIGINS.lock().unwrap();
    let origin = map.as_ref()?.get(label)?;
    Some(&origin_of(url) == origin)
}

fn parse(address: &str) -> Result<tauri::Url, String> {
    let a = address.trim().trim_end_matches('/');
    let with_scheme = if a.contains("://") { a.to_string() } else { format!("https://{a}") };
    let url = tauri::Url::parse(&with_scheme).map_err(|_| "That isn't a web address".to_string())?;
    if !matches!(url.scheme(), "http" | "https") || url.host_str().is_none() {
        return Err("Use an address like https://zomello.example.com or http://192.168.1.50:7311".into());
    }
    Ok(url)
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ServerCheck {
    /// The cleaned-up address to save (scheme://host:port).
    url: String,
    ok: bool,
    version: Option<String>,
    setup_needed: bool,
    /// Uses a certificate this app can't verify (Zomello's own, or another self-made one).
    cert_problem: bool,
    error: Option<String>,
}

/// Is there a Zomello Server at this address? Without `http://` or `https://`, https is tried first,
/// then plain http (home servers often run without https).
#[tauri::command]
pub async fn check_server(address: String) -> Result<ServerCheck, String> {
    let url = parse(&address)?;
    let first = probe(&origin_of(&url)).await;
    if first.ok || first.cert_problem || address.contains("://") {
        return Ok(first);
    }
    let mut http = url.clone();
    let _ = http.set_scheme("http");
    let second = probe(&origin_of(&http)).await;
    Ok(if second.ok { second } else { first })
}

async fn probe(base: &str) -> ServerCheck {
    let mut out = ServerCheck { url: base.to_string(), ok: false, version: None, setup_needed: false, cert_problem: false, error: None };
    match crate::calendar::fetch_text(&format!("{base}/api/session")).await {
        Ok(body) => match serde_json::from_str::<serde_json::Value>(&body) {
            Ok(v) if v.get("setupNeeded").is_some() => {
                out.ok = true;
                out.version = v.get("version").and_then(|x| x.as_str()).map(str::to_string);
                out.setup_needed = v["setupNeeded"].as_bool().unwrap_or(false);
            }
            _ => out.error = Some("Something answered at that address, but it isn't a Zomello Server.".into()),
        },
        Err(e) => {
            let lower = e.to_lowercase();
            out.cert_problem = lower.contains("certificate") || lower.contains("unknownissuer") || lower.contains("invalid peer");
            out.error = Some(if out.cert_problem {
                "This server uses its own certificate, which this computer doesn't trust yet.".into()
            } else {
                format!("Couldn't reach a Zomello Server there ({e}).")
            });
        }
    }
    out
}

#[derive(Serialize, Debug)]
pub struct FoundServer {
    name: String,
    url: String,
    version: Option<String>,
}

/// Zomello Servers on this network that announce themselves (see the server's discovery.rs).
/// Listens for a few seconds; servers in Docker or behind some routers won't show up.
#[tauri::command]
pub async fn find_servers() -> Result<Vec<FoundServer>, String> {
    tokio::task::spawn_blocking(|| {
        let daemon = mdns_sd::ServiceDaemon::new().map_err(|e| e.to_string())?;
        let rx = daemon.browse("_zomello._tcp.local.").map_err(|e| e.to_string())?;
        let until = std::time::Instant::now() + std::time::Duration::from_millis(3000);
        // One entry per server (it can answer on several networks), with its most useful address.
        let mut found: Vec<(String, u8, FoundServer)> = Vec::new();
        while let Some(left) = until.checked_duration_since(std::time::Instant::now()) {
            let Ok(event) = rx.recv_timeout(left) else { break };
            let mdns_sd::ServiceEvent::ServiceResolved(s) = event else { continue };
            let Some((rank, ip)) = s.addresses.iter().map(|a| a.to_ip_addr()).filter_map(|ip| Some((address_rank(&ip)?, ip))).min_by_key(|(r, _)| *r) else {
                continue;
            };
            let scheme = s.get_property_val_str("scheme").filter(|x| *x == "https").unwrap_or("http");
            let host = match ip {
                std::net::IpAddr::V6(v6) => format!("[{v6}]"),
                v4 => v4.to_string(),
            };
            let server = FoundServer {
                name: s.get_property_val_str("name").map(str::to_string).unwrap_or_else(|| s.host.trim_end_matches(".local.").to_string()),
                url: format!("{scheme}://{host}:{}", s.port),
                version: s.get_property_val_str("version").map(str::to_string),
            };
            match found.iter_mut().find(|(name, _, _)| *name == s.fullname) {
                Some(entry) if rank < entry.1 => *entry = (s.fullname.clone(), rank, server),
                Some(_) => {}
                None => found.push((s.fullname.clone(), rank, server)),
            }
        }
        let _ = daemon.shutdown();
        Ok(found.into_iter().map(|(_, _, f)| f).collect())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// How good an address is for reaching a server from this network; None = unusable.
/// Home networks (192.168.x, 10.x) beat 172.16–31.x, which is often Docker's own internal network.
fn address_rank(ip: &std::net::IpAddr) -> Option<u8> {
    match ip {
        std::net::IpAddr::V4(v4) if v4.is_loopback() || v4.is_link_local() || v4.is_unspecified() => None,
        std::net::IpAddr::V4(v4) if v4.octets()[0] == 192 && v4.octets()[1] == 168 => Some(0),
        std::net::IpAddr::V4(v4) if v4.octets()[0] == 10 => Some(1),
        std::net::IpAddr::V4(v4) if v4.is_private() => Some(3),
        std::net::IpAddr::V4(_) => Some(2),
        std::net::IpAddr::V6(v6) if v6.is_loopback() || (v6.segments()[0] & 0xffc0) == 0xfe80 => None,
        std::net::IpAddr::V6(_) => Some(4),
    }
}

/// Open (or bring forward) a server's window (desktop; the phone apps open servers in the browser).
#[cfg(desktop)]
#[tauri::command]
pub async fn open_server_window(app: AppHandle, id: String, address: String, name: String) -> Result<(), String> {
    let url = parse(&address)?;
    let id: String = id.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '-').collect();
    let label = format!("server-{id}");
    ORIGINS.lock().unwrap().get_or_insert_with(HashMap::new).insert(label.clone(), origin_of(&url));
    if let Some(w) = app.get_webview_window(&label) {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
        return Ok(());
    }
    let window = tauri::WebviewWindowBuilder::new(&app, &label, tauri::WebviewUrl::External(url))
        .title(format!("{name} — Zomello"))
        .inner_size(1300.0, 860.0)
        .min_inner_size(700.0, 500.0)
        .build()
        .map_err(|e| e.to_string())?;
    crate::enable_spellcheck(&window);
    Ok(())
}

#[cfg(test)]
mod tests {
    /// Needs a Zomello Server on port 7400: `cargo test --lib servers -- --ignored`
    #[tokio::test]
    #[ignore]
    async fn finds_a_local_server() {
        let r = super::check_server("http://localhost:7400/".into()).await.unwrap();
        assert!(r.ok, "{:?}", r.error);
        assert_eq!(r.url, "http://localhost:7400");
        // No scheme typed: https fails against this plain-http server, so it falls back to http.
        let r = super::check_server("localhost:7400".into()).await.unwrap();
        assert!(r.ok, "{:?}", r.error);
        assert_eq!(r.url, "http://localhost:7400");
        let r = super::check_server("http://localhost:1".into()).await.unwrap();
        assert!(!r.ok && !r.cert_problem);
        assert!(super::check_server("ftp://x".into()).await.is_err());
    }

    /// Needs a Zomello Server on port 7400 with discovery on.
    #[tokio::test]
    #[ignore]
    async fn finds_servers_on_the_network() {
        let found = super::find_servers().await.unwrap();
        println!("{found:?}");
        assert!(found.iter().any(|f| f.url.ends_with(":7400") && f.url.starts_with("http://")), "{found:?}");
    }
}
