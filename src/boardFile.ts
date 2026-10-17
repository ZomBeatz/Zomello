import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import type { Board, Card, ID, List } from "./types";
import { inTauri, storeFile, storedSrc } from "./storage";
import { invoke } from "@tauri-apps/api/core";
import { uid } from "./utils";
import { useStore } from "./store";

/**
 * Board files (`.zomello`): one board with its buckets, cards and attached files, to hand to someone
 * else. It's a zip: `board.json` plus the files under `files/`. Opening one adds the board as a new
 * board (new ids), so the same file can be opened twice, or by several people, without clashes.
 */
export const BOARD_EXT = ".zomello";
const FORMAT = "zomello-board";
const VERSION = 1;

export interface BoardBundle {
  format: typeof FORMAT;
  version: number;
  exportedAt: number;
  board: Board;
  lists: List[];
  cards: Card[];
}

/** Every stored file a board uses: card attachments and an image background. */
function storedFiles(board: Board, cards: Card[]): string[] {
  const out = new Set<string>();
  for (const c of cards) for (const a of c.attachments) if (a.stored && a.url) out.add(a.url);
  if (board.background.type === "image" && board.background.value) out.add(board.background.value);
  return [...out];
}

/** Paths inside the zip: `files/<n>/<name>`, so two files with the same name never collide. */
const zipPath = (url: string, i: number) => `files/${i}/${(url.split("/").pop() || "file").replace(/^data:.*/, "file")}`;

export async function buildBoardFile(data: { boards: Record<ID, Board>; lists: Record<ID, List>; cards: Record<ID, Card> }, boardId: ID): Promise<{ bytes: Uint8Array; name: string; missing: number }> {
  const board = data.boards[boardId];
  const lists = Object.values(data.lists).filter((l) => l.boardId === boardId);
  const cards = Object.values(data.cards).filter((c) => c.boardId === boardId);
  const files: Record<string, Uint8Array> = {};
  const index: Record<string, string> = {};
  let missing = 0;
  for (const [i, url] of storedFiles(board, cards).entries()) {
    try {
      const res = await fetch(storedSrc(url));
      if (!res.ok) throw new Error(String(res.status));
      const path = zipPath(url, i);
      files[path] = new Uint8Array(await res.arrayBuffer());
      index[url] = path;
    } catch {
      missing++; // the board still exports; that attachment just won't come along
    }
  }
  // Calendar feed addresses can be private links, and server ownership means nothing elsewhere.
  const { ownerId: _o, members: _m, calendarFeeds: _f, ...cleanBoard } = board;
  const bundle = { format: FORMAT, version: VERSION, exportedAt: Date.now(), board: cleanBoard, lists, cards, files: index };
  const bytes = zipSync({ "board.json": strToU8(JSON.stringify(bundle)), ...files }, { level: 6 });
  const name = `${board.title.replace(/[\\/:*?"<>|]+/g, " ").trim() || "Board"}${BOARD_EXT}`;
  return { bytes, name, missing };
}

/** Save a board file: Downloads folder in the desktop app, a normal download in a browser. */
export async function saveBoardFile(bytes: Uint8Array, name: string): Promise<string> {
  if (inTauri) return invoke<string>("export_bytes", bytes, { headers: { "x-name": encodeURIComponent(name) } });
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/x-zomello" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return name;
}

const MIME: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml",
  pdf: "application/pdf", txt: "text/plain", md: "text/plain", mp4: "video/mp4", mp3: "audio/mpeg",
};
const mimeOf = (name: string) => MIME[name.split(".").pop()?.toLowerCase() ?? ""] ?? "application/octet-stream";

export const isBoardFile = (name: string) => name.toLowerCase().endsWith(BOARD_EXT);

export interface OpenedBoardFile {
  bundle: BoardBundle;
  files: Record<string, Uint8Array>;
  index: Record<string, string>;
}

export function readBoardFile(bytes: Uint8Array): OpenedBoardFile {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(bytes);
  } catch {
    throw new Error("This isn't a Zomello board file (or it's damaged).");
  }
  const json = entries["board.json"];
  if (!json) throw new Error("This isn't a Zomello board file: board.json is missing.");
  const raw = JSON.parse(strFromU8(json));
  if (raw?.format !== FORMAT || !raw.board) throw new Error("This isn't a Zomello board file.");
  if (raw.version > VERSION) throw new Error("This board was saved by a newer Zomello. Update Zomello to open it.");
  const { files: index = {}, ...bundle } = raw;
  return { bundle: bundle as BoardBundle, files: entries, index };
}

/**
 * Turn an opened file into new boards/lists/cards with fresh ids, copying its files into this
 * Zomello's storage. Links and sub-tasks between its cards are kept; links to anything else are dropped.
 */
export async function prepareImport(opened: OpenedBoardFile, order: number): Promise<{ board: Board; lists: List[]; cards: Card[]; people: string[] }> {
  const { bundle, files, index } = opened;
  const newUrl = new Map<string, string>();
  for (const [oldUrl, path] of Object.entries(index)) {
    const bytes = files[path];
    if (!bytes) continue;
    const name = path.split("/").pop() || "file";
    newUrl.set(oldUrl, await storeFile(new File([bytes as BlobPart], name, { type: mimeOf(name) })));
  }
  const now = Date.now();
  const boardId = uid();
  const listMap = new Map(bundle.lists.map((l) => [l.id, uid()]));
  const cardMap = new Map(bundle.cards.filter((c) => listMap.has(c.listId)).map((c) => [c.id, uid()]));
  const bg = bundle.board.background;
  const board: Board = {
    ...bundle.board,
    id: boardId,
    order,
    starred: false,
    archived: false,
    createdAt: now,
    calendarFeeds: [],
    background: bg.type === "image" ? (newUrl.has(bg.value) ? { type: "image", value: newUrl.get(bg.value)! } : { type: "none" }) : bg,
  };
  const lists = bundle.lists.map((l) => ({ ...l, id: listMap.get(l.id)!, boardId }));
  const cards = bundle.cards
    .filter((c) => cardMap.has(c.id))
    .map((c) => {
      const attachments = c.attachments.flatMap((a) => (!a.stored ? [a] : newUrl.has(a.url) ? [{ ...a, url: newUrl.get(a.url)! }] : []));
      return {
        ...c,
        id: cardMap.get(c.id)!,
        boardId,
        listId: listMap.get(c.listId)!,
        attachments,
        coverImage: attachments.some((a) => a.id === c.coverImage) ? c.coverImage : null,
        checklist: c.checklist.map((i) => ({ ...i, id: uid(), cardId: i.cardId ? (cardMap.get(i.cardId) ?? null) : i.cardId })),
        links: c.links.filter((l) => cardMap.has(l.cardId)).map((l) => ({ ...l, cardId: cardMap.get(l.cardId)! })),
        time: c.time.filter((t) => t.end !== null),
        reminder: null,
      };
    });
  const people = [...new Set(cards.flatMap((c) => c.assignees))];
  return { board, lists, cards, people };
}

// ---- What the app calls ----

/** Board menu → "Save as board file…". */
export async function exportBoard(boardId: ID): Promise<void> {
  const st = useStore.getState();
  const title = st.data.boards[boardId]?.title ?? "Board";
  st.toast(`Saving “${title}”…`, { key: "board-file" });
  try {
    const { bytes, name, missing } = await buildBoardFile(st.data, boardId);
    const where = await saveBoardFile(bytes, name);
    const extra = missing ? ` (${missing} attached ${missing === 1 ? "file" : "files"} couldn't be included)` : "";
    st.toast(inTauri ? `Saved ${where}${extra}. Send it to anyone with Zomello; opening it adds the board.` : `Downloaded ${name}${extra}`, {
      key: "board-file",
      ...(inTauri ? { action: { label: "Show", run: () => void revealPath(where) } } : {}),
    });
  } catch (e) {
    st.toast(`Couldn't save the board: ${e instanceof Error ? e.message : e}`, { key: "board-file" });
  }
}

async function revealPath(path: string) {
  const { revealItemInDir } = await import("@tauri-apps/plugin-opener");
  await revealItemInDir(path);
}

/** Open a .zomello file: it becomes a new board, opened right away. */
export async function openBoardFile(bytes: Uint8Array): Promise<void> {
  const st = useStore.getState();
  try {
    const opened = readBoardFile(bytes);
    const order = Math.max(-1, ...Object.values(st.data.boards).map((b) => b.order)) + 1;
    const prepared = await prepareImport(opened, order);
    useStore.getState().addBoardBundle(prepared);
    useStore.getState().navigate({ page: "board", boardId: prepared.board.id });
    useStore.getState().toast(`Added “${prepared.board.title}” (${prepared.cards.length} ${prepared.cards.length === 1 ? "card" : "cards"})`, { undo: true });
  } catch (e) {
    st.toast(e instanceof Error ? e.message : String(e));
  }
}

/** A board file opened from the file manager (double-click / "Open with Zomello") or dropped on the window. */
export async function openBoardFilePath(path: string): Promise<void> {
  const buf = await invoke<ArrayBuffer>("read_dropped_file", { path });
  await openBoardFile(new Uint8Array(buf));
}

/**
 * Desktop app: open board files the system handed us (double-click, "Open with", a second launch
 * with a file). Waits until the boards are loaded so the new board lands in the right place.
 */
export function installOpenedFiles(): () => void {
  if (!inTauri) return () => {};
  let off: (() => void) | undefined;
  let stopped = false;
  const take = async () => {
    for (const p of await invoke<string[]>("take_opened_files").catch(() => [] as string[])) await openBoardFilePath(p);
  };
  void import("@tauri-apps/api/event").then(async ({ listen }) => {
    const un = await listen("zomello://open-files", () => void take());
    if (stopped) un();
    else off = un;
  });
  void take();
  return () => {
    stopped = true;
    off?.();
  };
}
