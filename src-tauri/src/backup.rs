// The phone half runs on phones and tablets; a computer only stores and lists backups.
#![cfg_attr(desktop, allow(dead_code))]
//! Device backups: a phone or tablet can ask your computer to keep a copy of its boards (Settings >
//! Servers on the phone). The computer saves what the phone already sends it over the link (see
//! link.rs), one file per day for the last two weeks, and can send them back after a reinstall.
//!
//! Private boards never go along, unless the phone also turns on "Include private boards" and sets a
//! password: then they travel locked (AES-256-GCM, with a key made from the password), and only that
//! password opens them again. The computer stores the locked copy but can't read it.

use crate::link_client::{base64_decode, base64_encode};
use ring::aead::{Aad, LessSafeKey, Nonce, UnboundKey, AES_256_GCM};
use ring::pbkdf2;
use ring::rand::{SecureRandom, SystemRandom};
use serde_json::{json, Value};
use std::fs;
use std::num::NonZeroU32;
use tauri::AppHandle;

const KEY_FILE: &str = "backup-key.json";
const PENDING_FILE: &str = "backup-restore.txt";
const ROUNDS: u32 = 210_000;
const TAG: &str = "zb1:";

fn derive(password: &str, salt: &[u8]) -> [u8; 32] {
    let mut key = [0u8; 32];
    pbkdf2::derive(pbkdf2::PBKDF2_HMAC_SHA256, NonZeroU32::new(ROUNDS).unwrap(), salt, password.as_bytes(), &mut key);
    key
}

fn random<const N: usize>() -> Result<[u8; N], String> {
    let mut b = [0u8; N];
    SystemRandom::new().fill(&mut b).map_err(|_| "no random numbers".to_string())?;
    Ok(b)
}

/// Lock `plain` with `key` (made from the password with `salt`): `zb1:` + base64(salt, nonce, sealed).
fn seal(key: &[u8; 32], salt: &[u8], plain: &[u8]) -> Result<String, String> {
    let nonce: [u8; 12] = random()?;
    let k = LessSafeKey::new(UnboundKey::new(&AES_256_GCM, key).map_err(|_| "bad key")?);
    let mut buf = plain.to_vec();
    k.seal_in_place_append_tag(Nonce::assume_unique_for_key(nonce), Aad::empty(), &mut buf).map_err(|_| "couldn't lock it")?;
    let mut out = salt.to_vec();
    out.extend_from_slice(&nonce);
    out.extend_from_slice(&buf);
    Ok(format!("{TAG}{}", base64_encode(&out)))
}

fn unseal(blob: &str, password: &str) -> Result<Vec<u8>, String> {
    let raw = blob.strip_prefix(TAG).and_then(base64_decode).ok_or("That isn't a Zomello backup.")?;
    if raw.len() < 16 + 12 + 16 {
        return Err("That backup is damaged.".into());
    }
    let (salt, rest) = raw.split_at(16);
    let (nonce, sealed) = rest.split_at(12);
    let key = derive(password, salt);
    let k = LessSafeKey::new(UnboundKey::new(&AES_256_GCM, &key).map_err(|_| "bad key")?);
    let mut buf = sealed.to_vec();
    let nonce = Nonce::try_assume_unique_for_key(nonce).map_err(|_| "That backup is damaged.")?;
    let plain = k.open_in_place(nonce, Aad::empty(), &mut buf).map_err(|_| "That password doesn't open this backup.")?;
    Ok(plain.to_vec())
}

/// The stored files a device's boards use (`attachments/...`): card attachments and board background images.
pub fn stored_refs(data: &Value) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for c in data["cards"].as_object().into_iter().flatten().map(|(_, c)| c) {
        for a in c["attachments"].as_array().into_iter().flatten() {
            if a["stored"] == true {
                if let Some(u) = a["url"].as_str() {
                    out.push(u.to_string());
                }
            }
        }
    }
    for b in data["boards"].as_object().into_iter().flatten().map(|(_, b)| b) {
        if b["background"]["type"] == "image" {
            if let Some(u) = b["background"]["value"].as_str() {
                out.push(u.to_string());
            }
        }
    }
    out.retain(|u| safe_rel(u));
    out.sort();
    out.dedup();
    out
}

/// A stored file's path as boards write it, and nothing that could point outside the attachments folder.
pub fn safe_rel(rel: &str) -> bool {
    use std::path::{Component, Path};
    let p = Path::new(rel);
    rel.len() < 400 && p.starts_with("attachments") && p.components().all(|c| matches!(c, Component::Normal(_)))
}

// ---- On the phone ----

/// Set (or with `None`, forget) the password that locks private boards in backups. Only a key made from
/// it is kept, in the app's own folder on this device; it never leaves the device.
#[tauri::command]
pub fn backup_set_password(app: AppHandle, password: Option<String>) -> Result<(), String> {
    let path = crate::data_dir(&app)?.join(KEY_FILE);
    let Some(pw) = password else {
        let _ = fs::remove_file(path);
        return Ok(());
    };
    if pw.chars().count() < 8 {
        return Err("Use at least 8 characters.".into());
    }
    let salt: [u8; 16] = random()?;
    let key = derive(&pw, &salt);
    crate::atomic_write(&path, json!({ "salt": base64_encode(&salt), "key": base64_encode(&key) }).to_string().as_bytes())?;
    crate::link_client::data_changed();
    Ok(())
}

#[tauri::command]
pub fn backup_has_password(app: AppHandle) -> bool {
    crate::data_dir(&app).is_ok_and(|d| d.join(KEY_FILE).exists())
}

/// The private boards, locked, when this device backs them up (both settings on and a password set).
pub fn locked_private(app: &AppHandle, data: &str) -> Option<String> {
    let v: Value = serde_json::from_str(data).ok()?;
    let s = &v["settings"];
    if s["backupToComputer"] != true || s["backupPrivate"] != true {
        return None;
    }
    let k: Value = serde_json::from_str(&fs::read_to_string(crate::data_dir(app).ok()?.join(KEY_FILE)).ok()?).ok()?;
    let salt = base64_decode(k["salt"].as_str()?)?;
    let key: [u8; 32] = base64_decode(k["key"].as_str()?)?.try_into().ok()?;
    let private = crate::private::only_private(data)?;
    seal(&key, &salt, private.as_bytes()).ok()
}

/// Open locked private boards with the password: their data, to add to this device.
#[tauri::command]
pub fn backup_open(blob: String, password: String) -> Result<String, String> {
    String::from_utf8(unseal(&blob, &password)?).map_err(|_| "That backup is damaged.".into())
}

/// Locked private boards your computer sent back: kept until this device's page asks for the password.
pub fn save_pending(app: &AppHandle, blob: &str) -> Result<(), String> {
    crate::atomic_write(&crate::data_dir(app)?.join(PENDING_FILE), blob.as_bytes())
}

/// The locked private boards waiting to be opened (`clear` once they're restored or skipped).
#[tauri::command]
pub fn backup_pending(app: AppHandle, clear: bool) -> Option<String> {
    let path = crate::data_dir(&app).ok()?.join(PENDING_FILE);
    let blob = fs::read_to_string(&path).ok();
    if clear {
        let _ = fs::remove_file(&path);
    }
    blob
}

// ---- On the computer ----

#[cfg(desktop)]
pub use computer::*;

#[cfg(desktop)]
mod computer {
    use super::*;
    use std::collections::HashMap;
    use std::path::PathBuf;
    use std::sync::Mutex;

    const DIR: &str = "device-backups";
    const KEEP_DAYS: usize = 14;
    /// What each device's backup file last held (so the same data isn't written again and again).
    static LAST: Mutex<Option<HashMap<String, (String, u64)>>> = Mutex::new(None);

    /// Ids and dates come from the page: only plain ones, so they can't point outside the folder.
    fn safe(s: &str) -> bool {
        !s.is_empty() && s.len() <= 64 && s.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
    }

    fn dir(app: &AppHandle, id: &str) -> Result<PathBuf, String> {
        if !safe(id) {
            return Err("not a device".into());
        }
        let d = crate::data_dir(app)?.join(DIR).join(id);
        fs::create_dir_all(&d).map_err(|e| e.to_string())?;
        Ok(d)
    }

    /// Today's date (UTC), `yyyy-mm-dd`.
    fn today() -> String {
        let days = (crate::now_secs() / 86_400) as i64;
        // Civil date from days since 1970 (Howard Hinnant's algorithm).
        let z = days + 719_468;
        let era = z.div_euclid(146_097);
        let doe = z - era * 146_097;
        let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
        let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
        let mp = (5 * doy + 2) / 153;
        let d = doy - (153 * mp + 2) / 5 + 1;
        let m = if mp < 10 { mp + 3 } else { mp - 9 };
        let y = yoe + era * 400 + i64::from(m <= 2);
        format!("{y:04}-{m:02}-{d:02}")
    }

    fn hash(s: &str) -> u64 {
        use std::hash::{Hash, Hasher};
        let mut h = std::collections::hash_map::DefaultHasher::new();
        s.hash(&mut h);
        h.finish()
    }

    /// A phone sent its boards and wants them backed up: save today's copy (and keep two weeks of them).
    pub fn keep(app: &AppHandle, id: &str, name: &str, data: &str, private: Option<&str>) {
        let date = today();
        let h = hash(data) ^ private.map(hash).unwrap_or(0);
        {
            let mut last = LAST.lock().unwrap();
            let last = last.get_or_insert_with(HashMap::new);
            if last.get(id).is_some_and(|(d, x)| *d == date && *x == h) {
                return;
            }
            last.insert(id.to_string(), (date.clone(), h));
        }
        let Ok(d) = dir(app, id) else { return };
        let boards = serde_json::from_str::<Value>(data).ok().and_then(|v| v["boards"].as_object().map(|m| m.len())).unwrap_or(0);
        let file = json!({ "device": name, "at": crate::now_secs(), "boards": boards, "data": data, "private": private });
        if crate::atomic_write(&d.join(format!("{date}.json")), file.to_string().as_bytes()).is_err() {
            return;
        }
        let mut days = days_of(&d);
        days.sort();
        while days.len() > KEEP_DAYS {
            let _ = fs::remove_file(d.join(format!("{}.json", days.remove(0))));
        }
        let _ = crate::atomic_write(&d.join("device.json"), json!({ "name": name }).to_string().as_bytes());
        prune_files(app, id, &d);
    }

    fn days_of(d: &std::path::Path) -> Vec<String> {
        fs::read_dir(d)
            .into_iter()
            .flatten()
            .flatten()
            .filter_map(|e| e.file_name().to_str()?.strip_suffix(".json").map(str::to_string))
            .filter(|n| n != "device" && safe(n))
            .collect()
    }

    fn files_dir(app: &AppHandle, id: &str) -> Result<PathBuf, String> {
        Ok(dir(app, id)?.join("files"))
    }

    /// The attached files already kept for a device (so it only sends new ones).
    pub fn stored_files(app: &AppHandle, id: &str) -> Vec<String> {
        let Ok(root) = files_dir(app, id) else { return vec![] };
        let mut out = Vec::new();
        let mut stack = vec![root.clone()];
        while let Some(d) = stack.pop() {
            for e in fs::read_dir(&d).into_iter().flatten().flatten() {
                let p = e.path();
                if p.is_dir() {
                    stack.push(p);
                } else if let Ok(rel) = p.strip_prefix(&root) {
                    out.push(rel.to_string_lossy().replace('\\', "/"));
                }
            }
        }
        out
    }

    /// One attached file from a device, kept with its backups.
    pub fn save_file(app: &AppHandle, id: &str, rel: &str, bytes: &[u8]) -> Result<(), String> {
        if !safe_rel(rel) {
            return Err("not an attachment".into());
        }
        let path = files_dir(app, id)?.join(rel);
        fs::create_dir_all(path.parent().ok_or("bad path")?).map_err(|e| e.to_string())?;
        crate::atomic_write(&path, bytes)
    }

    /// A kept file, for rebuilding the boards when a backup is sent back or copied here.
    #[tauri::command]
    pub fn device_backup_file(app: AppHandle, id: String, rel: String) -> Result<tauri::ipc::Response, String> {
        if !safe_rel(&rel) {
            return Err("not an attachment".into());
        }
        let bytes = fs::read(files_dir(&app, &id)?.join(&rel)).map_err(|_| "That file isn't in the backup.".to_string())?;
        Ok(tauri::ipc::Response::new(bytes))
    }

    /// Files no kept day uses any more go.
    fn prune_files(app: &AppHandle, id: &str, d: &std::path::Path) {
        let mut used = std::collections::HashSet::new();
        for date in days_of(d) {
            let Some(v) = fs::read_to_string(d.join(format!("{date}.json"))).ok().and_then(|t| serde_json::from_str::<Value>(&t).ok()) else { continue };
            if let Some(data) = v["data"].as_str().and_then(|t| serde_json::from_str::<Value>(t).ok()) {
                used.extend(stored_refs(&data));
            }
        }
        let Ok(root) = files_dir(app, id) else { return };
        for rel in stored_files(app, id) {
            if !used.contains(&rel) {
                let _ = fs::remove_file(root.join(&rel));
            }
        }
    }

    /// Every device's backups, newest first: `[{ id, name, days: [{ date, at, boards, private }] }]`.
    #[tauri::command]
    pub fn device_backups(app: AppHandle) -> Vec<Value> {
        let Ok(root) = crate::data_dir(&app).map(|d| d.join(DIR)) else { return vec![] };
        let mut out: Vec<Value> = fs::read_dir(root)
            .into_iter()
            .flatten()
            .flatten()
            .filter_map(|e| {
                let id = e.file_name().to_str()?.to_string();
                let d = e.path();
                let name = fs::read_to_string(d.join("device.json"))
                    .ok()
                    .and_then(|s| serde_json::from_str::<Value>(&s).ok())
                    .and_then(|v| v["name"].as_str().map(str::to_string))
                    .unwrap_or_else(|| "A device".into());
                let mut days: Vec<Value> = days_of(&d)
                    .into_iter()
                    .filter_map(|date| {
                        let v: Value = serde_json::from_str(&fs::read_to_string(d.join(format!("{date}.json"))).ok()?).ok()?;
                        Some(json!({ "date": date, "at": v["at"], "boards": v["boards"], "private": v["private"].is_string() }))
                    })
                    .collect();
                days.sort_by(|a, b| b["date"].as_str().cmp(&a["date"].as_str()));
                (!days.is_empty()).then(|| json!({ "id": id, "name": name, "days": days }))
            })
            .collect();
        out.sort_by(|a, b| b["days"][0]["at"].as_u64().cmp(&a["days"][0]["at"].as_u64()));
        out
    }

    /// One day's backup: `{ data, private }` (the boards as the device had them, and the locked private ones).
    #[tauri::command]
    pub fn device_backup_read(app: AppHandle, id: String, date: String) -> Result<Value, String> {
        if !safe(&date) {
            return Err("not a backup".into());
        }
        let text = fs::read_to_string(dir(&app, &id)?.join(format!("{date}.json"))).map_err(|_| "That backup isn't here anymore.".to_string())?;
        let v: Value = serde_json::from_str(&text).map_err(|e| e.to_string())?;
        Ok(json!({ "data": v["data"], "private": v["private"] }))
    }

    /// Delete one day's backup, or (without a date) all of a device's.
    #[tauri::command]
    pub fn device_backup_delete(app: AppHandle, id: String, date: Option<String>) -> Result<(), String> {
        let d = dir(&app, &id)?;
        match date {
            Some(date) if safe(&date) => fs::remove_file(d.join(format!("{date}.json"))).map_err(|e| e.to_string()),
            Some(_) => Err("not a backup".into()),
            None => fs::remove_dir_all(d).map_err(|e| e.to_string()),
        }?;
        LAST.lock().unwrap().get_or_insert_with(HashMap::new).remove(&id);
        Ok(())
    }

    #[cfg(test)]
    mod tests {
        #[test]
        fn date_is_civil() {
            assert_eq!(super::today().len(), 10);
            assert!(super::safe("2026-10-27") && super::safe("a1b2-c3") && !super::safe("../x") && !super::safe(""));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_stored_files_safely() {
        let data = json!({
            "cards": { "c": { "attachments": [
                { "stored": true, "url": "attachments/1/photo.jpg" },
                { "stored": false, "url": "https://example.com" },
                { "stored": true, "url": "attachments/../../etc/passwd" }
            ] } },
            "boards": { "b": { "background": { "type": "image", "value": "attachments/2/bg.png" } } }
        });
        assert_eq!(stored_refs(&data), vec!["attachments/1/photo.jpg", "attachments/2/bg.png"]);
        assert!(!safe_rel("/etc/passwd") && !safe_rel("attachments/../x") && safe_rel("attachments/a/b c.pdf"));
    }

    #[test]
    fn locks_and_opens_with_the_password() {
        let salt: [u8; 16] = random().unwrap();
        let key = derive("correct horse", &salt);
        let blob = seal(&key, &salt, b"{\"boards\":{}}").unwrap();
        assert!(blob.starts_with(TAG));
        assert_eq!(unseal(&blob, "correct horse").unwrap(), b"{\"boards\":{}}");
        assert!(unseal(&blob, "wrong horse").is_err());
        assert!(unseal("zb1:AAAA", "x").is_err());
    }
}
