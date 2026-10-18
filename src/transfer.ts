import { buildBoardFile, openBoardFile } from "./boardFile";
import { call, savePlaceList, type PlaceInfo } from "./placeLists";
import { ensureLocalNetwork, goToPhone, goToPlace, LOCAL_NETWORK_HELP, reachable, sendParams, takeSendRequest } from "./places";
import { ownsBoard } from "./server";
import { isMobileApp } from "./storage";
import { saveNow, useStore } from "./store";
import type { ID } from "./types";

/**
 * Phones and tablets: moving (or copying) a board from one place to another, say from your computer to
 * this phone. The page it's on packs it as a board file (attached files included) and leaves it in the
 * app; the app then opens the other place, whose page unpacks it. Nothing travels anywhere else.
 */

/** Where a board on this page can go: "phone" (from a computer's or server's page) or another place. */
export function destinations(me: string, list: PlaceInfo[]): { key: string; name: string }[] {
  const phone = { key: "phone", name: "This phone" };
  // A computer's or server's page can only send boards back to the phone; the phone can send anywhere.
  if (!isMobileApp) return me === "phone" ? [] : [phone];
  return list.filter((p) => p.origin !== me).map((p) => ({ key: p.origin, name: p.kind === "computer" ? "Computer" : p.name }));
}

export async function sendBoard(boardId: ID, to: { key: string; name: string }, move: boolean): Promise<void> {
  const st = useStore.getState();
  const board = st.data.boards[boardId];
  if (!board) return st.toast("That board isn't here anymore.");
  // On a shared server only the owner can take a board away; everyone else sends a copy.
  if (move && !ownsBoard(board)) move = false;
  const key = "send-board";
  st.toast(`${move ? "Moving" : "Copying"} “${board.title}” to ${to.name}…`, { key });
  try {
    if (to.key !== "phone") {
      if (!(await ensureLocalNetwork())) throw new Error(LOCAL_NETWORK_HELP);
      if (!(await reachable(to.key))) throw new Error(`${to.name} can't be reached right now. Check that it's on and on the same Wi‑Fi, then try again.`);
    }
    const { bytes, missing } = await buildBoardFile(st.data, boardId);
    if (missing && move) throw new Error(`${missing === 1 ? "An attached file" : `${missing} attached files`} couldn't be read, so “${board.title}” wasn't moved. Copy it instead, or remove ${missing === 1 ? "that file" : "those files"} first.`);
    await call("places_send_board", bytes, { headers: { "x-to": to.key } });
    if (move) {
      useStore.getState().deleteBoard(boardId);
      await saveNow();
      await savePlaceList();
    }
    if (to.key === "phone") goToPhone();
    else await goToPlace(to.key);
  } catch (e) {
    useStore.getState().toast(`Couldn't ${move ? "move" : "copy"} “${board.title}”: ${e instanceof Error ? e.message : e}`, { key });
  }
}

/** A board from another place's part of the menu: open that place, which sends it on to `to`. */
export async function relaySend(from: string, boardId: ID, to: string, move: boolean): Promise<void> {
  try {
    if (from === "phone") goToPhone(undefined, sendParams(boardId, to, move));
    else await goToPlace(from, null, undefined, sendParams(boardId, to, move));
  } catch (e) {
    useStore.getState().toast(String(e instanceof Error ? e.message : e));
  }
}

/** Opened with "send this board to …" (see relaySend): do it. */
export async function handleSendRequest(): Promise<void> {
  const req = takeSendRequest();
  if (!req) return;
  const places = await call<{ me?: string; list: PlaceInfo[] }>("places_read").catch(() => null);
  const name = req.to === "phone" ? "This phone" : (places?.list.find((p) => p.origin === req.to)?.name ?? req.to);
  const kind = places?.list.find((p) => p.origin === req.to)?.kind;
  await sendBoard(req.boardId, { key: req.to, name: kind === "computer" ? "Computer" : name }, req.move);
}

/** The phone app's own page: boards your computer sends arrive while it's open. */
export function installBoardArrivals(): () => void {
  if (!isMobileApp) return () => {};
  let un: (() => void) | undefined;
  let gone = false;
  void import("@tauri-apps/api/event").then(async ({ listen }) => {
    const u = await listen("zomello://boards-arrived", () => void takeBoards());
    if (gone) u();
    else un = u;
  });
  return () => {
    gone = true;
    un?.();
  };
}

/** On arriving at a place: add the boards that were sent here (the last one opens). */
export async function takeBoards(): Promise<void> {
  for (let i = 0; i < 20; i++) {
    let bytes: Uint8Array;
    try {
      const raw = await call<ArrayBuffer | number[]>("places_take_board");
      bytes = raw instanceof ArrayBuffer ? new Uint8Array(raw) : new Uint8Array(raw ?? []);
    } catch {
      return; // not in the app, or this page can't take boards
    }
    if (bytes.length === 0) return;
    await openBoardFile(bytes, "Moved here:");
  }
}
