/**
 * Android: text or a link shared to Zomello from another app (the share sheet's "Add to Zomello") opens
 * Quick add with it filled in. MainActivity keeps it until this page takes it.
 */
export function installShareIn(): () => void {
  const android = (window as unknown as { ZomelloAndroid?: { takeShared?(): string | null } }).ZomelloAndroid;
  if (!android?.takeShared) return installAppleShareIn();
  const take = () => {
    let shared: { text?: string; subject?: string } | null = null;
    try {
      shared = JSON.parse(android.takeShared!() ?? "null");
    } catch {
      return;
    }
    const text = shared?.text?.trim();
    if (!text) return;
    const task = sharedTask(text, shared?.subject?.trim() ?? "");
    void import("./store").then(({ useStore }) => useStore.getState().setOverlay({ quickAddOpen: true, quickAddPrefill: task }));
  };
  take();
  window.addEventListener("zomello-shared", take);
  return () => window.removeEventListener("zomello-shared", take);
}

/** A title and description from shared text: a page's title and its link, or the first line and the rest. */
export function sharedTask(text: string, subject: string): { title: string; description: string } {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const onlyLink = lines.length === 1 && /^https?:\/\/\S+$/i.test(lines[0]);
  if (subject) return { title: subject.slice(0, 200), description: text };
  if (onlyLink) {
    // No title came with it: name it after the site.
    const host = lines[0].replace(/^https?:\/\/(www\.)?/i, "").split(/[/?#]/)[0];
    return { title: `Look at ${host}`, description: lines[0] };
  }
  const first = lines[0].length > 120 ? `${lines[0].slice(0, 117)}…` : lines[0];
  return { title: first, description: lines.length > 1 || lines[0].length > 120 ? text : "" };
}

/**
 * iPhone and iPad: "Add to Zomello" (the share extension) leaves what was shared in the app group; take it
 * when Zomello opens or comes back. The first one opens Quick add; more go straight onto the first board.
 */
function installAppleShareIn(): () => void {
  const apple = typeof navigator !== "undefined" && (/iPhone|iPad/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1));
  if (!apple || !("__TAURI_INTERNALS__" in window)) return () => {};
  const take = async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    const items = (await invoke<string[]>("share_inbox_take").catch(() => [] as string[]))
      .map((s) => {
        try {
          return JSON.parse(s) as { text?: string; subject?: string };
        } catch {
          return null;
        }
      })
      .filter((x): x is { text?: string; subject?: string } => !!x?.text?.trim());
    if (!items.length) return;
    const { useStore } = await import("./store");
    const [first, ...rest] = items.map((i) => sharedTask(i.text!.trim(), i.subject?.trim() ?? ""));
    const st = useStore.getState();
    if (rest.length) {
      const board = Object.values(st.data.boards).filter((b) => !b.archived).sort((a, b) => a.order - b.order)[0];
      const list = board && Object.values(st.data.lists).filter((l) => l.boardId === board.id && !l.archived).sort((a, b) => a.order - b.order)[0];
      if (list) {
        for (const t of rest) st.createCard(list.id, t.title, { description: t.description });
        st.toast(`Added ${rest.length} more shared ${rest.length === 1 ? "item" : "items"} to “${board.title}”`);
      }
    }
    st.setOverlay({ quickAddOpen: true, quickAddPrefill: first });
  };
  void take();
  const onVisible = () => document.visibilityState === "visible" && void take();
  document.addEventListener("visibilitychange", onVisible);
  return () => document.removeEventListener("visibilitychange", onVisible);
}
