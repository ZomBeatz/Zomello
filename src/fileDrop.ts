import { create } from "zustand";
import { useStore } from "./store";
import { attachToCard, dropIsEmpty, readDrop } from "./attachments";
import type { ID } from "./types";
import { inTauri, isWindows } from "./storage";
import { isBoardFile, openBoardFile, openBoardFilePath } from "./boardFile";

/**
 * Things dragged in from outside the app (files, web links):
 *  - a card is open        → drop anywhere attaches to that card;
 *  - hovering a card tile   → drop attaches to that card;
 *  - over a drop zone (`data-file-drop="<name>"`, e.g. board background, import) → that zone's handler;
 *  - anywhere else         → refused, with a hint.
 *
 * In the desktop app the *files* come from Tauri's native drop event (WebKitGTK doesn't hand the page
 * a readable file list for drags from a file manager). Where the pointer is comes from the page's own
 * dragover events when available (Linux), otherwise from the native event's position (Windows).
 * In a plain browser everything goes through HTML5 drag events.
 */
export type DropMode = "card" | "tile" | "zone" | "none";

interface DropState {
  active: boolean;
  mode: DropMode;
  cardId: ID | null;
  zone: string | null;
}
export const useDrop = create<DropState>(() => ({ active: false, mode: "none", cardId: null, zone: null }));

// ---- drop zones -------------------------------------------------------------------
export interface ZoneDrop {
  files: File[];
  paths: string[];
}
const zones = new Map<string, (d: ZoneDrop) => void>();
/** A `data-file-drop="<name>"` element registers what to do with files dropped on it. */
export function registerDropZone(name: string, handler: (d: ZoneDrop) => void) {
  zones.set(name, handler);
  return () => {
    if (zones.get(name) === handler) zones.delete(name);
  };
}

// ---- where is the pointer -------------------------------------------------------------
let highlighted: Element | null = null;
const highlight = (el: Element | null) => {
  if (highlighted === el) return;
  highlighted?.classList.remove("file-drop-target");
  el?.classList.add("file-drop-target");
  highlighted = el;
};

function reset() {
  highlight(null);
  useDrop.setState({ active: false, mode: "none", cardId: null, zone: null });
}

function update(target: Element | null) {
  const zoneEl = target?.closest("[data-file-drop]");
  const open = useStore.getState().openCardId;
  const tile = !zoneEl && !open ? target?.closest("[data-card-id]") ?? null : null;
  const next: DropState = zoneEl
    ? { active: true, mode: "zone", cardId: null, zone: zoneEl.getAttribute("data-file-drop") }
    : open
      ? { active: true, mode: "card", cardId: open, zone: null }
      : tile
        ? { active: true, mode: "tile", cardId: tile.getAttribute("data-card-id"), zone: null }
        : { active: true, mode: "none", cardId: null, zone: null };
  highlight(tile);
  // Zones show their own highlight.
  document.querySelectorAll("[data-file-drop].drop-target").forEach((z) => z !== zoneEl && z.classList.remove("drop-target"));
  zoneEl?.classList.add("drop-target");
  const s = useDrop.getState();
  if (!s.active || s.mode !== next.mode || s.cardId !== next.cardId || s.zone !== next.zone) useDrop.setState(next);
  return next;
}

function clearZoneHighlight() {
  document.querySelectorAll("[data-file-drop].drop-target").forEach((z) => z.classList.remove("drop-target"));
}

/** Deliver dropped things to whatever is under the pointer. */
function deliver(state: DropState, files: File[], paths: string[], links: string[]) {
  // Board files open as boards (unless dropped onto a card, where they're just an attachment).
  if (!state.cardId) {
    const boardFiles = files.filter((f) => isBoardFile(f.name));
    const boardPaths = paths.filter(isBoardFile);
    if (boardFiles.length || boardPaths.length) {
      for (const f of boardFiles) void f.arrayBuffer().then((b) => openBoardFile(new Uint8Array(b)));
      for (const p of boardPaths) void openBoardFilePath(p);
      return;
    }
  }
  if (state.mode === "zone" && state.zone) zones.get(state.zone)?.({ files, paths });
  else if (state.cardId) {
    const payload = { files, paths, links };
    if (!dropIsEmpty(payload)) void attachToCard(state.cardId, payload);
  } else if (state.mode === "none" && (files.length || paths.length)) {
    useStore.getState().toast("Drop files onto a card (or open a card first).", { key: "drop-hint" });
  }
}

const isExternal = (e: DragEvent) => {
  const types = [...(e.dataTransfer?.types ?? [])];
  return types.includes("Files") || types.includes("text/uri-list");
};

export function installFileDropPolicy() {
  let leaveTimer: ReturnType<typeof setTimeout> | undefined;
  /** The page's own dragover told us where the pointer is (so the native position isn't needed). */
  let pageKnowsPointer = false;

  const onOver = (e: DragEvent) => {
    if (!isExternal(e)) return; // in-app drags (e.g. calendar chips) are left alone
    clearTimeout(leaveTimer);
    pageKnowsPointer = true;
    const st = update(e.target instanceof Element ? e.target : null);
    e.preventDefault();
    e.dataTransfer!.dropEffect = st.mode === "none" ? "none" : "copy";
  };

  const onDrop = (e: DragEvent) => {
    if (!isExternal(e)) return;
    e.preventDefault();
    e.stopPropagation(); // never let a text box or the page itself receive it
    const st = useDrop.getState();
    if (inTauri) return; // files arrive through the native drop event below
    reset();
    clearZoneHighlight();
    const d = readDrop(e.dataTransfer!);
    deliver(st, d.files, d.paths, d.links);
  };

  const onLeave = () => {
    clearTimeout(leaveTimer);
    leaveTimer = setTimeout(() => {
      reset();
      clearZoneHighlight();
      pageKnowsPointer = false;
    }, 120);
  };

  window.addEventListener("dragenter", onOver, true);
  window.addEventListener("dragover", onOver, true);
  window.addEventListener("drop", onDrop, true);
  window.addEventListener("dragleave", onLeave, true);

  let unlistenNative: (() => void) | undefined;
  let disposed = false;
  let lastDrop = { key: "", at: 0 };
  if (inTauri) {
    void import("@tauri-apps/api/webview").then(async ({ getCurrentWebview }) => {
      const un = await getCurrentWebview().onDragDropEvent((ev) => {
        const p = ev.payload;
        if (p.type === "leave") {
          onLeave();
          return;
        }
        if ((p.type === "enter" || p.type === "over") && !pageKnowsPointer) {
          // Windows: the page gets no dragover for files, so locate the pointer from the native event.
          clearTimeout(leaveTimer);
          const scale = isWindows ? window.devicePixelRatio : useStore.getState().data.settings.zoom || 1;
          update(document.elementFromPoint(p.position.x / scale, p.position.y / scale));
        }
        if (p.type === "drop") {
          // The same drop can be reported more than once; only handle it the first time.
          const key = p.paths.join("\n");
          if (key === lastDrop.key && Date.now() - lastDrop.at < 1500) return;
          lastDrop = { key, at: Date.now() };
          clearTimeout(leaveTimer);
          if (!pageKnowsPointer) {
            const scale = isWindows ? window.devicePixelRatio : useStore.getState().data.settings.zoom || 1;
            update(document.elementFromPoint(p.position.x / scale, p.position.y / scale));
          }
          const st = useDrop.getState();
          reset();
          clearZoneHighlight();
          pageKnowsPointer = false;
          // Web links dragged from a browser come through as "paths" too.
          const web = p.paths.filter((x) => /^https?:/i.test(x));
          deliver(st, [], p.paths.filter((x) => !web.includes(x)), web);
        }
      });
      // If we were torn down while the listener was being set up, remove it right away.
      if (disposed) un();
      else unlistenNative = un;
    });
  }

  return () => {
    window.removeEventListener("dragenter", onOver, true);
    window.removeEventListener("dragover", onOver, true);
    window.removeEventListener("drop", onDrop, true);
    window.removeEventListener("dragleave", onLeave, true);
    disposed = true;
    unlistenNative?.();
  };
}
