import type { Card, ID, Progress } from "./types";
import { useStore } from "./store";
import { isBlocked } from "./utils";
import { ask } from "./components/ui";

/** The unfinished cards `card` is waiting on. */
export const blockersOf = (card: Card, cards: Record<ID, Card>) =>
  card.links
    .filter((l) => l.type === "blockedBy")
    .map((l) => cards[l.cardId])
    .filter((c): c is Card => !!c && c.progress !== "completed");

/**
 * Before completing cards, check none of them is still blocked. Asks once ("Still blocked by …") when one
 * is; resolves true when it's fine to go ahead.
 */
export async function okToComplete(ids: ID[]): Promise<boolean> {
  const cards = useStore.getState().data.cards;
  const blocked = ids.map((id) => cards[id]).filter((c) => c && c.progress !== "completed" && isBlocked(c, cards));
  if (!blocked.length) return true;
  const msg =
    blocked.length === 1
      ? `"${blocked[0].title}" is still blocked by ${blockersOf(blocked[0], cards).map((c) => `"${c.title}"`).join(", ")}. Mark it complete anyway?`
      : `${blocked.length} of these cards are still blocked by unfinished tasks. Mark them complete anyway?`;
  return ask(msg, { okText: "Complete anyway" });
}

/** Set a card's progress, asking first when completing a card that's still blocked. */
export async function setProgress(id: ID, progress: Progress) {
  if (progress === "completed" && !(await okToComplete([id]))) return;
  useStore.getState().updateCard(id, { progress });
}

/** Tick or untick a card, asking first when completing a card that's still blocked. */
export function toggleDone(card: Card) {
  return setProgress(card.id, card.progress === "completed" ? "notStarted" : "completed");
}

/** Tick a checklist item. A ticked sub-task completes its card, so that asks first when the card is blocked. */
export async function tickItem(cardId: ID, itemId: ID) {
  const st = useStore.getState();
  const linked = st.data.cards[cardId]?.checklist.find((i) => i.id === itemId)?.cardId;
  if (linked && st.data.cards[linked]?.progress !== "completed" && !(await okToComplete([linked]))) return;
  useStore.getState().toggleChecklistItem(cardId, itemId);
}
