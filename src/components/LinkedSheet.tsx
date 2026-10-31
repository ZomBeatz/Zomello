import type { ReactNode } from "react";
import { create } from "zustand";
import { Ban, Calendar, CornerDownRight, ExternalLink, GitFork, Link2, ListTree, Octagon, X } from "lucide-react";
import type { Card, ID } from "../types";
import { useStore } from "../store";
import { dueStatus, isBlocked, parentIndex, prettyDateTime, subtaskIds } from "../utils";
import { Modal, ProgressIcon } from "./ui";

/**
 * The "Linked" sheet: everything a card is connected to, grouped by how. On a computer, hovering a card
 * outlines its linked cards; phones can't hover and show one bucket at a time, so tapping a card's link
 * badge opens this instead (it works on computers too).
 */
export const useLinkedSheet = create<{ cardId: ID | null }>(() => ({ cardId: null }));
export const openLinked = (cardId: ID) => useLinkedSheet.setState({ cardId });
const close = () => useLinkedSheet.setState({ cardId: null });

/** The groups a card's connections fall into, in the order the sheet shows them (empty groups left out). */
export function linkedGroups(card: Card, cards: Record<ID, Card>): { name: string; icon: ReactNode; cards: Card[] }[] {
  const ofType = (t: string) => card.links.filter((l) => l.type === t).map((l) => cards[l.cardId]).filter(Boolean);
  return [
    { name: "Part of", icon: <CornerDownRight size={14} />, cards: parentIndex(cards).get(card.id) ?? [] },
    { name: "Sub-tasks", icon: <ListTree size={14} />, cards: subtaskIds(card).map((id) => cards[id]).filter(Boolean) },
    { name: "Blocked by", icon: <Ban size={14} />, cards: ofType("blockedBy") },
    { name: "Blocks", icon: <Octagon size={14} />, cards: ofType("blocks") },
    { name: "Related", icon: <Link2 size={14} />, cards: ofType("relates") },
  ].filter((g) => g.cards.length);
}

export function LinkedSheetHost() {
  const cardId = useLinkedSheet((s) => s.cardId);
  const card = useStore((s) => (cardId ? s.data.cards[cardId] : undefined));
  const cards = useStore((s) => s.data.cards);
  const boards = useStore((s) => s.data.boards);
  const lists = useStore((s) => s.data.lists);
  if (!card) return null;
  const groups = linkedGroups(card, cards);
  const st = useStore.getState();
  const open = (id: ID) => {
    close();
    st.openCard(id);
  };

  return (
    <Modal onClose={close} width={460} className="linked-sheet">
      <header className="linked-sheet-head">
        <div className="grow">
          <span className="muted small">Linked to</span>
          <h3 className="ellipsis">{card.title}</h3>
        </div>
        <button className="icon-btn" title="Close" aria-label="Close" onClick={close}>
          <X size={16} />
        </button>
      </header>
      {groups.length === 0 && <p className="muted">This card isn't linked to anything.</p>}
      {groups.map((g) => (
        <section key={g.name}>
          <h4>
            {g.icon} {g.name} <span className="muted">{g.cards.length}</span>
          </h4>
          <ul className="linked-sheet-list">
            {g.cards.map((c) => {
              const due = dueStatus(c);
              const otherBoard = c.boardId !== card.boardId;
              return (
                <li key={c.id}>
                  <button onClick={() => open(c.id)}>
                    <ProgressIcon progress={c.progress} size={16} />
                    <span className="grow linked-sheet-text">
                      <span className={`ellipsis ${c.progress === "completed" ? "done" : ""}`}>{c.title}</span>
                      <span className="muted small ellipsis">
                        {otherBoard && `${boards[c.boardId]?.title ?? "?"} › `}
                        {lists[c.listId]?.title ?? ""}
                        {c.archived && " (archived)"}
                      </span>
                    </span>
                    {c.progress !== "completed" && isBlocked(c, cards) && (
                      <span className="badge blocked" title="Blocked by an unfinished task">
                        <Ban size={12} />
                      </span>
                    )}
                    {c.dueDate && (
                      <span className={`badge due-${due}`}>
                        <Calendar size={12} /> {prettyDateTime(c.dueDate, c.dueTime)}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
      <div className="row end gap linked-sheet-foot">
        {groups.length > 0 && (
          <button
            className="btn"
            title="Show only this card and the cards linked to it"
            onClick={() => {
              close();
              st.navigate({ page: "board", boardId: card.boardId });
              st.setFilter(card.boardId, { relatedTo: card.id, relatedDeep: false });
            }}
          >
            <GitFork size={14} /> Show on board
          </button>
        )}
        <button className="btn primary" onClick={() => open(card.id)}>
          <ExternalLink size={14} /> Open card
        </button>
      </div>
    </Modal>
  );
}
