//! https. Three ways to run:
//!  - off:   plain http, e.g. behind Caddy / a reverse proxy that handles certificates (recommended
//!           for a domain), or on Tailscale.
//!  - files: your own certificate and key (PEM files).
//!  - self:  Zomello makes its own certificate authority (like the desktop app's phone access).
//!           Devices install /zomello-ca.crt once. The authority can only vouch for home-network
//!           addresses and the names in ZOMELLO_HOSTS.
//! With TLS on, plain http still answers on the same port, so /zomello-ca.crt can be downloaded.

use axum::{
    extract::State,
    http::{header, StatusCode},
    response::{IntoResponse, Response},
    Router,
};
use rustls::pki_types::{pem::PemObject, CertificateDer, PrivateKeyDer};
use std::{path::Path, sync::Arc, time::Duration};

pub fn from_files(cert: &str, key: &str) -> Arc<rustls::ServerConfig> {
    let certs: Vec<CertificateDer<'static>> = CertificateDer::pem_file_iter(cert).expect("read ZOMELLO_TLS_CERT").flatten().collect();
    let key = PrivateKeyDer::from_pem_file(key).expect("read ZOMELLO_TLS_KEY");
    Arc::new(
        rustls::ServerConfig::builder_with_provider(Arc::new(rustls::crypto::ring::default_provider()))
            .with_safe_default_protocol_versions()
            .unwrap()
            .with_no_client_auth()
            .with_single_cert(certs, key)
            .expect("certificate and key don't match"),
    )
}

fn lan_ips() -> Vec<String> {
    let mut out = vec![];
    if let Ok(s) = std::net::UdpSocket::bind("0.0.0.0:0") {
        if s.connect("192.0.2.1:80").is_ok() {
            if let Ok(a) = s.local_addr() {
                out.push(a.ip().to_string());
            }
        }
    }
    out
}

/// Days since 1970-01-01 + offset → (y, m, d).
fn day(offset: i64) -> (i32, u8, u8) {
    crate::civil_from_days(crate::now() / 86_400 + offset)
}

fn cidr(ip: [u8; 4], bits: u32) -> rcgen::GeneralSubtree {
    let mask = if bits == 0 { 0 } else { u32::MAX << (32 - bits) };
    rcgen::GeneralSubtree::IpAddress(rcgen::CidrSubnet::V4(ip, mask.to_be_bytes()))
}

/// Zomello's own certificate authority (made once, in data/tls) and a fresh server certificate.
pub fn self_signed(data_dir: &Path, hosts: Option<&str>) -> Arc<rustls::ServerConfig> {
    let dir = data_dir.join("tls");
    std::fs::create_dir_all(&dir).expect("create data/tls");
    let extra: Vec<String> = hosts.unwrap_or("").split(',').map(|h| h.trim().to_lowercase()).filter(|h| !h.is_empty()).collect();
    let (ca_pem, ca_key) = match (std::fs::read_to_string(dir.join("ca.pem")), std::fs::read_to_string(dir.join("ca-key.pem"))) {
        (Ok(c), Ok(k)) => (c, rcgen::KeyPair::from_pem(&k).expect("data/tls/ca-key.pem")),
        _ => {
            let key = rcgen::KeyPair::generate().unwrap();
            let mut p = rcgen::CertificateParams::default();
            p.distinguished_name.push(rcgen::DnType::CommonName, "Zomello Server (this server only)");
            p.distinguished_name.push(rcgen::DnType::OrganizationName, "Zomello");
            p.is_ca = rcgen::IsCa::Ca(rcgen::BasicConstraints::Constrained(0));
            p.key_usages = vec![rcgen::KeyUsagePurpose::KeyCertSign, rcgen::KeyUsagePurpose::CrlSign];
            // Only home-network addresses, *.local / *.lan style names, and the names you listed.
            let mut permitted = vec![cidr([10, 0, 0, 0], 8), cidr([172, 16, 0, 0], 12), cidr([192, 168, 0, 0], 16), cidr([100, 64, 0, 0], 10)];
            for d in ["local", "lan", "home", "home.arpa", "internal", "localdomain", "ts.net"] {
                permitted.push(rcgen::GeneralSubtree::DnsName(d.into()));
            }
            for h in &extra {
                match h.parse::<std::net::Ipv4Addr>() {
                    Ok(ip) => permitted.push(cidr(ip.octets(), 32)),
                    Err(_) => permitted.push(rcgen::GeneralSubtree::DnsName(h.clone())),
                }
            }
            p.name_constraints = Some(rcgen::NameConstraints { permitted_subtrees: permitted, excluded_subtrees: vec![] });
            let (y, m, d) = day(-1);
            p.not_before = rcgen::date_time_ymd(y, m, d);
            let (y, m, d) = day(3650);
            p.not_after = rcgen::date_time_ymd(y, m, d);
            let cert = p.self_signed(&key).unwrap().pem();
            std::fs::write(dir.join("ca-key.pem"), key.serialize_pem()).expect("write CA key");
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                let _ = std::fs::set_permissions(dir.join("ca-key.pem"), std::fs::Permissions::from_mode(0o600));
            }
            std::fs::write(dir.join("ca.pem"), &cert).expect("write CA");
            (cert, key)
        }
    };
    let issuer = rcgen::Issuer::from_ca_cert_pem(&ca_pem, ca_key).expect("CA");
    // Only names the authority may vouch for (a browser rejects the whole certificate otherwise).
    let covered = |n: &str| match n.parse::<std::net::Ipv4Addr>() {
        Ok(ip) => {
            let o = ip.octets();
            o[0] == 10 || (o[0] == 172 && (16..32).contains(&o[1])) || (o[0] == 192 && o[1] == 168) || (o[0] == 100 && (64..128).contains(&o[1]))
                || extra.iter().any(|e| e == n)
        }
        Err(_) => extra.iter().any(|e| e == n)
            || ["local", "lan", "home", "home.arpa", "internal", "localdomain", "ts.net"].iter().any(|d| n == *d || n.ends_with(&format!(".{d}"))),
    };
    let mut names: Vec<String> = extra.clone();
    names.extend(lan_ips());
    names.retain(|n| covered(n));
    names.sort();
    names.dedup();
    if names.is_empty() {
        eprintln!("ZOMELLO_TLS=self: no home-network address found; set ZOMELLO_HOSTS (e.g. zomello.lan,192.168.1.20)");
    }
    let leaf_key = rcgen::KeyPair::generate().unwrap();
    let mut p = rcgen::CertificateParams::new(names).unwrap();
    p.distinguished_name.push(rcgen::DnType::CommonName, "Zomello Server");
    p.key_usages = vec![rcgen::KeyUsagePurpose::DigitalSignature];
    p.extended_key_usages = vec![rcgen::ExtendedKeyUsagePurpose::ServerAuth];
    let (y, m, d) = day(-1);
    p.not_before = rcgen::date_time_ymd(y, m, d);
    let (y, m, d) = day(390);
    p.not_after = rcgen::date_time_ymd(y, m, d);
    let leaf = p.signed_by(&leaf_key, &issuer).unwrap();
    let key = PrivateKeyDer::try_from(leaf_key.serialize_der()).unwrap();
    Arc::new(
        rustls::ServerConfig::builder_with_provider(Arc::new(rustls::crypto::ring::default_provider()))
            .with_safe_default_protocol_versions()
            .unwrap()
            .with_no_client_auth()
            .with_single_cert(vec![leaf.der().clone()], key)
            .unwrap(),
    )
}

/// One port for both https and plain http (the first byte tells them apart).
pub async fn serve(listener: tokio::net::TcpListener, router: Router, tls: Arc<rustls::ServerConfig>) {
    let acceptor = tokio_rustls::TlsAcceptor::from(tls);
    loop {
        let Ok((stream, _)) = listener.accept().await else { continue };
        let (router, acceptor) = (router.clone(), acceptor.clone());
        tokio::spawn(async move {
            let mut first = [0u8; 1];
            let peeked = tokio::time::timeout(Duration::from_secs(20), stream.peek(&mut first)).await;
            let is_tls = matches!(peeked, Ok(Ok(1))) && first[0] == 0x16;
            let svc = hyper_util::service::TowerToHyperService::new(router);
            let http = hyper::server::conn::http1::Builder::new();
            if is_tls {
                if let Ok(s) = acceptor.accept(stream).await {
                    let _ = http.serve_connection(hyper_util::rt::TokioIo::new(s), svc).with_upgrades().await;
                }
            } else {
                let _ = http.serve_connection(hyper_util::rt::TokioIo::new(stream), svc).with_upgrades().await;
            }
        });
    }
}

pub async fn ca_cert(State(app): State<crate::App>) -> Response {
    if !app.config.self_cert {
        return (StatusCode::NOT_FOUND, "This server doesn't use its own certificate.").into_response();
    }
    match std::fs::read_to_string(app.config.data_dir.join("tls").join("ca.pem")) {
        Ok(pem) => ([(header::CONTENT_TYPE, "application/x-x509-ca-cert"), (header::CONTENT_DISPOSITION, "attachment; filename=\"zomello-ca.crt\"")], pem).into_response(),
        Err(_) => (StatusCode::NOT_FOUND, "This server doesn't use its own certificate.").into_response(),
    }
}
