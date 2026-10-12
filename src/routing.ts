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

const PAGES = new Set(["home", "mytasks", "archive", "settings"]);

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

/** Start mirroring the app's place into the address bar (call once data has loaded). */
export function installHistorySync(): () => void {
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
  if (now.openCardId) history.pushState({ zomello: true, card: true }, "", toHash(now.route, now.openCardId));

  const unsub = useStore.subscribe((s, prev) => {
    if (applying || (s.route === prev.route && s.openCardId === prev.openCardId)) return;
    const hash = toHash(s.route, s.openCardId);
    if (hash === location.hash) return;
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
    window.removeEventListener("popstate", onPop);
  };
}
