//! Portable mode: a folder named "Zomello Data" next to the app (the .exe on Windows, the .AppImage on
//! Linux, the .app on a Mac) holds everything Zomello keeps (boards, attached files, backups, the problem
//! log and, on Windows, the web view's own files), so the app runs from a USB stick or any folder without
//! being installed and leaves nothing on the computer. Without that folder, it uses the usual places.

use std::path::PathBuf;
use std::sync::OnceLock;

pub const FOLDER: &str = "Zomello Data";

/// The "Zomello Data" folder next to the app, when there is one.
pub fn dir() -> Option<&'static PathBuf> {
    static DIR: OnceLock<Option<PathBuf>> = OnceLock::new();
    DIR.get_or_init(|| {
        if cfg!(mobile) {
            return None;
        }
        // An AppImage runs from a temporary mount; the file itself is what people move around.
        let app = std::env::var_os("APPIMAGE").map(PathBuf::from).or_else(|| std::env::current_exe().ok())?;
        let mut folder = app.parent()?.to_path_buf();
        // Zomello.app/Contents/MacOS/zomello: look next to the .app.
        if cfg!(target_os = "macos") {
            if let Some(bundle) = app.ancestors().find(|p| p.extension().is_some_and(|e| e == "app")) {
                folder = bundle.parent()?.to_path_buf();
            }
        }
        let data = folder.join(FOLDER);
        data.is_dir().then_some(data)
    })
    .as_ref()
}

/// Called first thing: on Windows the web view keeps its own files in the portable folder too.
pub fn prepare() {
    #[cfg(windows)]
    if let Some(d) = dir() {
        if std::env::var_os("WEBVIEW2_USER_DATA_FOLDER").is_none() {
            std::env::set_var("WEBVIEW2_USER_DATA_FOLDER", d.join("WebView"));
        }
    }
}
