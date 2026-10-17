import { isMobileApp } from "./storage";
import { useStore } from "./store";
import type { ID, Route } from "./types";

/**
 * The address bar follows where you are: #/home, #/board/<id>, #/board/<id>/card/<cardId>, …
 *  - Refreshing (or a phone reconnecting) brings you back to the same page and card.
 *  - The back button (Android's included) closes an open card first, then steps back through pages,
 *    instead of leaving the app.
 */

export function toHash(route: Route, cardId: ID | null): string {
  const base = route.page === "board" ? `#/board/${route.boardId}` : `#/${route.page}`;
  return cardId ? `${base}/card/${cardId}` : base;
}

const PAGES = new Set(["home", "mytasks", "archive", "settings", "admin"]);

/** What a hash points at, if it's one of ours and still exists. */
export function fromHash(hash: string): { route: Route; cardId: ID | null } | null {
  const m = hash.match(/^#\/(board\/([^/]+)|[a-z]+)(?:\/card\/([^/]+))?$/);
  if (!m) return null;
  const { data } = useStore.getState();
  const cardId = m[3] && data.cards[m[3]] ? m[3] : null;
  if (m[2]) return data.boards[m[2]] ? { route: { page: "board", boardId: m[2] }, cardId } : null;
  return PAGES.has(m[1]) ? { route: { page: m[1] } as Route, cardId } : null;
}

const sameRoute = (a: Route, b: Route) =>
  a.page === b.page && (a.page !== "board" || (b.page === "board" && a.boardId === b.boardId));

/** Running as an installed app (Android's "Install app", iOS home screen) rather than a browser tab. */
const isInstalledApp = () =>
  window.matchMedia("(display-mode: standalone)").matches ||
  window.matchMedia("(display-mode: fullscreen)").matches ||
  (navigator as { standalone?: boolean }).standalone === true;

interface CloseWatcherLike {
  onclose: (() => void) | null;
  destroy(): void;
}
type CloseWatcherCtor = new () => CloseWatcherLike;

/**
 * Installed apps: Android's Back button exits instead of using the page's history, but it does tell
 * a "close watcher" first. While there's something to go back from (a window, a card, a page other than
 * Home) we keep one watching, and Back steps back one thing at a time, inside the app.
 * The Android app (Tauri) reports Back as its own event instead; the same steps apply, and Back on
 * Home closes the app.
 */
function installBackButton(): () => void {
  const Ctor = (window as unknown as { CloseWatcher?: CloseWatcherCtor }).CloseWatcher;
  if (!Ctor && !isMobileApp) return () => {};
  const trail: Route[] = [];
  let watcher: CloseWatcherLike | null = null;
  let backing = false;

  const modalOpen = () => !!document.querySelector(".modal-backdrop, .ctx-menu, .popover, .nav-backdrop");
  const needed = () => {
    const s = useStore.getState();
    return modalOpen() || !!s.openCardId || s.route.page !== "home";
  };
  // On a computer, Esc already closes windows and cards itself, and also fires the close watcher:
  // don't step back a second time for the same key press.
  let lastEsc = 0;
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape" && e.isTrusted) lastEsc = Date.now();
  };
  window.addEventListener("keydown", onKey, true);
  const back = () => {
    if (Date.now() - lastEsc < 300) return;
    const s = useStore.getState();
    backing = true;
    try {
      if (modalOpen()) {
        // Windows, menus and the phone drawer all close on Esc.
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
        document.querySelector<HTMLElement>(".nav-backdrop")?.click();
      } else if (s.openCardId) s.openCard(null);
      else s.navigate(trail.pop() ?? { page: "home" });
    } finally {
      backing = false;
    }
  };
  // The Android app: every Back press comes here; nothing left to close means leave the app.
  let tauriBack: { unregister: () => Promise<void> } | null = null;
  let stopped = false;
  if (isMobileApp) {
    void import("@tauri-apps/api/app").then(async ({ onBackButtonPress, exit }) => {
      const l = await onBackButtonPress(() => {
        if (needed()) back();
        else void exit(0);
      });
      if (stopped) void l.unregister();
      else tauriBack = l;
    });
  }
  const sync = () => {
    if (isMobileApp || !Ctor) return;
    if (needed() && !watcher) {
      try {
        const w = new Ctor();
        w.onclose = () => {
          watcher = null;
          back();
          setTimeout(sync, 0);
        };
        watcher = w;
      } catch {
        /* too many without a tap in between; the next tap re-arms it */
      }
    } else if (!needed() && watcher) {
      watcher.destroy();
      watcher = null;
    }
  };

  const unsub = useStore.subscribe((s, prev) => {
    if (s.route !== prev.route && !backing && !sameRoute(s.route, prev.route)) trail.push(prev.route);
    if (trail.length > 50) trail.shift();
    sync();
  });
  // Windows and menus come and go outside the store; taps also re-arm the watcher.
  let queued = false;
  const mo = new MutationObserver(() => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      sync();
    });
  });
  mo.observe(document.body, { childList: true, subtree: true });
  const onTap = () => sync();
  window.addEventListener("pointerdown", onTap, true);
  sync();
  return () => {
    unsub();
    mo.disconnect();
    window.removeEventListener("pointerdown", onTap, true);
    window.removeEventListener("keydown", onKey, true);
    watcher?.destroy();
    stopped = true;
    void tauriBack?.unregister();
  };
}

/** Start mirroring the app's place into the address bar (call once data has loaded). */
export function installHistorySync(): () => void {
  // In an installed app only the address is kept up to date (for reopening where you were); Back is
  // handled by installBackButton, not by history steps.
  const installed = isInstalledApp() || isMobileApp;
  const stopBack = installed ? installBackButton() : () => {};
  let applying = false;
  const st = useStore.getState();

  // Opened with an address (a refresh, a bookmark): go there.
  const start = fromHash(location.hash);
  if (start) {
    applying = true;
    if (!sameRoute(start.route, st.route)) st.navigate(start.route);
    if (start.cardId) useStore.getState().openCard(start.cardId);
    applying = false;
  }
  // Keep the page underneath an open card as its own step, so Back closes the card and stays in the app.
  const now = useStore.getState();
  history.replaceState({ zomello: true, card: false }, "", toHash(now.route, null));
  if (now.openCardId) {
    if (installed) history.replaceState({ zomello: true }, "", toHash(now.route, now.openCardId));
    else history.pushState({ zomello: true, card: true }, "", toHash(now.route, now.openCardId));
  }

  const unsub = useStore.subscribe((s, prev) => {
    if (applying || (s.route === prev.route && s.openCardId === prev.openCardId)) return;
    const hash = toHash(s.route, s.openCardId);
    if (hash === location.hash) return;
    if (installed) return void history.replaceState({ zomello: true }, "", hash);
    const opened = s.openCardId && !prev.openCardId && sameRoute(s.route, prev.route);
    const closed = !s.openCardId && prev.openCardId && sameRoute(s.route, prev.route);
    if (opened) history.pushState({ zomello: true, card: true }, "", hash);
    else if (closed && history.state?.card) history.back(); // so Back doesn't reopen it
    else if (s.openCardId && prev.openCardId) history.replaceState({ zomello: true, card: true }, "", hash); // card → linked card
    else history.pushState({ zomello: true, card: !!s.openCardId }, "", hash);
  });

  const onPop = () => {
    const target = fromHash(location.hash);
    const cur = useStore.getState();
    applying = true;
    try {
      if (!target) return;
      if (!sameRoute(target.route, cur.route)) cur.navigate(target.route);
      const want = target.cardId;
      if ((useStore.getState().openCardId ?? null) !== want) useStore.getState().openCard(want);
    } finally {
      applying = false;
    }
  };
  window.addEventListener("popstate", onPop);
  return () => {
    unsub();
    stopBack();
    window.removeEventListener("popstate", onPop);
  };
}
