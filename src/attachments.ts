import { useStore } from "./store";
import { debugLog, fileUrlToPath, inTauri, storeFile, storeFromPath } from "./storage";
import type { Attachment, ID } from "./types";
import { isImage, uid } from "./utils";

/** What a drag from outside the app can carry. */
export interface DropPayload {
  files: File[];
  /** Local paths (from file:// URIs — how Linux file managers hand over files). */
  paths: string[];
  /** Web links (dragged from a browser). */
  links: string[];
}

export function readDrop(dt: DataTransfer): DropPayload {
  const files = Array.from(dt.files ?? []);
  const uris = (dt.getData("text/uri-list") || "")
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter((s) => s && !s.startsWith("#"));
  const plain = dt.getData("text/plain").trim();
  if (!uris.length && /^(https?|file):\/\//i.test(plain)) uris.push(plain);
  const paths = uris.filter((u) => /^file:/i.test(u)).map(fileUrlToPath);
  const links = uris.filter((u) => /^https?:/i.test(u));
  // In the desktop app, copying by path (done natively) is the most reliable route — WebKitGTK can
  // hand over File objects for desktop drags that can't actually be read. Otherwise use the Files.
  if (inTauri && paths.length) return { files: [], paths, links };
  return { files, paths: files.length ? [] : paths, links: files.length ? [] : links };
}

export const dropIsEmpty = (p: DropPayload) => !p.files.length && !p.paths.length && !p.links.length;

/** Copy dropped / picked files into storage and attach them (and any links) to a card. */
export async function attachToCard(cardId: ID, p: DropPayload): Promise<number> {
  const st = useStore.getState();
  const added: Attachment[] = [];
  const fail = (name: string, e: unknown) => {
    debugLog("attach failed", name, String(e));
    st.toast(`Couldn't attach ${name}: ${e}`);
  };
  debugLog("attachToCard", cardId, { files: p.files.map((f) => [f.name, f.size, f.type]), paths: p.paths, links: p.links });
  for (const f of p.files) {
    try {
      added.push({ id: uid(), name: f.name, url: await storeFile(f), addedAt: Date.now(), stored: true, size: f.size, mime: f.type });
    } catch (e) {
      fail(f.name, e);
    }
  }
  for (const path of p.paths) {
    const name = path.split(/[\\/]/).pop() || path;
    if (!inTauri) {
      // Browser dev mode can't read local paths; keep it as a link.
      added.push({ id: uid(), name, url: path, addedAt: Date.now() });
      continue;
    }
    try {
      const s = await storeFromPath(path);
      added.push({ id: uid(), name: s.name, url: s.rel, addedAt: Date.now(), stored: true, size: s.size });
    } catch (e) {
      fail(name, e);
    }
  }
  for (const url of p.links) {
    let name = url;
    try {
      const u = new URL(url);
      name = decodeURIComponent(u.pathname.split("/").filter(Boolean).pop() || u.hostname);
    } catch {
      /* keep the raw url */
    }
    added.push({ id: uid(), name, url, addedAt: Date.now() });
  }
  if (!added.length) return 0;
  const cur = useStore.getState().data.cards[cardId];
  if (!cur) return 0;
  const firstImage = added.find((a) => a.stored && isImage(a.name, a.mime));
  st.updateCard(cardId, {
    attachments: [...cur.attachments, ...added],
    // First image becomes the cover if the card has none yet.
    ...(firstImage && !cur.coverImage && !cur.cover ? { coverImage: firstImage.id } : {}),
  });
  st.toast(`Attached ${added.length} ${added.length === 1 ? "item" : "items"} to “${cur.title}”`, { undo: true, key: "attach" });
  return added.length;
}

/** Turn a link attachment that points at a local file into a stored copy (gets previews, survives moves). */
export async function storeLinkedFile(cardId: ID, attachmentId: ID) {
  const st = useStore.getState();
  const card = st.data.cards[cardId];
  const a = card?.attachments.find((x) => x.id === attachmentId);
  if (!a || a.stored) return;
  try {
    const s = await storeFromPath(/^file:/i.test(a.url) ? fileUrlToPath(a.url) : a.url);
    st.updateCard(cardId, {
      attachments: card.attachments.map((x) => (x.id === a.id ? { ...x, name: s.name, url: s.rel, stored: true, size: s.size } : x)),
    });
  } catch (e) {
    st.toast(`Couldn't copy it in: ${e}`);
  }
}

/** A link attachment that points at a file on this computer (not a web link). */
export const isLocalPath = (url: string) => /^file:/i.test(url) || /^(\/|[A-Za-z]:[\\/]|~\/)/.test(url);
