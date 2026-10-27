// Registered on phones and tablets only.
#![cfg_attr(desktop, allow(dead_code))]
//! iPhone and iPad: the folder Zomello shares with its extensions (the app group), for the My Day widget
//! (ZomelloWidget) and "Add to Zomello" in the share sheet (ZomelloShare). Elsewhere these do nothing:
//! Android does the same through MainActivity.

#[cfg(target_os = "ios")]
fn group_dir() -> Option<std::path::PathBuf> {
    use objc2_foundation::{NSFileManager, NSString};
    let url = NSFileManager::defaultManager().containerURLForSecurityApplicationGroupIdentifier(&NSString::from_str("group.com.zombeatz.zomello"))?;
    Some(std::path::PathBuf::from(url.path()?.to_string()))
}
#[cfg(not(target_os = "ios"))]
fn group_dir() -> Option<std::path::PathBuf> {
    None
}

/// Today's and tomorrow's My Day for the widget (see src/widget.ts). It looks again every 15 minutes.
#[tauri::command]
pub fn widget_update(json: String) -> Result<(), String> {
    let Some(dir) = group_dir() else { return Ok(()) };
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    crate::atomic_write(&dir.join("widget.json"), json.as_bytes())
}

/// What was shared to Zomello since it was last open (`{ text, subject }` each, oldest first), and forget it.
#[tauri::command]
pub fn share_inbox_take() -> Vec<String> {
    let Some(dir) = group_dir().map(|d| d.join("inbox")) else { return vec![] };
    let mut files: Vec<_> = std::fs::read_dir(&dir).into_iter().flatten().flatten().map(|e| e.path()).filter(|p| p.extension().is_some_and(|x| x == "json")).collect();
    files.sort();
    files
        .into_iter()
        .filter_map(|p| {
            let text = std::fs::read_to_string(&p).ok();
            let _ = std::fs::remove_file(&p);
            text
        })
        .collect()
}
