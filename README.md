# Zomello

A local-first kanban + planner (Kanri × Trello × Microsoft Planner) by ZomBeatz Media, built with Tauri 2,
React and TypeScript. Your boards stay on your own devices, or on your own Zomello Server.

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
- **AI hand-off** (no AI built in): copy-ready prompts to fill a bucket or plan a whole board with the board's context;
  Markdown exports of a board / bucket / cards with a task (triage bugs, break down, prioritize, status); paste the
  AI's reply back to add cards (with linked sub-tasks), build a board, or update cards — previewed and undoable
- **Sub-tasks**: checklist items linked to cards, parent/sub-task badges and hover highlights, loop prevention,
  "Add to a parent task"; drag to reorder checklists, insert between items, labels on items
- **Spell check** in every text field (system dictionary; on Linux install `hunspell-en_us`)
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

## Get it
| | |
|---|---|
| **Windows 10/11** | `Zomello_x.y.z_x64-setup.exe` from [Releases](../../releases) |
| **Linux** | `.AppImage`, `.deb` or `.rpm` from [Releases](../../releases) |
| **Android** | `Zomello.apk` from [Releases](../../releases) |
| **Zomello Server** | Docker image or a single program for Windows, Linux and macOS. See below |

Install notes, phone pairing and building it yourself: [docs/apps.md](docs/apps.md).

Boards can be passed around as `.zomello` files (⋯ → Save as board file), no server needed.

## Zomello Server (several people, on a server)
Run Zomello on a home server, NAS, Raspberry Pi or VPS. Everyone gets their own account and boards, boards can be
shared by invitation, changes show up live, and admins manage people and boards from the Admin page.

**Docker:**
```bash
curl -O https://raw.githubusercontent.com/<owner>/zomello/main/deploy/docker-compose.yml
docker compose up -d      # then open http://<server>:7311 and create the admin account
```
The image (`ghcr.io/<owner>/zomello-server`) runs on x86-64 and arm64 (Raspberry Pi 4/5).

**Without Docker:** download `zomello-server-…` for your system from [Releases](../../releases), run it, and
`zomello-server install` starts it with the computer (Windows task, systemd service or macOS LaunchAgent).

Settings, https options, backups and password recovery: [docs/server.md](docs/server.md).

## Development
```bash
npm install
npm run app        # Tauri dev window (hot reload)
npm run bundle     # release bundles → src-tauri/target/release/bundle/ (AppImage, deb, rpm)
npm run android    # build and install on a USB-connected Android phone
npm run server     # build Zomello Server → server/target/release/zomello-server
npm run dev        # browser-only UI at http://localhost:1420 (data in localStorage)
./scripts/install-desktop.sh   # Linux: build and install into the app menu
```

Data: `~/.local/share/com.zombeatz.zomello/` on Linux, `%APPDATA%\com.zombeatz.zomello` on Windows (the data file,
`backups/` and `attachments/`).

Blank window on NVIDIA/Wayland: the app sets `WEBKIT_DISABLE_DMABUF_RENDERER=1` itself; if it still happens,
try launching with `GDK_BACKEND=x11`.

## Layout
- `src-tauri/src/lib.rs` – load/save/backup/export, attachments, legacy migration
- `src/store.ts` – Zustand store, all mutations, undo/redo, activity log, autosave
- `src/utils.ts` – filtering, grouping, dates, recurrence, durations
- `src/shortcuts.ts`, `src/reminders.ts` – keyboard shortcuts, desktop notifications
- `src/components/` – pages, card modal, pickers, context menu and `views/`
- `server/` – Zomello Server (Rust, SQLite), `deploy/` – compose file for servers

## Contact
ZomBeatz Media · [info@zombeatzmedia.com](mailto:info@zombeatzmedia.com)
