#![cfg_attr(mobile, allow(dead_code))]
//! Files sent to this computer by other people's phones (a device that belongs to someone, see
//! people.rs). Off unless turned on in Settings > Phones & tablets: then limited to the chosen kinds of
//! file and an amount per person, and never anything that runs. Every file from a phone is checked for
//! viruses when this computer has a scanner: Microsoft Defender on Windows, ClamAV on Linux (macOS
//! checks files itself when they're opened).

use serde::{Deserialize, Serialize};
use std::path::Path;
use std::process::Command;

/// What other people's phones may send (Settings > Phones & tablets > Files from other people).
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Rules {
    /// People's phones may attach files at all (off by default).
    #[serde(default)]
    pub allow: bool,
    /// Megabytes each person may send in all.
    #[serde(default = "default_mb")]
    pub max_mb: u64,
    /// "images", "documents" (and images) or "any" (anything that doesn't run).
    #[serde(default = "default_kinds")]
    pub kinds: String,
    /// Check files from phones for viruses when a scanner is available.
    #[serde(default = "yes")]
    pub scan: bool,
}

fn default_mb() -> u64 {
    200
}
fn default_kinds() -> String {
    "documents".into()
}
fn yes() -> bool {
    true
}

impl Default for Rules {
    fn default() -> Self {
        Rules { allow: false, max_mb: default_mb(), kinds: default_kinds(), scan: true }
    }
}

const IMAGES: &[&str] = &["png", "jpg", "jpeg", "gif", "webp", "heic", "heif", "bmp", "avif"];
const DOCUMENTS: &[&str] = &[
    "pdf", "txt", "md", "csv", "rtf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "odt", "ods", "odp", "pages", "numbers", "key", "zomello", "ics", "mp3",
    "m4a", "mp4", "mov",
];
/// Files that run something when opened: never from someone else's phone. (Same idea as src/safeOpen.ts.)
const RUNS: &[&str] = &[
    "exe", "com", "bat", "cmd", "scr", "pif", "msi", "msix", "msixbundle", "appx", "appxbundle", "msp", "mst", "ps1", "psm1", "psd1", "vbs", "vbe", "js", "jse",
    "wsf", "wsh", "wsc", "hta", "cpl", "jar", "lnk", "url", "reg", "inf", "scf", "appref-ms", "application", "gadget", "settingcontent-ms", "library-ms",
    "search-ms", "diagcab", "chm", "sh", "bash", "zsh", "csh", "ksh", "fish", "command", "tool", "app", "pkg", "mpkg", "dmg", "workflow", "terminal",
    "desktop", "appimage", "run", "bin", "deb", "rpm", "snap", "flatpakref", "py", "pyw", "pl", "rb", "php", "html", "htm", "svg", "xhtml", "iso", "img",
    "vhd", "vhdx",
];

fn ext_of(name: &str) -> String {
    let name = name.trim_end_matches(|c: char| c == '.' || c.is_whitespace());
    name.rsplit_once('.').map(|(_, e)| e.to_ascii_lowercase()).unwrap_or_default()
}

/// Why a file from someone else's phone isn't accepted, or None when it is.
pub fn refuse(rules: &Rules, name: &str, size: u64, used: u64) -> Option<String> {
    if !rules.allow {
        return Some("This computer doesn't take files from other people's phones. Its owner can turn that on in Settings > Phones & tablets.".into());
    }
    let ext = ext_of(name);
    if RUNS.contains(&ext.as_str()) {
        return Some("Files that run programs or open as web pages can't be sent to this computer.".into());
    }
    let ok = match rules.kinds.as_str() {
        "images" => IMAGES.contains(&ext.as_str()),
        "any" => true,
        _ => IMAGES.contains(&ext.as_str()) || DOCUMENTS.contains(&ext.as_str()),
    };
    if !ok {
        return Some(match rules.kinds.as_str() {
            "images" => "This computer only takes pictures from other people's phones.".into(),
            _ => "This computer only takes pictures and documents from other people's phones.".into(),
        });
    }
    if used + size > rules.max_mb * 1024 * 1024 {
        return Some(format!("That's more than the {} MB this computer takes from each person.", rules.max_mb));
    }
    None
}

/// The virus scanner this computer has, if any: (name for Settings, how to run it).
fn scanner() -> Option<(&'static str, Command)> {
    #[cfg(windows)]
    {
        let base = std::env::var("ProgramFiles").unwrap_or_else(|_| r"C:\Program Files".into());
        let exe = Path::new(&base).join("Windows Defender").join("MpCmdRun.exe");
        if exe.exists() {
            let mut c = Command::new(exe);
            c.args(["-Scan", "-ScanType", "3", "-DisableRemediation", "-File"]);
            use std::os::windows::process::CommandExt;
            c.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
            return Some(("Microsoft Defender", c));
        }
    }
    #[cfg(target_os = "linux")]
    {
        for (name, cmd) in [("ClamAV", "clamdscan"), ("ClamAV", "clamscan")] {
            if Command::new(cmd).arg("--version").output().is_ok_and(|o| o.status.success()) {
                let mut c = Command::new(cmd);
                c.args(["--no-summary", "--infected"]);
                if cmd == "clamdscan" {
                    c.arg("--fdpass");
                }
                return Some((name, c));
            }
        }
    }
    None
}

/// The scanner's name for Settings, or None.
pub fn scanner_name() -> Option<&'static str> {
    scanner().map(|(n, _)| n)
}

/// Some(true) = a threat was found, Some(false) = clean, None = no scanner (or it couldn't check).
pub fn infected(path: &Path) -> Option<bool> {
    let (_, mut c) = scanner()?;
    let status = c.arg(path).output().ok()?.status;
    // Defender: 0 clean, 2 threat found. ClamAV: 0 clean, 1 found, 2 error.
    match status.code() {
        Some(0) => Some(false),
        #[cfg(windows)]
        Some(2) => Some(true),
        #[cfg(not(windows))]
        Some(1) => Some(true),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rules() {
        let off = Rules::default();
        assert!(refuse(&off, "a.pdf", 1, 0).is_some());
        let on = Rules { allow: true, ..Rules::default() };
        assert!(refuse(&on, "a.pdf", 1, 0).is_none());
        assert!(refuse(&on, "photo.JPG", 1, 0).is_none());
        assert!(refuse(&on, "run.exe", 1, 0).is_some());
        assert!(refuse(&on, "run.bat. ", 1, 0).is_some());
        assert!(refuse(&on, "page.html", 1, 0).is_some());
        assert!(refuse(&on, "archive.zip", 1, 0).is_some()); // not a document
        assert!(refuse(&Rules { kinds: "any".into(), ..on.clone() }, "archive.zip", 1, 0).is_none());
        assert!(refuse(&Rules { kinds: "images".into(), ..on.clone() }, "a.pdf", 1, 0).is_some());
        assert!(refuse(&on, "a.pdf", 2, 200 * 1024 * 1024 - 1).is_some());
    }
}
