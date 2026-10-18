import { useEffect, useRef, useState } from "react";
import { AppWindow, ArrowRightLeft, Archive, Lock, Bot, Check, ClipboardCopy, ClipboardPaste, Copy, ExternalLink, FileDown, FolderOpen, FolderX, LayoutTemplate, LogOut, Palette, Pencil, Plus, Star, Trash2, Users } from "lucide-react";
import { boardCategories } from "../utils";
import type { Board } from "../types";
import { useStore } from "../store";
import { archiveBoard, deleteBoard } from "../actions";
import { isDeviceWindow, openBoardWindow } from "../windows";
import type { MenuEntry } from "./ContextMenu";
import { isServer, leaveBoard, ownsBoard } from "../server";
import { workOrder } from "../ai";
import { copyText } from "./Markdown";
import { exportBoard } from "../boardFile";
import { inTauri, isDesktopApp, isMobileApp } from "../storage";
import { linkedNow } from "../deviceWindow";
import { sendBoardToPhone } from "../phoneTransfer";
import { placesMode, usePlaces } from "../placeLists";
import { destinations, sendBoard } from "../transfer";

/** The right-click menu for a board, the same in the sidebar and on Home. */
export function boardMenu(board: Board, opts: { onRename?: () => void } = {}): MenuEntry[] {
  const st = useStore.getState();
  return [
    { label: "Open", icon: <ExternalLink size={14} />, onClick: () => st.navigate({ page: "board", boardId: board.id }) },
    ...(isServer ? [{ label: ownsBoard(board) ? "Share…" : "People on this board…", icon: <Users size={14} />, onClick: () => st.setOverlay({ shareBoardId: board.id }) }] : []),
    ...(isMobileApp
      ? []
      : [{ label: "Open in new window", icon: <AppWindow size={14} />, onClick: () => void openBoardWindow(board.id, board.title) }]),
    ...(opts.onRename ? [{ label: "Rename", icon: <Pencil size={14} />, onClick: opts.onRename }] : []),
    {
      label: board.category ? `Category: ${board.category}` : "Category…",
      icon: <FolderOpen size={14} />,
      submenu: (close) => <CategoryPicker board={board} onDone={close} />,
    },
    {
      label: board.starred ? "Unstar" : "Star",
      icon: <Star size={14} />,
      onClick: () => st.updateBoard(board.id, { starred: !board.starred }),
    },
    {
      label: "Customize…",
      icon: <Palette size={14} />,
      onClick: () => {
        st.navigate({ page: "board", boardId: board.id });
        st.setOverlay({ customizeBoardId: board.id });
      },
    },
    { separator: true },
    {
      label: "AI tools…",
      icon: <Bot size={14} />,
      onClick: () => st.setOverlay({ aiDialog: { tab: "ask", mode: "cards", boardId: board.id } }),
    },
    {
      label: "Copy work order (all open cards)",
      icon: <ClipboardCopy size={14} />,
      onClick: () => {
        const all = Object.values(useStore.getState().data.cards).filter((c) => c.boardId === board.id);
        copyText(workOrder(board.id, all, `${board.title}: open items`));
      },
    },
    {
      label: "Paste cards…",
      icon: <ClipboardPaste size={14} />,
      onClick: () => {
        st.navigate({ page: "board", boardId: board.id });
        st.setOverlay({ pasteCards: { boardId: board.id } });
      },
    },
    { separator: true },
    {
      label: "Duplicate",
      icon: <Copy size={14} />,
      onClick: () => st.navigate({ page: "board", boardId: st.duplicateBoard(board.id) }),
    },
    {
      label: "New board with this layout",
      icon: <LayoutTemplate size={14} />,
      onClick: () =>
        st.navigate({ page: "board", boardId: st.duplicateBoard(board.id, { title: `New ${board.title}`, withCards: false }) }),
    },
    ...(placesMode
      ? [
          ...(ownsBoard(board)
            ? [{ label: "Move to…", icon: <ArrowRightLeft size={14} />, submenu: (close: () => void) => <PlacePicker board={board} move onDone={close} /> }]
            : []),
          { label: "Copy to…", icon: <Copy size={14} />, submenu: (close: () => void) => <PlacePicker board={board} move={false} onDone={close} /> },
        ]
      : []),
    // Desktop: phones connected right now (same Wi‑Fi).
    ...(isDesktopApp && !isDeviceWindow
      ? linkedNow.flatMap((p) => [
          { label: `Move to ${p.name}`, icon: <ArrowRightLeft size={14} />, onClick: () => void sendBoardToPhone(board.id, p, true) },
          { label: `Copy to ${p.name}`, icon: <Copy size={14} />, onClick: () => void sendBoardToPhone(board.id, p, false) },
        ])
      : []),
    // The desktop app or the phone app's own boards: keep one off your other devices.
    ...(inTauri && !isDeviceWindow
      ? [
          {
            label: "Private: only on this device",
            icon: <Lock size={14} />,
            checked: !!board.private,
            onClick: () => {
              st.updateBoard(board.id, { private: !board.private });
              st.toast(board.private ? `“${board.title}” shows on your other devices again` : `“${board.title}” is private: it stays on this device`);
            },
          },
        ]
      : []),
    {
      label: "Save as board file…",
      icon: <FileDown size={14} />,
      onClick: () => void exportBoard(board.id),
    },
    // On a shared server, only a board's owner archives or deletes it; others can leave it.
    ...(ownsBoard(board)
      ? [
          { label: "Archive", icon: <Archive size={14} />, onClick: () => archiveBoard(board) },
          { label: "Delete", icon: <Trash2 size={14} />, danger: true, onClick: () => void deleteBoard(board) },
        ]
      : [
          {
            label: "Leave board",
            icon: <LogOut size={14} />,
            danger: true,
            onClick: () => void leaveBoard(board.id).then(() => st.toast(`You left “${board.title}”`)),
          },
        ]),
  ];
}

/** Phones and tablets: the other places a board can be moved or copied to. */
function PlacePicker({ board, move, onDone }: { board: Board; move: boolean; onDone: () => void }) {
  const places = usePlaces();
  const to = places ? destinations(places.me, places.list) : [];
  return (
    <div className="menu">
      <span className="menu-heading">
        {move ? "Move" : "Copy"} “{board.title}” to
      </span>
      {!places && <span className="menu-item muted">Loading…</span>}
      {places && to.length === 0 && <span className="menu-item muted">No other places yet. Add your computer or a server in Settings.</span>}
      {to.map((p) => (
        <button
          key={p.key}
          className="menu-item"
          onClick={() => {
            onDone();
            void sendBoard(board.id, p, move);
          }}
        >
          {p.name}
        </button>
      ))}
    </div>
  );
}

/** Pick a category for a board, or make a new one. */
export function CategoryPicker({ board, onDone }: { board: Board; onDone: () => void }) {
  const boards = useStore((s) => s.data.boards);
  const [name, setName] = useState("");
  const sections = useStore((s) => s.data.settings.sections);
  const cats = boardCategories(Object.values(boards), sections);
  const input = useRef<HTMLInputElement>(null);
  // The flyout opens on hover, so focus the box once it's on screen.
  useEffect(() => {
    const t = setTimeout(() => input.current?.focus(), 50);
    return () => clearTimeout(t);
  }, []);
  const pick = (c: string | null) => {
    useStore.getState().setBoardCategory(board.id, c);
    onDone();
  };
  return (
    <div className="menu category-picker">
      <span className="menu-heading">Category for “{board.title}”</span>
      <button className="menu-item" onClick={() => pick(null)}>
        <span className="ctx-icon">{!board.category && <Check size={14} />}</span>
        <span className="muted">No category</span>
      </button>
      {cats.map((c) => (
        <button key={c} className="menu-item" onClick={() => pick(c)}>
          <span className="ctx-icon">{board.category === c && <Check size={14} />}</span>
          <span>{c}</span>
        </button>
      ))}
      <form
        className="row gap-sm pad-sm"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) pick(name.trim());
        }}
      >
        <input ref={input} placeholder="New category, e.g. Work" value={name} onChange={(e) => setName(e.target.value)} />
        <button className="btn sm" type="submit" disabled={!name.trim()} title="Add category">
          <Plus size={14} />
        </button>
      </form>
    </div>
  );
}

/** Right-click on a category heading: rename it (on every board in it) or remove it (boards stay). */
export function categoryMenu(name: string): MenuEntry[] {
  return [
    { label: "Rename category", icon: <Pencil size={14} />, submenu: (close) => <RenameCategory name={name} onDone={close} /> },
    {
      label: "Remove category (keeps the boards)",
      icon: <FolderX size={14} />,
      onClick: () => {
        useStore.getState().removeCategory(name);
        useStore.getState().toast(`Removed the category “${name}”. Its boards are still here.`, { undo: true });
      },
    },
  ];
}

function RenameCategory({ name, onDone }: { name: string; onDone: () => void }) {
  const [v, setV] = useState(name);
  return (
    <form
      className="menu row gap-sm pad-sm"
      onSubmit={(e) => {
        e.preventDefault();
        useStore.getState().renameCategory(name, v);
        onDone();
      }}
    >
      <input autoFocus value={v} onChange={(e) => setV(e.target.value)} onFocus={(e) => e.target.select()} />
      <button className="btn sm" type="submit" disabled={!v.trim()}>
        Rename
      </button>
    </form>
  );
}
