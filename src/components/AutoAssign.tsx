import { useEffect } from "react";
import { plan } from "../assign";
import { isRemote } from "../remote";
import { isServer } from "../server";
import { useStore } from "../store";
import { isExtraWindow } from "../windows";

/**
 * Runs Auto-assign (src/assign.ts) where the data lives: the computer's main window, or a phone's own
 * boards. A phone showing the computer's boards leaves it to the computer, so a card is never handed out
 * twice. Runs a moment after any change: a card arriving, someone finishing one, a capacity going up.
 */
export function AutoAssign() {
  const data = useStore((s) => s.data);
  const loaded = useStore((s) => s.loaded);
  useEffect(() => {
    if (!loaded || isRemote || isServer || isExtraWindow) return;
    if (!Object.values(data.lists).some((l) => l.autoAssign && !l.archived)) return;
    const t = setTimeout(() => {
      const st = useStore.getState();
      const given: string[] = [];
      for (const board of Object.values(st.data.boards)) {
        if (board.archived) continue;
        for (const { cardId, person } of plan(st.data, board).give) {
          st.updateCard(cardId, { assignees: [person], autoAssigned: true });
          given.push(person);
        }
      }
      if (given.length === 1) st.toast(`Auto-assign gave a card to ${given[0]}`, { key: "auto-assign" });
      else if (given.length > 1) st.toast(`Auto-assign handed out ${given.length} cards`, { key: "auto-assign" });
    }, 400);
    return () => clearTimeout(t);
  }, [data, loaded]);
  return null;
}

/** Bucket menu > Rebalance: cards Auto-assign gave out that nobody has started go back to the queue and are handed out again. */
export function rebalance(listId: string): number {
  const st = useStore.getState();
  const cards = Object.values(st.data.cards).filter((c) => c.listId === listId && !c.archived && c.autoAssigned && c.progress === "notStarted");
  for (const c of cards) st.updateCard(c.id, { assignees: [], autoAssigned: null });
  return cards.length;
}
