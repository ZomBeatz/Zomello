/**
 * App-wide file drag & drop policy:
 *  - while a card is open, dropping files anywhere attaches them to that card;
 *  - elements marked `data-file-drop` (e.g. the board background picker) handle their own drops;
 *  - everywhere else, file drops are refused (the webview would otherwise try to open the file).
 */
type Handler = (files: FileList) => void;
let cardHandler: Handler | null = null;

/** The open card registers itself; returns an unregister function. */
export function setCardDropHandler(h: Handler) {
  cardHandler = h;
  return () => {
    if (cardHandler === h) cardHandler = null;
  };
}

const hasFiles = (e: DragEvent) => !!e.dataTransfer && [...e.dataTransfer.types].includes("Files");
const ownZone = (e: DragEvent) => e.target instanceof Element && !!e.target.closest("[data-file-drop]");
const setMode = (m: "card" | null) => {
  if (m) document.body.dataset.filedrag = m;
  else delete document.body.dataset.filedrag;
};

export function installFileDropPolicy() {
  const onOver = (e: DragEvent) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    if (ownZone(e)) return setMode(null);
    e.dataTransfer!.dropEffect = cardHandler ? "copy" : "none";
    setMode(cardHandler ? "card" : null);
  };
  const onDrop = (e: DragEvent) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    setMode(null);
    if (ownZone(e)) return; // the zone's own onDrop already ran
    if (cardHandler && e.dataTransfer?.files.length) cardHandler(e.dataTransfer.files);
  };
  const onLeave = (e: DragEvent) => {
    if (!e.relatedTarget) setMode(null); // left the window
  };
  window.addEventListener("dragover", onOver);
  window.addEventListener("drop", onDrop);
  window.addEventListener("dragleave", onLeave);
  window.addEventListener("dragend", () => setMode(null));
  return () => {
    window.removeEventListener("dragover", onOver);
    window.removeEventListener("drop", onDrop);
    window.removeEventListener("dragleave", onLeave);
  };
}
