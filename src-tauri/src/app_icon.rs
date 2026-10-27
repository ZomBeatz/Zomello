//! The app icon for the hidden styles (Bass Drop, Party Cat), chosen in Settings > Appearance.
//!
//! - Computers: the windows' and the tray's icon change while Zomello runs (the installed shortcut keeps
//!   the classic one; the page sets it again at every start).
//! - iPhone and iPad: an alternate app icon (Assets.xcassets has them); iOS tells the person it changed.
//! - Android: the page switches the launcher entry itself (MainActivity.setAppIcon).
//!
//! The pictures come from scripts/make-style-icons.py.

use tauri::AppHandle;

#[cfg(desktop)]
mod computer {
    use std::sync::Mutex;
    use tauri::{image::Image, AppHandle, Manager, WebviewWindow};

    static CHOSEN: Mutex<Option<&'static [u8]>> = Mutex::new(None);

    fn bytes(style: &str) -> Option<&'static [u8]> {
        match style {
            "bassdrop" => Some(include_bytes!("../icons/styles/bassdrop.png")),
            "partycat" => Some(include_bytes!("../icons/styles/partycat.png")),
            _ => None,
        }
    }

    /// The icon windows and the tray should show now.
    pub fn current(app: &AppHandle) -> Option<Image<'static>> {
        match *CHOSEN.lock().unwrap() {
            Some(b) => Image::from_bytes(b).ok(),
            None => app.default_window_icon().map(|i| i.clone().to_owned()),
        }
    }

    /// A window opened later (a board, a phone's boards, a server) gets the chosen icon too.
    pub fn apply(window: &WebviewWindow) {
        if CHOSEN.lock().unwrap().is_some() {
            if let Some(icon) = current(window.app_handle()) {
                let _ = window.set_icon(icon);
            }
        }
    }

    pub fn set(app: &AppHandle, style: &str) -> Result<(), String> {
        *CHOSEN.lock().unwrap() = bytes(style);
        let Some(icon) = current(app) else { return Ok(()) };
        for w in app.webview_windows().values() {
            let _ = w.set_icon(icon.clone());
        }
        if let Some(tray) = app.tray_by_id(crate::desktop::TRAY_ID) {
            let _ = tray.set_icon(Some(icon));
        }
        Ok(())
    }
}

#[cfg(desktop)]
pub use computer::{apply, current};

#[cfg(target_os = "ios")]
fn set_ios(app: &AppHandle, style: &str) -> Result<(), String> {
    let name = match style {
        "bassdrop" => Some("AppIcon-BassDrop"),
        "partycat" => Some("AppIcon-PartyCat"),
        _ => None,
    };
    app.run_on_main_thread(move || {
        use objc2::MainThreadMarker;
        use objc2_foundation::NSString;
        use objc2_ui_kit::UIApplication;
        let Some(mtm) = MainThreadMarker::new() else { return };
        let ui = UIApplication::sharedApplication(mtm);
        if !ui.supportsAlternateIcons() {
            return;
        }
        // Only when it differs: iOS shows a notice every time the icon is set.
        let now = ui.alternateIconName().map(|n| n.to_string());
        if now.as_deref() == name {
            return;
        }
        let name = name.map(NSString::from_str);
        ui.setAlternateIconName_completionHandler(name.as_deref(), None);
    })
    .map_err(|e| e.to_string())
}

/// Use the icon of a style: "classic", "bassdrop" or "partycat".
#[tauri::command]
pub fn set_app_icon(app: AppHandle, style: String) -> Result<(), String> {
    #[cfg(desktop)]
    return computer::set(&app, &style);
    #[cfg(target_os = "ios")]
    return set_ios(&app, &style);
    #[cfg(target_os = "android")]
    {
        let _ = (app, style);
        Ok(())
    }
}
