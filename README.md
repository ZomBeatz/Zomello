# Planwise

A local-first kanban + planner (Kanri × Trello × Microsoft Planner) built with Tauri 2, React and TypeScript.
Everything stays on your machine.

## Features
- **Boards → buckets → cards**, drag-and-drop for cards and buckets, WIP limits, collapsible buckets
- **Rich cards**: description, checklist (convert items to cards), labels, priority, progress, start/due dates,
  assignees, links & local file paths, notes, cover colour, duplicate, move to another board
- **Views**: Board · List (sortable table, inline edit) · Calendar (drag to reschedule) · Timeline (Gantt) · Charts
- **Planner-style grouping** on the board: bucket, progress, priority, assignee, label, due date (drag between groups updates the field)
- **Home dashboard**: late, due today, next 7 days, in progress, recently completed, board progress
- **Filters** (text, labels, priority, progress, assignee, due) + **saved filters** per board
- **Global search** (`Ctrl+K`) across titles, descriptions, checklists and notes
- **Archive** for cards, buckets and boards with restore / permanent delete
- **Data safety**: atomic writes, automatic rolling backups (every 30 min, last 30 kept), JSON export/import
- Light / dark / system theme

## Run
```bash
npm install
npm run app        # Tauri dev window (hot reload)
npm run bundle     # release build → src-tauri/target/release/bundle/ (AppImage, deb, rpm)
npm run dev        # browser-only UI at http://localhost:1420 (stores data in localStorage)
```
Release binary: `src-tauri/target/release/planwise`.

Data file: `~/.local/share/com.zombeatz.planwise/planwise.json` (backups in `backups/` next to it).

### Troubleshooting
Blank/white window on NVIDIA or some Wayland setups: run with `WEBKIT_DISABLE_DMABUF_RENDERER=1`.

## Layout
- `src-tauri/src/lib.rs` – load/save/backup/export commands
- `src/store.ts` – Zustand store, all mutations, debounced autosave
- `src/utils.ts` – filtering, grouping, dates
- `src/components/` – pages, card modal, and `views/` (Kanban, List, Calendar, Timeline, Charts)
