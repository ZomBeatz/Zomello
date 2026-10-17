//! Running Zomello Server like an app on Windows, macOS and Linux (Plex Media Server style): data in
//! the system's usual place, settings in a file next to the data, the browser opening on first run, and
//! `install` / `uninstall` to start it with the computer.

use std::path::{Path, PathBuf};
use std::process::Command;

/// Where the server keeps everything unless `ZOMELLO_DATA` says otherwise.
///   Windows: C:\ProgramData\Zomello Server   (the same for you and for the startup task)
///   macOS:   ~/Library/Application Support/Zomello Server
///   Linux:   ~/.local/share/zomello-server   (/var/lib/zomello-server when run as root)
pub fn default_data_dir() -> PathBuf {
    let var = |k: &str| std::env::var_os(k).filter(|v| !v.is_empty()).map(PathBuf::from);
    if cfg!(windows) {
        var("ProgramData").unwrap_or_else(|| PathBuf::from(r"C:\ProgramData")).join("Zomello Server")
    } else if cfg!(target_os = "macos") {
        var("HOME").unwrap_or_else(|| PathBuf::from("/tmp")).join("Library/Application Support/Zomello Server")
    } else if is_root() {
        PathBuf::from("/var/lib/zomello-server")
    } else {
        var("XDG_DATA_HOME")
            .or_else(|| var("HOME").map(|h| h.join(".local/share")))
            .unwrap_or_else(|| PathBuf::from("."))
            .join("zomello-server")
    }
}

#[cfg(unix)]
fn is_root() -> bool {
    // Avoids a libc dependency: root's home is / or /root, and `id -u` says 0.
    Command::new("id").arg("-u").output().map(|o| o.stdout.starts_with(b"0")).unwrap_or(false)
}
#[cfg(not(unix))]
fn is_root() -> bool {
    false
}

pub const SETTINGS_FILE: &str = "settings.env";

const SETTINGS_TEMPLATE: &str = "\
# Zomello Server settings. Lines look like NAME=value; remove the # to use one.
# Restart Zomello Server after changing this file. Environment variables win over this file.

# Port people connect to:
# ZOMELLO_PORT=7311

# https: off (default; use with Tailscale, Caddy, Nginx...), self (Zomello's own certificate) or files
# ZOMELLO_TLS=self
# ZOMELLO_HOSTS=zomello.lan,192.168.1.50
# ZOMELLO_TLS_CERT=C:\\certs\\fullchain.pem
# ZOMELLO_TLS_KEY=C:\\certs\\privkey.pem

# The address people type, shown on the Admin page:
# ZOMELLO_PUBLIC_URL=https://zomello.example.com
";

/// Read `settings.env` in the data folder (creating a commented example the first time).
/// Returns the settings it contains; environment variables take precedence when the caller looks up.
pub fn read_settings(dir: &Path) -> Vec<(String, String)> {
    let path = dir.join(SETTINGS_FILE);
    if !path.exists() {
        let _ = std::fs::write(&path, SETTINGS_TEMPLATE);
    }
    std::fs::read_to_string(&path)
        .unwrap_or_default()
        .lines()
        .filter_map(|l| {
            let l = l.trim();
            if l.starts_with('#') {
                return None;
            }
            let (k, v) = l.split_once('=')?;
            let v = v.trim().trim_matches('"');
            k.trim().starts_with("ZOMELLO_").then(|| (k.trim().to_string(), v.to_string()))
        })
        .collect()
}

/// Opened by double-click (a terminal window, not Docker or a service): show the app in the browser.
pub fn maybe_open_browser(url: &str) {
    use std::io::IsTerminal;
    if !std::io::stdout().is_terminal() || std::env::var_os("ZOMELLO_NO_BROWSER").is_some() || Path::new("/.dockerenv").exists() {
        return;
    }
    // Linux servers are usually headless; only open when there's a desktop.
    if cfg!(target_os = "linux") && std::env::var_os("DISPLAY").is_none() && std::env::var_os("WAYLAND_DISPLAY").is_none() {
        return;
    }
    let _ = if cfg!(windows) {
        Command::new("cmd").args(["/C", "start", "", url]).spawn()
    } else if cfg!(target_os = "macos") {
        Command::new("open").arg(url).spawn()
    } else {
        Command::new("xdg-open").arg(url).spawn()
    };
}

/// Windows: a double-clicked console window vanishes on exit, so let people read the message first.
pub fn pause_before_closing() {
    use std::io::IsTerminal;
    if cfg!(windows) && std::io::stdin().is_terminal() {
        eprintln!("Press Enter to close.");
        let _ = std::io::stdin().read_line(&mut String::new());
    }
}

fn exe() -> PathBuf {
    std::env::current_exe().expect("can't find this program's location")
}

fn run(cmd: &mut Command) -> bool {
    match cmd.status() {
        Ok(s) if s.success() => true,
        Ok(s) => {
            eprintln!("{:?} failed ({s})", cmd.get_program());
            false
        }
        Err(e) => {
            eprintln!("Couldn't run {:?}: {e}", cmd.get_program());
            false
        }
    }
}

const TASK: &str = "Zomello Server";
#[cfg(target_os = "macos")]
const LAUNCH_LABEL: &str = "media.zombeatz.zomello-server";

/// `zomello-server install`: start with the computer, and start now.
pub fn install(data_dir: &Path, port: u16) -> bool {
    let exe = exe();
    if cfg!(windows) {
        // A startup task running as SYSTEM: no window, runs before anyone signs in. Needs an
        // administrator Command Prompt (or PowerShell).
        let ok = run(Command::new("schtasks").args([
            "/Create", "/F", "/TN", TASK, "/SC", "ONSTART", "/RU", "SYSTEM", "/RL", "HIGHEST",
            "/TR", &format!("\"{}\"", exe.display()),
        ]));
        if !ok {
            eprintln!("Run this from an administrator Command Prompt: right-click Command Prompt → Run as administrator.");
            return false;
        }
        run(Command::new("netsh").args([
            "advfirewall", "firewall", "add", "rule", "name=Zomello Server", "dir=in", "action=allow", "protocol=TCP",
            &format!("localport={port}"), "profile=private,domain",
        ]));
        run(Command::new("schtasks").args(["/Run", "/TN", TASK]));
        println!("Zomello Server now starts with Windows (task \"{TASK}\"), and is running.");
    } else if cfg!(target_os = "macos") {
        #[cfg(target_os = "macos")]
        {
            let home = PathBuf::from(std::env::var("HOME").unwrap_or_default());
            let plist = home.join("Library/LaunchAgents").join(format!("{LAUNCH_LABEL}.plist"));
            let _ = std::fs::create_dir_all(plist.parent().unwrap());
            let body = format!(
                r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>{LAUNCH_LABEL}</string>
  <key>ProgramArguments</key><array><string>{}</string></array>
  <key>EnvironmentVariables</key><dict><key>ZOMELLO_DATA</key><string>{}</string><key>ZOMELLO_NO_BROWSER</key><string>1</string></dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardErrorPath</key><string>{}</string>
</dict></plist>
"#,
                exe.display(),
                data_dir.display(),
                data_dir.join("server.log").display()
            );
            if std::fs::write(&plist, body).is_err() {
                eprintln!("Couldn't write {}", plist.display());
                return false;
            }
            let _ = Command::new("launchctl").args(["unload", &plist.to_string_lossy()]).status();
            if !run(Command::new("launchctl").args(["load", "-w", &plist.to_string_lossy()])) {
                return false;
            }
            println!("Zomello Server now starts when you sign in to this Mac, and is running.");
        }
    } else {
        // Linux: a systemd service (system-wide as root, else for this user).
        let root = is_root();
        let unit = if root {
            PathBuf::from("/etc/systemd/system/zomello-server.service")
        } else {
            PathBuf::from(std::env::var("HOME").unwrap_or_default()).join(".config/systemd/user/zomello-server.service")
        };
        let _ = std::fs::create_dir_all(unit.parent().unwrap());
        let body = format!(
            "[Unit]\nDescription=Zomello Server\nAfter=network-online.target\nWants=network-online.target\n\n[Service]\nExecStart={}\nEnvironment=ZOMELLO_DATA={}\nEnvironment=ZOMELLO_NO_BROWSER=1\nRestart=on-failure\n\n[Install]\nWantedBy={}\n",
            exe.display(),
            data_dir.display(),
            if root { "multi-user.target" } else { "default.target" }
        );
        if std::fs::write(&unit, body).is_err() {
            eprintln!("Couldn't write {}", unit.display());
            return false;
        }
        let ctl = |args: &[&str]| {
            let mut c = Command::new("systemctl");
            if !root {
                c.arg("--user");
            }
            run(c.args(args))
        };
        if !(ctl(&["daemon-reload"]) && ctl(&["enable", "--now", "zomello-server"])) {
            return false;
        }
        println!("Zomello Server is running as a systemd service ({}).", unit.display());
        if !root {
            println!("To keep it running when you're signed out: sudo loginctl enable-linger $USER");
        }
    }
    true
}

/// `zomello-server uninstall`: stop starting with the computer. Data stays where it is.
pub fn uninstall() -> bool {
    if cfg!(windows) {
        run(Command::new("schtasks").args(["/End", "/TN", TASK]));
        let ok = run(Command::new("schtasks").args(["/Delete", "/F", "/TN", TASK]));
        run(Command::new("netsh").args(["advfirewall", "firewall", "delete", "rule", "name=Zomello Server"]));
        ok
    } else if cfg!(target_os = "macos") {
        #[cfg(target_os = "macos")]
        {
            let plist = PathBuf::from(std::env::var("HOME").unwrap_or_default()).join("Library/LaunchAgents").join(format!("{LAUNCH_LABEL}.plist"));
            let _ = Command::new("launchctl").args(["unload", &plist.to_string_lossy()]).status();
            let _ = std::fs::remove_file(&plist);
        }
        true
    } else {
        let root = is_root();
        let mut c = Command::new("systemctl");
        if !root {
            c.arg("--user");
        }
        run(c.args(["disable", "--now", "zomello-server"]));
        let unit = if root {
            PathBuf::from("/etc/systemd/system/zomello-server.service")
        } else {
            PathBuf::from(std::env::var("HOME").unwrap_or_default()).join(".config/systemd/user/zomello-server.service")
        };
        let _ = std::fs::remove_file(unit);
        true
    }
}
