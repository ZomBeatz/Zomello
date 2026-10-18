import { inTauri, isMobileApp } from "./storage";
import { isRemote, remoteSubscribe } from "./remote";
import type { ID } from "./types";

/**
 * Multiple windows: the main window plus optional per-board windows (`index.html?board=<id>`).
 * Every window has its own copy of the data; after a window saves it broadcasts the new data and the
 * others adopt it, so they never overwrite each other with stale copies.
 */
const params = new URLSearchParams(location.search);
/** Set when this window was opened for one board. */
export const windowBoardId: ID | null = params.get("board");
export const isBoardWindow = !!windowBoardId;
/** Set in the window showing a phone's boards on this computer (`index.html?device=<id>`). */
export const windowDeviceId: string | null = params.get("device");
export const isDeviceWindow = !!windowDeviceId;
/** Any window but the main one (no tray, reminders, welcome guide…). */
export const isExtraWindow = isBoardWindow || isDeviceWindow;

const SYNC_EVENT = "zomello://data-changed";
const LS_SYNC_KEY = "zomello-data"; // browser dev: the data itself lives here, so `storage` events carry it

let myLabel = "main";
if (inTauri)
  void import("@tauri-apps/api/webviewWindow").then(({ getCurrentWebviewWindow }) => {
    myLabel = getCurrentWebviewWindow().label;
  });

export async function openBoardWindow(boardId: ID, title: string) {
  // Phones and tablets have one window, and a phone's window on this computer shows only its boards:
  // just go to the board.
  if (isMobileApp || isDeviceWindow) return (await import("./store")).useStore.getState().navigate({ page: "board", boardId });
  if (inTauri) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke("open_board_window", { boardId, title });
  }
  window.open(`${location.pathname}?board=${boardId}`, `board-${boardId}`, "width=1200,height=820");
}

/** Tell the other windows the data changed (call after a successful save). */
export async function broadcastData(json: string) {
  if (!inTauri) return; // devices: the PC passes saves on; browser dev: the localStorage write itself fires `storage` in other tabs
  const { emit } = await import("@tauri-apps/api/event");
  await emit(SYNC_EVENT, { from: myLabel, json });
}

/** Run `onData` whenever another window saves. Returns an unsubscribe function. */
export function onOtherWindowData(onData: (json: string) => void): () => void {
  // Another device's boards (through the computer) come from that device, not the computer's data.
  if (isRemote && isDeviceWindow) return () => {};
  if (isRemote) return remoteSubscribe(onData);
  if (!inTauri) {
    const h = (e: StorageEvent) => e.key === LS_SYNC_KEY && e.newValue && onData(e.newValue);
    window.addEventListener("storage", h);
    return () => window.removeEventListener("storage", h);
  }
  let un: (() => void) | undefined;
  let gone = false;
  void import("@tauri-apps/api/event").then(async ({ listen }) => {
    const u = await listen<{ from: string; json: string }>(SYNC_EVENT, (e) => {
      if (e.payload.from !== myLabel) onData(e.payload.json);
    });
    if (gone) u();
    else un = u;
  });
  return () => {
    gone = true;
    un?.();
  };
}

export async function setWindowTitle(title: string) {
  document.title = title;
  if (!inTauri) return;
  const { getCurrentWebviewWindow } = await import("@tauri-apps/api/webviewWindow");
  await getCurrentWebviewWindow().setTitle(title).catch(() => {});
}
