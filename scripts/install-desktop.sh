#!/usr/bin/env bash
# Build Zomello and install it for the current user: binary in ~/.local/bin,
# icons in the hicolor theme, and a .desktop entry (app menu + window/taskbar icon).
#
# On Wayland, GTK reports the executable name ("zomello") as the window's app id,
# and KDE looks for <app id>.desktop to find the window icon — so both the .desktop
# file and the icon are named "zomello". This also covers `npm run app` dev builds.
set -euo pipefail
cd "$(dirname "$0")/.."

NAME=zomello
BIN="$HOME/.local/bin/$NAME"
ICONS="$HOME/.local/share/icons/hicolor"
APPS="$HOME/.local/share/applications"

if [[ "${1:-}" != "--icons-only" ]]; then
  npm run tauri -- build --no-bundle
  install -Dm755 "src-tauri/target/release/$NAME" "$BIN"
fi

install -Dm644 src-tauri/icons/32x32.png        "$ICONS/32x32/apps/$NAME.png"
install -Dm644 src-tauri/icons/64x64.png        "$ICONS/64x64/apps/$NAME.png"
install -Dm644 src-tauri/icons/128x128.png      "$ICONS/128x128/apps/$NAME.png"
install -Dm644 src-tauri/icons/128x128@2x.png   "$ICONS/256x256/apps/$NAME.png"
install -Dm644 src-tauri/icons/icon.png         "$ICONS/512x512/apps/$NAME.png"
install -Dm644 app-icon.svg                     "$ICONS/scalable/apps/$NAME.svg"

mkdir -p "$APPS"
cat > "$APPS/$NAME.desktop" <<DESKTOP
[Desktop Entry]
Type=Application
Name=Zomello
GenericName=Task Planner
Comment=Local-first kanban & planner
Exec=$BIN
Icon=$NAME
Terminal=false
Categories=Office;ProjectManagement;
Keywords=kanban;tasks;todo;planner;trello;
StartupWMClass=$NAME
DESKTOP

# Clean up entries from when the app was called Planwise.
rm -f "$APPS/com.zombeatz.planwise.desktop" "$HOME/.local/bin/planwise"
find "$ICONS" -name 'com.zombeatz.planwise.*' -delete 2>/dev/null || true

update-desktop-database "$APPS" 2>/dev/null || true
gtk-update-icon-cache -q -t "$ICONS" 2>/dev/null || true
kbuildsycoca6 --noincremental >/dev/null 2>&1 || true

echo "Installed. Launch 'Zomello' from your app menu (or run $BIN)."
