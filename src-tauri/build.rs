fn main() {
    // These commands get permissions of their own, so a computer's or server's page shown in the
    // phone app can be allowed just them (see capabilities/places.json).
    tauri_build::try_build(
        tauri_build::Attributes::new()
            .app_manifest(tauri_build::AppManifest::new().commands(&["places_read", "places_save_boards", "places_save_list"])),
    )
    .expect("failed to run tauri-build");
}
