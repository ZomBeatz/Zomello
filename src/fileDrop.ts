import { create } from "zustand";
import { useStore } from "./store";
import { attachToCard, dropIsEmpty, readDrop } from "./attachments";
import type { ID } from "./types";

/**
 * App-wide handling of things dragged in from outside (files, file paths, web links):
 *  - a card is open           → drop anywhere attaches to that card;
 *  - hovering a card tile      → drop attaches to that card;
 *  - over a `data-file-drop` zone (board background picker, import dialog) → the zone handles it;
 *  - anywhere else            → refused, with a hint.
 * Listeners run in the capture phase so text boxes never receive a dropped file as text, and the
 * webview never navigates to the file.
 */
export type DropMode = "card" | "tile" | "zone" | "none";

export const useDrop = create<{ active: boolean; mode: DropMode; cardId: ID | null }>(() => ({
  active: false,
  mode: "none",
  cardId: null,
}));

const isExternal = (e: DragEvent) => {
  const types = [...(e.dataTransfer?.types ?? [])];
  return types.includes("Files") || types.includes("text/uri-list");
};

let highlighted: Element | null = null;
const highlight = (el: Element | null) => {
  if (highlighted === el) return;
  highlighted?.classList.remove("file-drop-target");
  el?.classList.add("file-drop-target");
  highlighted = el;
};

function reset() {
  highlight(null);
  useDrop.setState({ active: false, mode: "none", cardId: null });
}

function modeFor(e: DragEvent): { mode: DropMode; cardId: ID | null; tile: Element | null } {
  const t = e.target instanceof Element ? e.target : null;
  if (t?.closest("[data-file-drop]")) return { mode: "zone", cardId: null, tile: null };
  const open = useStore.getState().openCardId;
  if (open) return { mode: "card", cardId: open, tile: null };
  const tile = t?.closest("[data-card-id]") ?? null;
  if (tile) return { mode: "tile", cardId: tile.getAttribute("data-card-id"), tile };
  return { mode: "none", cardId: null, tile: null };
}

export function installFileDropPolicy() {
  let leaveTimer: ReturnType<typeof setTimeout> | undefined;

  const onOver = (e: DragEvent) => {
    if (!isExternal(e)) return; // in-app drags (e.g. calendar chips) are left alone
    clearTimeout(leaveTimer);
    const { mode, cardId, tile } = modeFor(e);
    highlight(tile);
    const s = useDrop.getState();
    if (!s.active || s.mode !== mode || s.cardId !== cardId) useDrop.setState({ active: true, mode, cardId });
    if (mode === "zone") return; // the zone's own handlers accept it
    e.preventDefault();
    e.dataTransfer!.dropEffect = mode === "none" ? "none" : "copy";
  };

  const onDrop = (e: DragEvent) => {
    if (!isExternal(e)) return;
    const { mode, cardId } = modeFor(e);
    reset();
    if (mode === "zone") return;
    e.preventDefault();
    e.stopPropagation(); // never let an input or the page itself receive it
    if (!cardId || !e.dataTransfer) return;
    const payload = readDrop(e.dataTransfer);
    if (!dropIsEmpty(payload)) void attachToCard(cardId, payload);
  };

  // dragleave fires constantly while moving between elements; only reset when nothing follows.
  const onLeave = () => {
    clearTimeout(leaveTimer);
    leaveTimer = setTimeout(reset, 80);
  };

  window.addEventListener("dragenter", onOver, true);
  window.addEventListener("dragover", onOver, true);
  window.addEventListener("drop", onDrop, true);
  window.addEventListener("dragleave", onLeave, true);
  window.addEventListener("dragend", reset, true);
  return () => {
    window.removeEventListener("dragenter", onOver, true);
    window.removeEventListener("dragover", onOver, true);
    window.removeEventListener("drop", onDrop, true);
    window.removeEventListener("dragleave", onLeave, true);
    window.removeEventListener("dragend", reset, true);
  };
}
