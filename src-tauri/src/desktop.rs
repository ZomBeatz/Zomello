//! Running in the background: a tray icon (system tray / menu bar), closing the window keeps Zomello
//! running there (so phones stay connected and reminders keep coming), and starting at login.

use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager,
};
use tauri_plugin_autostart::ManagerExt;

pub const TRAY_ID: &str = "zomello";
/// Passed when Zomello starts at login, so it starts quietly in the tray.
pub const HIDDEN_ARG: &str = "--hidden";

const NO_TRAY_LINUX: &str = "This system has no tray support installed. Install libayatana-appindicator (Arch/CachyOS: sudo pacman -S libayatana-appindicator; Ubuntu/Debian: sudo apt install libayatana-appindicator3-1), then try again.";

/// Linux needs the (ayatana) appindicator library for a tray icon; the tray code panics without it,
/// so look before leaping. Other systems always have a tray.
fn tray_supported() -> bool {
    if !cfg!(target_os = "linux") {
        return true;
    }
    let names = ["libayatana-appindicator3.so.1", "libappindicator3.so.1"];
    let mut dirs: Vec<std::path::PathBuf> = ["/usr/lib", "/usr/lib64", "/usr/lib/x86_64-linux-gnu", "/lib/x86_64-linux-gnu", "/usr/lib/aarch64-linux-gnu", "/usr/local/lib"]
        .iter()
        .map(std::path::PathBuf::from)
        .collect();
    // AppImages carry their own copy.
    if let Some(appdir) = std::env::var_os("APPDIR") {
        dirs.push(std::path::Path::new(&appdir).join("usr/lib"));
    }
    if let Some(extra) = std::env::var_os("LD_LIBRARY_PATH") {
        dirs.extend(std::env::split_paths(&extra));
    }
    dirs.iter().any(|d| names.iter().any(|n| d.join(n).exists()))
}

/// Closing the main window hides it to the tray instead of quitting.
static BACKGROUND: AtomicBool = AtomicBool::new(false);

pub fn started_hidden() -> bool {
    std::env::args().any(|a| a == HIDDEN_ARG)
}

pub fn in_background_mode() -> bool {
    BACKGROUND.load(Ordering::Relaxed)
}

/// Bring the main window up (creating it again if it was closed).
pub fn show_main(app: &AppHandle) {
    match app.get_webview_window("main") {
        Some(w) => {
            let _ = w.show();
            let _ = w.unminimize();
            let _ = w.set_focus();
        }
        None => {
            if let Ok(w) = tauri::WebviewWindowBuilder::new(app, "main", tauri::WebviewUrl::App("index.html".into()))
                .title("Zomello")
                .inner_size(1400.0, 900.0)
                .min_inner_size(900.0, 600.0)
                .build()
            {
                crate::enable_spellcheck(&w);
            }
        }
    }
}

fn build_tray(app: &AppHandle) -> Result<(), String> {
    let open = MenuItem::with_id(app, "open", "Open Zomello", true, None::<&str>).map_err(|e| e.to_string())?;
    let sep = PredefinedMenuItem::separator(app).map_err(|e| e.to_string())?;
    let quit = MenuItem::with_id(app, "quit", "Quit Zomello", true, None::<&str>).map_err(|e| e.to_string())?;
    let menu = Menu::with_items(app, &[&open, &sep, &quit]).map_err(|e| e.to_string())?;
    let mut tray = TrayIconBuilder::with_id(TRAY_ID)
        .tooltip("Zomello")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "open" => show_main(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                show_main(tray.app_handle());
            }
        });
    if let Some(icon) = crate::app_icon::current(app) {
        tray = tray.icon(icon);
    }
    tray.build(app).map(|_| ()).map_err(|e| e.to_string())
}

/// Turn background mode on (tray icon; closing the window hides it) or off.
/// Errors when the tray can't be shown (on Linux it needs libayatana-appindicator).
#[tauri::command]
pub fn set_background_mode(app: AppHandle, enabled: bool) -> Result<(), String> {
    if !enabled {
        BACKGROUND.store(false, Ordering::Relaxed);
        let _ = app.remove_tray_by_id(TRAY_ID);
        return Ok(());
    }
    if app.tray_by_id(TRAY_ID).is_none() {
        if !tray_supported() {
            return Err(NO_TRAY_LINUX.into());
        }
        // A missing tray library on Linux panics deep inside; treat that as "not available".
        let built = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| build_tray(&app)));
        match built {
            Ok(Ok(())) => {}
            Ok(Err(e)) => return Err(e),
            Err(_) => {
                return Err(if cfg!(target_os = "linux") {
                    NO_TRAY_LINUX.into()
                } else {
                    "The tray icon couldn't be shown on this system.".into()
                })
            }
        }
    }
    BACKGROUND.store(true, Ordering::Relaxed);
    Ok(())
}

#[tauri::command]
pub fn show_main_window(app: AppHandle) {
    show_main(&app);
}

#[tauri::command]
pub fn get_autostart(app: AppHandle) -> bool {
    if is_store_package() {
        return false;
    }
    app.autolaunch().is_enabled().unwrap_or(false)
}

/// Installed from the Microsoft Store (an MSIX package lives under WindowsApps). Such an app can't add
/// itself to start at login, but its package declares a startup entry the person turns on in Windows;
/// its firewall rule for phones comes with the package too.
pub fn is_store_package() -> bool {
    cfg!(windows) && std::env::current_exe().is_ok_and(|p| p.to_string_lossy().to_ascii_lowercase().contains("\\windowsapps\\"))
}

#[tauri::command]
pub fn store_package() -> bool {
    is_store_package()
}

#[tauri::command]
pub fn set_autostart(app: AppHandle, enabled: bool) -> Result<(), String> {
    if is_store_package() {
        return Err("Turn it on in Windows: Settings → Apps → Startup → Zomello.".into());
    }
    let l = app.autolaunch();
    if enabled { l.enable() } else { l.disable() }.map_err(|e| e.to_string())
}
