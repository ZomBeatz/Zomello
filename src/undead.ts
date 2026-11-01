import type { Card, ID } from "./types";
import { useStore } from "./store";

/**
 * Easter egg #3: make (or rename) a card "Braaains", with as many a's as you like, and the Undead style
 * rises. On October 31 the empty My Day drops a hint.
 */
export const isBraaains = (title: string) => /^\s*bra{3,}i+n+s*[!.]*\s*$/i.test(title);

export const isHalloween = (d = new Date()) => d.getMonth() === 9 && d.getDate() === 31;

const reduceMotion = () =>
  document.documentElement.hasAttribute("data-reducemotion") || window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Watch for a card that has just become "Braaains" (only fresh changes, so loading or syncing old cards doesn't count). */
export function watchForBraaains(): () => void {
  return useStore.subscribe((s, prev) => {
    if (s.data.cards === prev.data.cards) return;
    const now = Date.now();
    for (const c of Object.values(s.data.cards) as Card[]) {
      const before = prev.data.cards[c.id];
      if (before?.title === c.title || !isBraaains(c.title) || now - c.updatedAt > 5000) continue;
      rise(c.id);
      return;
    }
  });
}

function rise(cardId: ID) {
  const st = useStore.getState();
  const s = st.data.settings;
  const first = !s.unlockedStyles.includes("undead");
  if (!first && s.style === "undead") return;
  st.updateSettings({ style: "undead", unlockedStyles: first ? [...s.unlockedStyles, "undead"] : s.unlockedStyles });
  st.toast(first ? "🧟 You found Undead! Switch styles any time in Settings → Appearance." : "🧟 Undead on", { key: "style" });
  if (reduceMotion()) return;
  // A bat flies past the moon...
  requestAnimationFrame(() =>
    document.querySelectorAll<HTMLElement>(".wordmark").forEach((el) => {
      el.classList.add("bat-once");
      setTimeout(() => el.classList.remove("bat-once"), 2600);
    }),
  );
  // ...and the card shambles into place once it's on screen.
  requestAnimationFrame(() =>
    document.querySelectorAll<HTMLElement>(`.card-tile[data-card-id="${cardId}"]`).forEach((el) => {
      el.classList.add("shambling");
      el.addEventListener("animationend", () => el.classList.remove("shambling"), { once: true });
    }),
  );
}

/** Undead: archived cards sink into the ground first. Resolves once they're under. */
export function sinkCard(cardId: ID): Promise<void> {
  if (useStore.getState().data.settings.style !== "undead" || reduceMotion()) return Promise.resolve();
  const tiles = document.querySelectorAll<HTMLElement>(`.card-tile[data-card-id="${cardId}"]`);
  if (!tiles.length) return Promise.resolve();
  tiles.forEach((el) => el.classList.add("sinking"));
  return new Promise((r) => setTimeout(r, 420));
}
