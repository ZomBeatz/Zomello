# Zomello

A local-first kanban + planner (Kanri × Trello × Microsoft Planner) by ZomBeatz Media, built with Tauri 2,
React and TypeScript. Everything stays on your machine.

## Features
- **Boards → buckets → cards** with drag-and-drop, WIP limits, collapsible buckets, Planner-style
  "Completed" section under each bucket
- **Rich cards**: Markdown description and notes with a formatting toolbar (code blocks get a Copy button), checklist (items can link to / spin off into tasks on any
  board), labels, priority, progress, start/due dates, assignees, reminders, cover color or image
  (strip or full card), duplicate, move to another board
- **Files**: attach files (button or drag-and-drop) — they are copied into Zomello's own storage; images get
  thumbnails and can be card covers. Links and local paths work too
- **Linked tasks** across boards (related / blocks / blocked by) with a Blocked badge
- **Recurring tasks** (daily / weekly on chosen days / monthly / yearly, every N, until a date)
- **Time tracking**: start / pause / resume (one at a time, shown in the sidebar), manual logging, estimates,
  time charts
- **Focus countdown**: 5–60 min or custom, from the sidebar or a card (also tracks time on it), with a chime
  and desktop notification
- **Bucket sorting** (due, priority, name, progress, newest, recently updated) that never touches the custom order
- **Custom fields** per board (text, number, dropdown, checkbox, date, link), optionally shown on cards
- **Card display**: each detail can be hidden, an icon, or the full information; card window sections can be hidden
- **Import** boards from Trello (.json) or Microsoft Planner (.xlsx / .csv)
- **Activity history** on every card (moves, progress, dates, priority, assignment, renames, archive)
- **Card templates** (save from any card; use from "+ Add card", Quick add) and "new board with this layout"
- **Views**: Board · List · Calendar · Timeline · Charts; group the board by bucket, progress, priority,
  assignee, label or due date
- **Home** dashboard and **My Tasks** (everything assigned to you, across boards)
- **Quick add** from anywhere (`N`), global search (`Ctrl+K`), keyboard shortcuts (`?`)
- **Undo / redo** (`Ctrl+Z` / `Ctrl+Shift+Z`) plus Undo buttons on archive/delete toasts
- **Desktop reminders**: per-card reminder times and a daily digest of late / due-today work
- **Customization**: per-board icon, color, background (gradients, colors, your own image), column width,
  compact cards, label style, which badges show, card aging; app-wide accent color, theme, density,
  week start, default view, collapsible sidebar
- **Right-click menu** on cards everywhere
- **Data safety**: atomic writes, automatic rolling backups, JSON export/import, single running instance

## Install (app menu + icon)
```bash
./scripts/install-desktop.sh   # builds release, installs ~/.local/bin/zomello + zomello.desktop + icons
```
The `.desktop` file must be named after the executable (`zomello`): on Wayland, KDE matches the window to it
by that name, which is where the title-bar/taskbar icon comes from.

## Windows
Zomello runs on Windows 10/11 too (it uses the built-in Edge WebView2). Ways to build the installer:
- **Cross-compile from Linux** (NSIS `.exe` installer):
  ```bash
  rustup target add x86_64-pc-windows-msvc
  cargo install --locked cargo-xwin      # downloads Microsoft's CRT/SDK headers on first use (their license applies)
  paru -S nsis                           # NSIS installer builder (AUR)
  npm run tauri -- build --runner cargo-xwin --target x86_64-pc-windows-msvc --bundles nsis
  ```
  → `src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis/Zomello_*_x64-setup.exe`
- **On a Windows PC**: install Node.js LTS, Rust (rustup) and the "Desktop development with C++" build tools, then
  `npm install` and `npm run bundle`.
- **GitHub Actions**: push the repo to GitHub and run the *Build installers* workflow (`.github/workflows/build.yml`).

The installer is unsigned, so Windows SmartScreen will say "Windows protected your PC" — click **More info → Run anyway**.
It installs per-user (no admin needed); data lives in `%APPDATA%\com.zombeatz.zomello`.

## Run
```bash
npm install
npm run app        # Tauri dev window (hot reload)
npm run bundle     # release bundles → src-tauri/target/release/bundle/ (AppImage, deb, rpm)
npm run dev        # browser-only UI at http://localhost:1420 (data in localStorage)
```

Data: `~/.local/share/com.zombeatz.zomello/zomello.json` (with `backups/` and `attachments/` next to it).
Data from the earlier "Planwise" name is copied over automatically on first launch.

### Troubleshooting
Blank window on NVIDIA/Wayland: the app sets `WEBKIT_DISABLE_DMABUF_RENDERER=1` itself; if it still happens,
try launching with `GDK_BACKEND=x11`.

## Layout
- `src-tauri/src/lib.rs` – load/save/backup/export, attachments, legacy migration
- `src/store.ts` – Zustand store, all mutations, undo/redo, activity log, autosave
- `src/utils.ts` – filtering, grouping, dates, recurrence, durations
- `src/shortcuts.ts`, `src/reminders.ts` – keyboard shortcuts, desktop notifications
- `src/components/` – pages, card modal, pickers, context menu and `views/`
