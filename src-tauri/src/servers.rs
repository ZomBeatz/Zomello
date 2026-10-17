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
}
