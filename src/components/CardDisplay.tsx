import { X } from "lucide-react";
import { create } from "zustand";
import { useStore } from "../store";
import type { BadgeKey, BadgeMode, ID } from "../types";
import { BADGES } from "./BoardCustomize";
import { Modal } from "./ui";

/** Card menu > Card display…: what this one card shows, over its bucket's and board's choices. */
export const useCardDisplay = create<{ cardId: ID | null }>(() => ({ cardId: null }));
export const openCardDisplay = (cardId: ID) => useCardDisplay.setState({ cardId });

const label = (m: BadgeMode) => (m === "off" ? "Hidden" : m === "icon" ? "Icon" : "Details");

export function CardDisplayHost() {
  const cardId = useCardDisplay((s) => s.cardId);
  const card = useStore((s) => (cardId ? s.data.cards[cardId] : undefined));
  const board = useStore((s) => (card ? s.data.boards[card.boardId] : undefined));
  const list = useStore((s) => (card ? s.data.lists[card.listId] : undefined));
  if (!card || !board) return null;
  const close = () => useCardDisplay.setState({ cardId: null });
  const set = (key: BadgeKey, mode: BadgeMode | null) => {
    const next = { ...(card.badges ?? {}) };
    if (mode === null) delete next[key];
    else next[key] = mode;
    useStore.getState().updateCard(card.id, { badges: Object.keys(next).length ? next : undefined });
  };
  // What the card shows without its own choice: the bucket's, else the board's.
  const inherited = (key: BadgeKey): BadgeMode => list?.badges?.[key] ?? board.display.badges[key] ?? "off";
  return (
    <Modal onClose={close} width={560} className="customize">
      <header className="customize-head">
        <h2>Card display for “{card.title}”</h2>
        <button className="icon-btn" title="Close" aria-label="Close" onClick={close}>
          <X size={18} />
        </button>
      </header>
      <div className="customize-body">
        <p className="muted small">
          What this card shows on the board, whatever its bucket and board show. “Usual” follows the bucket and board (shown in brackets).
        </p>
        <div className="badge-modes">
          {BADGES.map((b) => {
            const own = card.badges?.[b.key];
            return (
              <div key={b.key} className="badge-mode-row">
                <span className="grow">{b.name}</span>
                <div className="seg">
                  <button className={!own ? "active" : ""} onClick={() => set(b.key, null)}>
                    Usual ({label(inherited(b.key))})
                  </button>
                  {(["off", "icon", "full"] as BadgeMode[]).map((m) => (
                    <button key={m} className={own === m ? "active" : ""} onClick={() => set(b.key, m)}>
                      {label(m)}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
        {card.badges && (
          <button className="btn sm ghost" onClick={() => useStore.getState().updateCard(card.id, { badges: undefined })}>
            Back to the usual for everything
          </button>
        )}
      </div>
    </Modal>
  );
}

/**
 * A small "On card" tick next to a section's name in the card window (like custom fields have): shows
 * that part in full on the card on the board, whatever the bucket and board show.
 */
export function ShowOnCard({ cardId, kind, label = "On card" }: { cardId: ID; kind: BadgeKey; label?: string }) {
  const card = useStore((s) => s.data.cards[cardId]);
  const usual = useStore((s): BadgeMode => {
    const c = s.data.cards[cardId];
    return (c && (s.data.lists[c.listId]?.badges?.[kind] ?? s.data.boards[c.boardId]?.display.badges[kind])) ?? "off";
  });
  if (!card) return null;
  const now = card.badges?.[kind] ?? usual;
  const set = (on: boolean) => {
    const next = { ...(card.badges ?? {}) };
    // Back to the usual when that already matches; otherwise this card's own choice.
    const want: BadgeMode = on ? "full" : usual === "full" ? "icon" : usual;
    if (want === usual) delete next[kind];
    else next[kind] = want;
    useStore.getState().updateCard(card.id, { badges: Object.keys(next).length ? next : undefined });
  };
  return (
    <label className="show-on-card" title="Show this in full on the card on the board" onClick={(e) => e.stopPropagation()}>
      <input type="checkbox" checked={now === "full"} onChange={(e) => set(e.target.checked)} />
      {label}
    </label>
  );
}
