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
use std::sync::Arc;
use tokio::sync::{broadcast, watch};

const CONFIG_FILE: &str = "remote.json";
const DEFAULT_PORT: u16 = 7311;
const PAIR_TTL: Duration = Duration::from_secs(10 * 60);
const PAIR_TRIES: u32 = 5;
const COOKIE: &str = "zomello_device";
const CA_CERT: &str = "remote-ca.pem";
const CA_KEY: &str = "remote-ca-key.pem";

#[derive(Serialize, Deserialize, Clone)]
struct Device {
    id: String,
    name: String,
    token_hash: String,
    created: u64,
    last_seen: u64,
    /// The Zomello app on this device links with this (its boards show on this computer while it's
    /// connected). Hashed, like the sign-in token.
    #[serde(default)]
    link_token_hash: Option<String>,
    /// Show this device's boards on this computer while it's connected.
    #[serde(default = "yes")]
    show_boards: bool,
}

fn yes() -> bool {
    true
}

/// A paired device, as the phone-link code needs it.
pub struct DeviceRef {
    pub id: String,
    pub name: String,
}

/// The device whose app is linking with this token.
pub fn device_by_link_token(app: &AppHandle, token: &str) -> Option<DeviceRef> {
    let h = hash(token);
    let r = app.state::<Remote>();
    let inner = r.inner.lock().unwrap();
    inner
        .config
        .devices
        .iter()
        .find(|d| d.link_token_hash.as_deref() == Some(h.as_str()))
        .map(|d| DeviceRef { id: d.id.clone(), name: d.name.clone() })
}

/// A paired device (signed in with its cookie) asks for a token for its app to link with.
pub fn new_link_token(app: &AppHandle, headers: &HeaderMap) -> Option<String> {
    let dev = device(app, headers)?;
    let token = random_hex(32);
    let r = app.state::<Remote>();
    let mut inner = r.inner.lock().unwrap();
    let d = inner.config.devices.iter_mut().find(|d| d.id == dev.id)?;
    d.link_token_hash = Some(hash(&token));
    save_config(app, &inner.config);
    Some(token)
}

/// The paired device making this request (signed in with its cookie), if any.
pub fn requester(app: &AppHandle, headers: &HeaderMap) -> Option<String> {
    device(app, headers).map(|d| d.id)
}

/// A connected phone's boards changed (or it came or went): tell the other devices' pages.
pub fn notify_linked(app: &AppHandle, id: &str) {
    let _ = app.state::<Remote>().tx.send(Msg::Linked(id.to_string()));
}

/// Devices whose boards are hidden on this computer.
pub fn hidden_devices(app: &AppHandle) -> Vec<String> {
    let r = app.state::<Remote>();
    let inner = r.inner.lock().unwrap();
    inner.config.devices.iter().filter(|d| !d.show_boards).map(|d| d.id.clone()).collect()
}

#[derive(Serialize, Deserialize)]
struct Config {
    enabled: bool,
    port: u16,
    devices: Vec<Device>,
    /// The port this PC's firewall was opened for (via "Allow through firewall").
    #[serde(default)]
    firewall_port: Option<u16>,
    /// Address devices use to reach this PC (an IP or a name). None = detect automatically.
    #[serde(default)]
    address: Option<String>,
    /// What the certificate authority may vouch for, e.g. "ip:192.168.0.0/16", "dns:local".
    /// Empty = a CA from before this was recorded (home-network IPs and *.local).
    #[serde(default)]
    ca_scope: Vec<String>,
    /// When the CA was made (unix seconds; 0 = unknown).
    #[serde(default)]
    ca_created: u64,
}

impl Default for Config {
    fn default() -> Self {
        Config {
            enabled: false,
            port: DEFAULT_PORT,
            devices: vec![],
            firewall_port: None,
            address: None,
            ca_scope: vec![],
            ca_created: 0,
        }
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
    /// A connected phone's boards changed (or it came or went).
    Linked(String),
    /// The server is stopping.
    Shutdown,
}

#[derive(Default)]
struct Inner {
    config: Config,
    pairing: Option<Pairing>,
    shutdown: Option<watch::Sender<bool>>,
    /// This PC's certificate authority (PEM), installed on devices so Chrome trusts the https address.
    ca_pem: Option<String>,
    /// The running server's certificate holder (swapped when the address or CA changes).
    slot: Option<Arc<CertSlot>>,
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

pub fn random_hex(bytes: usize) -> String {
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

/// Every IPv4 address this PC has on a network (Wi‑Fi, Ethernet, VPNs like Tailscale…), the one
/// used for the internet first.
fn detected_ips() -> Vec<String> {
    let mut out: Vec<String> = lan_ip().into_iter().collect();
    for iface in if_addrs::get_if_addrs().unwrap_or_default() {
        if let std::net::IpAddr::V4(a) = iface.ip() {
            if !a.is_loopback() && !a.is_link_local() && !a.is_unspecified() && !out.contains(&a.to_string()) {
                out.push(a.to_string());
            }
        }
    }
    out
}

/// The address devices are told to use: the one chosen in Settings, else the detected one.
fn host_of(c: &Config) -> Option<String> {
    c.address.clone().or_else(lan_ip)
}

/// An IPv4 address or a host name (letters, digits, dots, dashes).
fn valid_address(a: &str) -> bool {
    a.parse::<std::net::Ipv4Addr>().is_ok()
        || (!a.is_empty()
            && a.len() <= 253
            && a.split('.').all(|l| !l.is_empty() && l.len() <= 63 && l.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')))
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
        let _ = tx.send(true);
        let _ = r.tx.send(Msg::Shutdown);
    }
}

fn start(app: &AppHandle) {
    stop(app);
    let r = app.state::<Remote>();
    let port = { r.inner.lock().unwrap().config.port };
    // A server that was just stopped may hold the port for a moment.
    let mut bound = std::net::TcpListener::bind(("0.0.0.0", port));
    for _ in 0..20 {
        if bound.is_ok() {
            break;
        }
        std::thread::sleep(Duration::from_millis(100));
        bound = std::net::TcpListener::bind(("0.0.0.0", port));
    }
    let listener = match bound.and_then(|l| l.set_nonblocking(true).map(|_| l)) {
        Ok(l) => l,
        Err(e) => {
            r.inner.lock().unwrap().error = Some(format!("Couldn't use port {port}: {e}"));
            return;
        }
    };
    let (tls, slot) = match tls_config(app) {
        Ok(t) => t,
        Err(e) => {
            r.inner.lock().unwrap().error = Some(format!("Couldn't set up the secure connection: {e}"));
            return;
        }
    };
    let (tx, rx) = watch::channel(false);
    {
        let mut inner = r.inner.lock().unwrap();
        inner.shutdown = Some(tx);
        inner.slot = Some(slot.clone());
        inner.error = None;
    }
    let router = Router::new()
        .route("/api/status", get(status))
        .route("/api/pair", post(pair))
        .route("/api/data", get(get_data).put(put_data))
        .route("/api/events", get(events))
        .route("/api/attachment", post(upload))
        .route("/api/file/{*rel}", get(file))
        .route("/api/calendar/{board}/{feed}", get(calendar_feed))
        .route("/setup", get(setup_page))
        .route("/zomello-ca.crt", get(ca_cert))
        // The phone app's boards on this computer (link.rs).
        .route("/api/link/token", post(crate::link::link_token))
        .route("/api/link/events", get(crate::link::link_events))
        .route("/api/link/snapshot", axum::routing::put(crate::link::link_snapshot))
        .route("/api/link/ping", post(crate::link::link_ping))
        .route("/api/link/board-received", post(crate::link::link_board_received))
        // Your other connected devices' boards, for a device viewing this computer (link.rs).
        .route("/api/devices", get(crate::link::shared_devices))
        .route("/api/devices/events", get(devices_events))
        .route("/api/devices/{id}/data", get(crate::link::shared_data))
        .route("/api/devices/{id}/ops", post(crate::link::shared_ops))
        .fallback(get(asset))
        .layer(DefaultBodyLimit::max(512 * 1024 * 1024))
        .with_state(app.clone());
    let app2 = app.clone();
    let watch_stop = rx.clone();
    tauri::async_runtime::spawn(async move {
        if let Ok(l) = tokio::net::TcpListener::from_std(listener) {
            serve(l, router, tls, rx).await;
        }
    });
    let app3 = app2.clone();
    tauri::async_runtime::spawn(follow_address(app2, watch_stop.clone()));
    // Phones that went away (no word for a while) drop off this computer's sidebar.
    let mut stop_prune = watch_stop;
    tauri::async_runtime::spawn(async move {
        tokio::select! {
            _ = crate::link::prune(app3.clone()) => {}
            _ = stop_prune.changed() => crate::link::forget(&app3, None),
        }
    });
}

/// The PC's address can change (new router, no DHCP reservation). Check now and then and renew the
/// certificate in place, so phones keep working without anyone touching anything.
async fn follow_address(app: AppHandle, mut stop: watch::Receiver<bool>) {
    let mut seen = detected_ips();
    loop {
        tokio::select! {
            _ = stop.changed() => return,
            _ = tokio::time::sleep(Duration::from_secs(30)) => {}
        }
        let now = detected_ips();
        if now != seen && !now.is_empty() {
            seen = now;
            let _ = refresh_cert(&app);
            let _ = app.emit("zomello://remote-changed", ());
        }
    }
}

/// One port for both: https (what Chrome needs to install the app) and plain http (setup page,
/// certificate download, and devices that don't need https). The first byte tells them apart.
async fn serve(listener: tokio::net::TcpListener, router: Router, tls: Arc<rustls::ServerConfig>, mut stop: watch::Receiver<bool>) {
    let acceptor = tokio_rustls::TlsAcceptor::from(tls);
    loop {
        let stream = tokio::select! {
            _ = stop.changed() => return,
            r = listener.accept() => match r {
                Ok((s, _)) => s,
                Err(_) => continue,
            },
        };
        let (router, acceptor, mut stop) = (router.clone(), acceptor.clone(), stop.clone());
        tokio::spawn(async move {
            let mut first = [0u8; 1];
            let peeked = tokio::time::timeout(Duration::from_secs(20), stream.peek(&mut first)).await;
            let is_tls = matches!(peeked, Ok(Ok(1))) && first[0] == 0x16; // TLS handshake record
            let svc = hyper_util::service::TowerToHyperService::new(router);
            let http = hyper::server::conn::http1::Builder::new();
            // Turning access off closes every open connection, not just the listener.
            if is_tls {
                let Ok(s) = acceptor.accept(stream).await else { return };
                tokio::select! {
                    _ = http.serve_connection(hyper_util::rt::TokioIo::new(s), svc) => {}
                    _ = stop.changed() => {}
                }
            } else {
                tokio::select! {
                    _ = http.serve_connection(hyper_util::rt::TokioIo::new(stream), svc) => {}
                    _ = stop.changed() => {}
                }
            }
        });
    }
}

// ---- Certificates ----

/// Days since 1970-01-01 → (year, month, day).
fn civil_from_days(z: i64) -> (i32, u8, u8) {
    let z = z + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u8;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u8;
    ((yoe + era * 400 + i64::from(m <= 2)) as i32, m, d)
}

fn day(days_from_today: i64) -> (i32, u8, u8) {
    civil_from_days(crate::now_secs() as i64 / 86_400 + days_from_today)
}

/// What a CA made before scopes were recorded may vouch for: home-network IPs and *.local names.
const LEGACY_SCOPE: [&str; 4] = ["ip:10.0.0.0/8", "ip:172.16.0.0/12", "ip:192.168.0.0/16", "dns:local"];
/// New CAs also cover the names home routers commonly hand out.
const DEFAULT_SCOPE: [&str; 9] = [
    "ip:10.0.0.0/8",
    "ip:172.16.0.0/12",
    "ip:192.168.0.0/16",
    "dns:local",
    "dns:lan",
    "dns:home",
    "dns:home.arpa",
    "dns:internal",
    "dns:localdomain",
];

fn scope_of(c: &Config) -> Vec<String> {
    if c.ca_scope.is_empty() {
        LEGACY_SCOPE.iter().map(|s| s.to_string()).collect()
    } else {
        c.ca_scope.clone()
    }
}

fn parse_cidr(s: &str) -> Option<(u32, u32)> {
    let (ip, bits) = s.split_once('/')?;
    let ip = u32::from(ip.parse::<std::net::Ipv4Addr>().ok()?);
    let bits: u32 = bits.parse().ok().filter(|b| *b <= 32)?;
    let mask = if bits == 0 { 0 } else { u32::MAX << (32 - bits) };
    Some((ip & mask, mask))
}

/// Can a CA with this scope vouch for `addr`? (Browsers reject certificates outside it.)
fn covers(scope: &[String], addr: &str) -> bool {
    if let Ok(ip) = addr.parse::<std::net::Ipv4Addr>() {
        let ip = u32::from(ip);
        return scope.iter().filter_map(|s| s.strip_prefix("ip:")).filter_map(parse_cidr).any(|(net, mask)| ip & mask == net);
    }
    let a = addr.to_ascii_lowercase();
    scope.iter().filter_map(|s| s.strip_prefix("dns:")).any(|d| a == d || a.ends_with(&format!(".{d}")))
}

/// The CA may only vouch for these (home-network addresses and names, plus anything chosen when it was
/// made), so even a stolen copy couldn't be used to impersonate real websites on a device that trusts it.
fn subtrees(scope: &[String]) -> Vec<rcgen::GeneralSubtree> {
    scope
        .iter()
        .filter_map(|s| {
            if let Some(c) = s.strip_prefix("ip:") {
                let (net, mask) = parse_cidr(c)?;
                Some(rcgen::GeneralSubtree::IpAddress(rcgen::CidrSubnet::V4(net.to_be_bytes(), mask.to_be_bytes())))
            } else {
                s.strip_prefix("dns:").map(|d| rcgen::GeneralSubtree::DnsName(d.to_string()))
            }
        })
        .collect()
}

/// This PC's certificate authority: created once (or again via "Generate new certificate").
fn load_or_create_ca(app: &AppHandle) -> Result<(String, rcgen::KeyPair), String> {
    let dir = crate::data_dir(app)?;
    let (cert_path, key_path) = (dir.join(CA_CERT), dir.join(CA_KEY));
    if let (Ok(cert), Ok(key)) = (fs::read_to_string(&cert_path), fs::read_to_string(&key_path)) {
        if let Ok(k) = rcgen::KeyPair::from_pem(&key) {
            return Ok((cert, k));
        }
    }
    // New CA: home-network defaults, plus the chosen address if it's something else (e.g. a VPN address).
    let mut scope: Vec<String> = DEFAULT_SCOPE.iter().map(|s| s.to_string()).collect();
    let host = host_of(&app.state::<Remote>().inner.lock().unwrap().config);
    if let Some(h) = host.filter(|h| !covers(&scope, h)) {
        scope.push(if h.parse::<std::net::Ipv4Addr>().is_ok() { format!("ip:{h}/32") } else { format!("dns:{h}") });
    }

    let key = rcgen::KeyPair::generate().map_err(|e| e.to_string())?;
    let mut p = rcgen::CertificateParams::default();
    p.distinguished_name.push(rcgen::DnType::CommonName, "Zomello (this PC only)");
    p.distinguished_name.push(rcgen::DnType::OrganizationName, "Zomello");
    p.is_ca = rcgen::IsCa::Ca(rcgen::BasicConstraints::Constrained(0));
    p.key_usages = vec![rcgen::KeyUsagePurpose::KeyCertSign, rcgen::KeyUsagePurpose::CrlSign];
    p.name_constraints = Some(rcgen::NameConstraints { permitted_subtrees: subtrees(&scope), excluded_subtrees: vec![] });
    let (y, m, d) = day(-1);
    p.not_before = rcgen::date_time_ymd(y, m, d);
    let (y, m, d) = day(365 * 10);
    p.not_after = rcgen::date_time_ymd(y, m, d);
    let cert = p.self_signed(&key).map_err(|e| e.to_string())?.pem();
    let key_pem = key.serialize_pem();
    crate::atomic_write(&key_path, key_pem.as_bytes())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(&key_path, fs::Permissions::from_mode(0o600));
    }
    crate::atomic_write(&cert_path, cert.as_bytes())?;
    {
        let r = app.state::<Remote>();
        let mut inner = r.inner.lock().unwrap();
        inner.config.ca_scope = scope;
        inner.config.ca_created = crate::now_secs();
        save_config(app, &inner.config);
    }
    Ok((cert, key))
}

/// Hands TLS the current server certificate; swapped in place when the address or CA changes.
#[derive(Debug)]
struct CertSlot(std::sync::RwLock<Arc<rustls::sign::CertifiedKey>>);

impl rustls::server::ResolvesServerCert for CertSlot {
    fn resolve(&self, _: rustls::server::ClientHello<'_>) -> Option<Arc<rustls::sign::CertifiedKey>> {
        Some(self.0.read().unwrap().clone())
    }
}

/// A fresh server certificate for the chosen address and every address this PC has, signed by the CA.
/// Addresses the CA can't vouch for are left out (browsers would reject the whole certificate).
fn make_leaf(app: &AppHandle) -> Result<rustls::sign::CertifiedKey, String> {
    let (ca_pem, ca_key) = load_or_create_ca(app)?;
    let (scope, host) = {
        let r = app.state::<Remote>();
        let inner = r.inner.lock().unwrap();
        (scope_of(&inner.config), host_of(&inner.config))
    };
    let mut names: Vec<String> = host.into_iter().chain(detected_ips()).filter(|a| covers(&scope, a)).collect();
    names.dedup();
    let issuer = rcgen::Issuer::from_ca_cert_pem(&ca_pem, ca_key).map_err(|e| e.to_string())?;
    let leaf_key = rcgen::KeyPair::generate().map_err(|e| e.to_string())?;
    let mut p = rcgen::CertificateParams::new(names).map_err(|e| e.to_string())?;
    p.distinguished_name.push(rcgen::DnType::CommonName, "Zomello");
    p.key_usages = vec![rcgen::KeyUsagePurpose::DigitalSignature];
    p.extended_key_usages = vec![rcgen::ExtendedKeyUsagePurpose::ServerAuth];
    let (y, m, d) = day(-1);
    p.not_before = rcgen::date_time_ymd(y, m, d);
    let (y, m, d) = day(390);
    p.not_after = rcgen::date_time_ymd(y, m, d);
    let leaf = p.signed_by(&leaf_key, &issuer).map_err(|e| e.to_string())?;
    let key_der = rustls::pki_types::PrivateKeyDer::try_from(leaf_key.serialize_der()).map_err(|e| e.to_string())?;
    let signer = rustls::crypto::ring::sign::any_supported_type(&key_der).map_err(|e| e.to_string())?;
    app.state::<Remote>().inner.lock().unwrap().ca_pem = Some(ca_pem);
    Ok(rustls::sign::CertifiedKey::new(vec![leaf.der().clone()], signer))
}

/// Re-issue the running server's certificate (new address or new CA). No restart, no dropped devices.
fn refresh_cert(app: &AppHandle) -> Result<(), String> {
    let key = make_leaf(app)?;
    let slot = app.state::<Remote>().inner.lock().unwrap().slot.clone();
    if let Some(slot) = slot {
        *slot.0.write().unwrap() = Arc::new(key);
    }
    Ok(())
}

fn tls_config(app: &AppHandle) -> Result<(Arc<rustls::ServerConfig>, Arc<CertSlot>), String> {
    let key = make_leaf(app)?;
    let slot = Arc::new(CertSlot(std::sync::RwLock::new(Arc::new(key))));
    let config = rustls::ServerConfig::builder_with_provider(Arc::new(rustls::crypto::ring::default_provider()))
        .with_safe_default_protocol_versions()
        .map_err(|e| e.to_string())?
        .with_no_client_auth()
        .with_cert_resolver(slot.clone());
    Ok((Arc::new(config), slot))
}

/// The CA certificate as PEM (creating it if needed), e.g. to save to a file.
fn ca_pem(app: &AppHandle) -> Result<String, String> {
    let have = app.state::<Remote>().inner.lock().unwrap().ca_pem.clone();
    match have {
        Some(p) => Ok(p),
        None => {
            let (pem, _) = load_or_create_ca(app)?;
            app.state::<Remote>().inner.lock().unwrap().ca_pem = Some(pem.clone());
            Ok(pem)
        }
    }
}

fn fingerprint(pem: &str) -> String {
    use rustls::pki_types::pem::PemObject;
    rustls::pki_types::CertificateDer::from_pem_slice(pem.as_bytes())
        .map(|der| Sha256::digest(der.as_ref()).iter().map(|b| format!("{b:02X}")).collect::<Vec<_>>().join(":"))
        .unwrap_or_default()
}

/// The CA certificate (public part only), for installing on a phone. PEM, served like HaRM's,
/// which this kind of phone is known to accept.
async fn ca_cert(State(app): State<AppHandle>) -> Response {
    let Some(pem) = app.state::<Remote>().inner.lock().unwrap().ca_pem.clone() else {
        return StatusCode::NOT_FOUND.into_response();
    };
    (
        [
            (header::CONTENT_TYPE, "application/x-x509-ca-cert"),
            (header::CONTENT_DISPOSITION, "attachment; filename=\"zomello-ca.crt\""),
        ],
        pem,
    )
        .into_response()
}

async fn setup_page() -> Response {
    ([(header::CONTENT_TYPE, "text/html; charset=utf-8"), (header::CACHE_CONTROL, "no-cache")], SETUP_HTML).into_response()
}

const SETUP_HTML: &str = include_str!("setup.html");


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
        link_token_hash: None,
        show_boards: true,
    });
    save_config(&app, &inner.config);
    drop(inner);
    let _ = app.emit("zomello://device-paired", ());
    let cookie = format!("{COOKIE}={token}; Path=/; Max-Age=315360000; HttpOnly; SameSite=Strict");
    ([(header::SET_COOKIE, cookie)], "paired").into_response()
}

async fn get_data(State(app): State<AppHandle>, headers: HeaderMap) -> Response {
    if device(&app, &headers).is_none() {
        return unauthorized();
    }
    // This computer's private boards aren't shown on other devices.
    match crate::read_data(&app) {
        Ok(json) => ([(header::CONTENT_TYPE, "application/json")], crate::private::without_private(&json)).into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, e).into_response(),
    }
}

async fn put_data(State(app): State<AppHandle>, headers: HeaderMap, body: String) -> Response {
    if device(&app, &headers).is_none() {
        return unauthorized();
    }
    // The device never saw this computer's private boards; keep them as they are.
    let body = crate::private::keep_private(&body, &crate::read_data(&app).unwrap_or_default());
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
    let first = crate::private::without_private(&crate::read_data(&app).unwrap_or_default());
    let rx = app.state::<Remote>().tx.subscribe();
    let initial = stream::once(async move { Ok::<_, Infallible>(sse::Event::default().event("data").id("server").data(first)) });
    let updates = stream::unfold((rx, dev.id), |(mut rx, id)| async move {
        loop {
            match rx.recv().await {
                Ok(Msg::Data { from, json }) => {
                    let json = crate::private::without_private(&json);
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

/// Server-sent events for a device's page: `linked` with a phone's id whenever its boards change.
async fn devices_events(State(app): State<AppHandle>, headers: HeaderMap) -> Response {
    let Some(dev) = device(&app, &headers) else { return unauthorized() };
    let rx = app.state::<Remote>().tx.subscribe();
    let updates = stream::unfold((rx, dev.id), |(mut rx, me)| async move {
        loop {
            match rx.recv().await {
                Ok(Msg::Linked(id)) if id != me => return Some((Ok::<_, Infallible>(sse::Event::default().event("linked").data(id)), (rx, me))),
                Ok(Msg::Revoked(d)) if d == me => return None,
                Ok(Msg::Shutdown) | Err(broadcast::error::RecvError::Closed) => return None,
                _ => continue,
            }
        }
    });
    let s: std::pin::Pin<Box<dyn Stream<Item = Result<sse::Event, Infallible>> + Send>> = Box::pin(updates);
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

/// A board's calendar feed, fetched by this computer. Only addresses saved on a board can be fetched,
/// so a device can't make this computer download arbitrary sites.
async fn calendar_feed(State(app): State<AppHandle>, headers: HeaderMap, UrlPath((board, feed)): UrlPath<(String, String)>) -> Response {
    if device(&app, &headers).is_none() {
        return unauthorized();
    }
    let url = crate::read_data(&app)
        .ok()
        .and_then(|json| serde_json::from_str::<serde_json::Value>(&json).ok())
        .and_then(|d| {
            d["boards"][&board]["calendarFeeds"]
                .as_array()?
                .iter()
                .find(|f| f["id"] == feed.as_str())
                .and_then(|f| f["url"].as_str().map(str::to_string))
        });
    let Some(url) = url else { return StatusCode::NOT_FOUND.into_response() };
    match crate::calendar::fetch_text(&url).await {
        Ok(ics) => ([(header::CONTENT_TYPE, "text/calendar; charset=utf-8")], ics).into_response(),
        Err(e) => (StatusCode::BAD_GATEWAY, e).into_response(),
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
    /// Its boards show on this computer while it's connected.
    show_boards: bool,
    /// Its app has linked with this computer (it can share its boards).
    can_link: bool,
}

// ---- Firewall ----

#[derive(Serialize)]
pub struct Firewall {
    /// "ufw" / "firewalld" (Linux), "windows", "macos", or "none" (nothing blocking).
    kind: &'static str,
    /// Zomello is allowed through it (for the current port).
    allowed: bool,
    /// The same change as a command, for people who'd rather run it themselves.
    command: Option<String>,
}

/// Run a command without flashing a console window on Windows.
fn quiet(cmd: &str) -> std::process::Command {
    #[allow(unused_mut)]
    let mut c = std::process::Command::new(cmd);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        c.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    c
}

/// The home-network range this PC is on (what the Linux firewall rule allows), e.g. 192.168.0.0/16.
#[cfg(target_os = "linux")]
fn home_range() -> &'static str {
    match lan_ip().and_then(|ip| ip.parse::<std::net::Ipv4Addr>().ok()).map(|a| a.octets()) {
        Some([10, ..]) => "10.0.0.0/8",
        Some([172, b, ..]) if (16..32).contains(&b) => "172.16.0.0/12",
        _ => "192.168.0.0/16",
    }
}

#[cfg(target_os = "macos")]
const MAC_FW: &str = "/usr/libexec/ApplicationFirewall/socketfilterfw";

#[cfg(target_os = "macos")]
fn exe_path() -> Option<String> {
    let p = std::env::current_exe().ok()?.to_string_lossy().to_string();
    // It's put inside quotes in an admin shell command: refuse anything that could break out.
    (!p.contains(['\'', '"', '\\', '$', '`'])).then_some(p)
}

fn firewall_kind() -> &'static str {
    #[cfg(target_os = "linux")]
    {
        let active = |name: &str| quiet("systemctl").args(["is-active", "--quiet", name]).status().is_ok_and(|s| s.success());
        if active("ufw") {
            "ufw"
        } else if active("firewalld") {
            "firewalld"
        } else {
            "none"
        }
    }
    #[cfg(windows)]
    {
        "windows"
    }
    #[cfg(target_os = "macos")]
    {
        let on = quiet(MAC_FW).arg("--getglobalstate").output().is_ok_and(|o| String::from_utf8_lossy(&o.stdout).contains("enabled"));
        if on { "macos" } else { "none" }
    }
    #[cfg(not(any(target_os = "linux", windows, target_os = "macos")))]
    {
        "none"
    }
}

/// The admin command that lets Zomello through (run behind the system's own password/UAC prompt).
fn firewall_command(kind: &str, port: u16) -> Option<String> {
    match kind {
        #[cfg(target_os = "linux")]
        "ufw" => Some(format!("ufw allow proto tcp from {} to any port {port} comment Zomello", home_range())),
        "firewalld" => Some(format!("firewall-cmd --permanent --add-port={port}/tcp && firewall-cmd --reload")),
        // Only devices on the same local network, on any network profile (Windows often marks home Wi‑Fi "Public").
        "windows" => Some(format!(
            "netsh advfirewall firewall delete rule name=Zomello >nul & netsh advfirewall firewall add rule name=Zomello dir=in action=allow protocol=TCP localport={port} remoteip=localsubnet profile=any"
        )),
        #[cfg(target_os = "macos")]
        "macos" => exe_path().map(|exe| format!("{MAC_FW} --add '{exe}'; {MAC_FW} --unblockapp '{exe}'")),
        _ => None,
    }
}

/// Is Zomello already let through? Windows and macOS can tell; Linux rules need root to read, so
/// there we remember having done it.
fn firewall_allowed(kind: &str, port: u16, remembered: bool) -> bool {
    // The Microsoft Store package brings its own firewall rule for the usual port.
    if crate::desktop::is_store_package() && port == DEFAULT_PORT {
        return true;
    }
    match kind {
        "none" => true,
        "windows" => quiet("netsh")
            .args(["advfirewall", "firewall", "show", "rule", "name=Zomello"])
            .output()
            .is_ok_and(|o| o.status.success() && String::from_utf8_lossy(&o.stdout).contains(&port.to_string())),
        #[cfg(target_os = "macos")]
        "macos" => exe_path().is_some_and(|exe| {
            quiet(MAC_FW).args(["--getappblocked", &exe]).output().is_ok_and(|o| String::from_utf8_lossy(&o.stdout).contains("permitted"))
        }),
        _ => remembered,
    }
}

/// Let Zomello through this PC's firewall, behind the system's own prompt (polkit on Linux, UAC on
/// Windows, the admin password dialog on macOS). No terminal needed.
#[tauri::command]
pub async fn remote_open_firewall(app: AppHandle) -> Result<Status, String> {
    let port = app.state::<Remote>().inner.lock().unwrap().config.port;
    let kind = firewall_kind();
    let cmd = firewall_command(kind, port).ok_or("There's no firewall here to change")?;
    let out = tauri::async_runtime::spawn_blocking(move || {
        #[cfg(windows)]
        {
            let script = format!("Start-Process cmd.exe -Verb RunAs -Wait -WindowStyle Hidden -ArgumentList '/c {cmd}'");
            quiet("powershell").args(["-NoProfile", "-NonInteractive", "-Command", &script]).output()
        }
        #[cfg(target_os = "macos")]
        {
            let script = format!("do shell script \"{cmd}\" with administrator privileges");
            quiet("osascript").args(["-e", &script]).output()
        }
        #[cfg(not(any(windows, target_os = "macos")))]
        {
            quiet("pkexec").args(["sh", "-c", &cmd]).output()
        }
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| format!("Couldn't ask for permission ({e}). Run the command shown instead."))?;
    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr).trim().to_string();
        let cancelled = matches!(out.status.code(), Some(126) | Some(127)) || err.contains("canceled") || err.contains("cancelled") || err.is_empty();
        return Err(if cancelled { "Cancelled.".into() } else { err });
    }
    {
        let r = app.state::<Remote>();
        let mut inner = r.inner.lock().unwrap();
        inner.config.firewall_port = Some(port);
        save_config(&app, &inner.config);
    }
    Ok(status_of(&app))
}

// ---- Status ----

#[derive(Serialize)]
pub struct CertInfo {
    /// SHA-256 fingerprint, to compare with what a device shows.
    fingerprint: String,
    created: u64,
    /// Whether the certificate can vouch for the chosen address.
    covers_address: bool,
}

#[derive(Serialize)]
pub struct Status {
    enabled: bool,
    running: bool,
    port: u16,
    /// Addresses found on this PC (first = the one used for the internet).
    addresses: Vec<String>,
    /// Chosen in Settings; None = automatic.
    address: Option<String>,
    /// What devices are told to use.
    host: Option<String>,
    /// Plain http address (works everywhere, can't be installed in Chrome).
    url: Option<String>,
    /// https address (installable once the device trusts this PC's certificate).
    secure_url: Option<String>,
    /// Page that walks a device through trusting the certificate.
    setup_url: Option<String>,
    error: Option<String>,
    devices: Vec<DeviceInfo>,
    firewall: Firewall,
    cert: Option<CertInfo>,
}

fn status_of(app: &AppHandle) -> Status {
    let kind = firewall_kind();
    let r = app.state::<Remote>();
    let inner = r.inner.lock().unwrap();
    let c = &inner.config;
    let port = c.port;
    let host = host_of(c);
    let url = |scheme: &str, path: &str| host.as_ref().map(|h| format!("{scheme}://{h}:{port}/{path}"));
    Status {
        enabled: c.enabled,
        running: inner.shutdown.is_some(),
        port,
        addresses: detected_ips(),
        address: c.address.clone(),
        host: host.clone(),
        url: url("http", ""),
        secure_url: url("https", ""),
        setup_url: url("http", "setup"),
        error: inner.error.clone(),
        firewall: Firewall {
            kind,
            allowed: firewall_allowed(kind, port, c.firewall_port == Some(port)),
            command: firewall_command(kind, port).map(|cmd| match kind {
                "windows" => format!("(in an administrator Command Prompt) {cmd}"),
                _ => format!("sudo sh -c \"{cmd}\""),
            }),
        },
        cert: inner.ca_pem.as_ref().map(|pem| CertInfo {
            fingerprint: fingerprint(pem),
            created: c.ca_created,
            covers_address: host.as_ref().is_none_or(|h| covers(&scope_of(c), h)),
        }),
        devices: c
            .devices
            .iter()
            .map(|d| DeviceInfo {
                id: d.id.clone(),
                name: d.name.clone(),
                created: d.created,
                last_seen: d.last_seen,
                show_boards: d.show_boards,
                can_link: d.link_token_hash.is_some(),
            })
            .collect(),
    }
}

#[tauri::command]
pub fn remote_status(app: AppHandle) -> Status {
    status_of(&app)
}

/// Async so a restart that waits for the port to free up never freezes the window.
#[tauri::command]
pub async fn remote_set_enabled(app: AppHandle, enabled: bool, port: Option<u16>) -> Status {
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

/// Choose the address devices use (an IP from the list, or a custom IP or name). None = automatic.
#[tauri::command]
pub fn remote_set_address(app: AppHandle, address: Option<String>) -> Result<Status, String> {
    let address = address.map(|a| a.trim().trim_end_matches('/').to_ascii_lowercase()).filter(|a| !a.is_empty());
    if let Some(a) = &address {
        if !valid_address(a) {
            return Err(format!("“{a}” isn't an IP address or a network name"));
        }
    }
    {
        let r = app.state::<Remote>();
        let mut inner = r.inner.lock().unwrap();
        inner.config.address = address;
        save_config(&app, &inner.config);
    }
    refresh_cert(&app)?;
    Ok(status_of(&app))
}

/// Make a brand-new certificate authority (covering the current address). Devices must install the
/// new certificate; the old one stops working for Zomello.
#[tauri::command]
pub fn remote_regenerate_cert(app: AppHandle) -> Result<Status, String> {
    let dir = crate::data_dir(&app)?;
    let _ = fs::remove_file(dir.join(CA_KEY));
    let _ = fs::remove_file(dir.join(CA_CERT));
    {
        let r = app.state::<Remote>();
        let mut inner = r.inner.lock().unwrap();
        inner.ca_pem = None;
        inner.config.ca_scope.clear();
    }
    ca_pem(&app)?;
    refresh_cert(&app)?;
    Ok(status_of(&app))
}

/// Save the certificate to Downloads, to put on a device by USB, email, AirDrop, etc.
#[tauri::command]
pub fn remote_export_cert(app: AppHandle) -> Result<String, String> {
    let pem = ca_pem(&app)?;
    let dir = app.path().download_dir().or_else(|_| crate::data_dir(&app))?;
    let path = dir.join("zomello-ca.crt");
    fs::write(&path, pem).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().to_string())
}

/// QR code for a link (the setup page, or the certificate download), for scanning with a device.
#[tauri::command]
pub fn remote_qr(text: String) -> Result<String, String> {
    Ok(qrcode::QrCode::new(text.as_bytes())
        .map_err(|e| e.to_string())?
        .render::<qrcode::render::svg::Color>()
        .min_dimensions(220, 220)
        .build())
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
    let (Some(url), Some(setup)) = (st.secure_url, st.setup_url) else {
        return Err("Couldn't find this PC's address on the network".into());
    };
    let mut b = [0u8; 4];
    getrandom::fill(&mut b).map_err(|e| e.to_string())?;
    let code = format!("{:06}", u32::from_le_bytes(b) % 1_000_000);
    app.state::<Remote>().inner.lock().unwrap().pairing =
        Some(Pairing { code: code.clone(), expires: Instant::now() + PAIR_TTL, tries: 0 });
    // The QR code opens the setup page (which offers https once the device trusts it). The code rides
    // in the #fragment, which browsers never send to the server.
    let link = format!("{setup}#pair={code}");
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
        let _ = r.tx.send(Msg::Revoked(id.clone()));
    }
    crate::link::forget(&app, Some(&id));
    status_of(&app)
}

/// Show (or hide) a device's boards on this computer while it's connected.
#[tauri::command]
pub fn remote_show_boards(app: AppHandle, id: String, show: bool) -> Status {
    {
        let r = app.state::<Remote>();
        let mut inner = r.inner.lock().unwrap();
        if let Some(d) = inner.config.devices.iter_mut().find(|d| d.id == id) {
            d.show_boards = show;
        }
        save_config(&app, &inner.config);
    }
    let _ = app.emit("zomello://linked-changed", serde_json::json!({ "id": id }));
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

#[cfg(test)]
mod tests {
    use super::*;

    fn scope(v: &[&str]) -> Vec<String> {
        v.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn coverage_follows_the_ca_scope() {
        let legacy = scope(&LEGACY_SCOPE);
        assert!(covers(&legacy, "192.168.1.10"));
        assert!(covers(&legacy, "10.4.5.6"));
        assert!(covers(&legacy, "172.20.0.9"));
        assert!(!covers(&legacy, "172.32.0.1"));
        assert!(!covers(&legacy, "100.101.102.103")); // e.g. Tailscale: needs a new CA
        assert!(!covers(&legacy, "8.8.8.8"));
        assert!(covers(&legacy, "mypc.local"));
        assert!(!covers(&legacy, "mypc.lan"));
        assert!(!covers(&legacy, "notlocal")); // only *.local / "local" itself

        let new = scope(&DEFAULT_SCOPE);
        assert!(covers(&new, "mypc.lan"));
        assert!(covers(&new, "nas.home.arpa"));
        assert!(!covers(&new, "google.com"));
        assert!(!covers(&new, "evil-local")); // suffix must be a whole label

        let custom = scope(&["ip:192.168.0.0/16", "ip:100.101.102.103/32", "dns:example.org"]);
        assert!(covers(&custom, "100.101.102.103"));
        assert!(!covers(&custom, "100.101.102.104"));
        assert!(covers(&custom, "Zomello.Example.org"));
    }

    #[test]
    fn addresses_are_validated() {
        assert!(valid_address("192.168.1.20"));
        assert!(valid_address("mypc.lan"));
        assert!(valid_address("desktop-7"));
        assert!(!valid_address(""));
        assert!(!valid_address("my pc"));
        assert!(!valid_address("a..b"));
        assert!(!valid_address("http://x"));
        assert!(!valid_address("x;rm -rf"));
    }

    #[test]
    fn scope_becomes_name_constraints() {
        let t = subtrees(&scope(&["ip:192.168.0.0/16", "dns:lan", "bogus"]));
        assert_eq!(t.len(), 2);
        assert!(matches!(&t[0], rcgen::GeneralSubtree::IpAddress(rcgen::CidrSubnet::V4([192, 168, 0, 0], [255, 255, 0, 0]))));
        assert!(matches!(&t[1], rcgen::GeneralSubtree::DnsName(d) if d == "lan"));
    }

    #[test]
    fn dates() {
        assert_eq!(civil_from_days(0), (1970, 1, 1));
        assert_eq!(civil_from_days(20_737), (2026, 10, 11));
    }
}
