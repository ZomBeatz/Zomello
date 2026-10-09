#!/usr/bin/env bash
# Build Planwise and install it for the current user: binary in ~/.local/bin,
# icons in the hicolor theme, and a .desktop entry (app menu + window/taskbar icon).
# The .desktop file name must match the Wayland app id (the Tauri identifier).
set -euo pipefail
cd "$(dirname "$0")/.."

APP_ID=com.zombeatz.planwise
BIN="$HOME/.local/bin/planwise"
ICONS="$HOME/.local/share/icons/hicolor"
APPS="$HOME/.local/share/applications"

if [[ "${1:-}" != "--icons-only" ]]; then
  npm run tauri -- build --no-bundle
  install -Dm755 src-tauri/target/release/planwise "$BIN"
fi

install -Dm644 src-tauri/icons/32x32.png        "$ICONS/32x32/apps/$APP_ID.png"
install -Dm644 src-tauri/icons/64x64.png        "$ICONS/64x64/apps/$APP_ID.png"
install -Dm644 src-tauri/icons/128x128.png      "$ICONS/128x128/apps/$APP_ID.png"
install -Dm644 src-tauri/icons/128x128@2x.png   "$ICONS/256x256/apps/$APP_ID.png"
install -Dm644 src-tauri/icons/icon.png         "$ICONS/512x512/apps/$APP_ID.png"
install -Dm644 app-icon.svg                     "$ICONS/scalable/apps/$APP_ID.svg"

mkdir -p "$APPS"
cat > "$APPS/$APP_ID.desktop" <<DESKTOP
[Desktop Entry]
Type=Application
Name=Planwise
GenericName=Task Planner
Comment=Local-first kanban & planner
Exec=$BIN
Icon=$APP_ID
Terminal=false
Categories=Office;ProjectManagement;
Keywords=kanban;tasks;todo;planner;trello;
StartupWMClass=$APP_ID
DESKTOP

update-desktop-database "$APPS" 2>/dev/null || true
gtk-update-icon-cache -q -t "$ICONS" 2>/dev/null || true
kbuildsycoca6 --noincremental >/dev/null 2>&1 || true

echo "Installed. Launch 'Planwise' from your app menu (or run $BIN)."
