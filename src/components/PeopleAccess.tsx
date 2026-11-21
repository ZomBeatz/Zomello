import { Users, X } from "lucide-react";
import { create } from "zustand";
import { useStore } from "../store";
import type { ID, ShareLevel } from "../types";
import { Avatar, Modal } from "./ui";

/**
 * Board menu > People on this board…: which people in your home see this board on their phones, and what
 * they may do there. Their phones are set up in Settings > Devices (Whose is it?). This computer enforces
 * it: a phone only ever gets the boards shared with its person (src-tauri/src/people.rs).
 */
export const usePeopleAccess = create<{ boardId: ID | null }>(() => ({ boardId: null }));
export const openPeopleAccess = (boardId: ID) => usePeopleAccess.setState({ boardId });

const LEVELS: { id: ShareLevel | "none"; name: string; about: string }[] = [
  { id: "none", name: "No access", about: "Doesn't see this board" },
  { id: "view", name: "Can view", about: "Sees it, changes nothing" },
  { id: "check", name: "Can check off", about: "Ticks off tasks assigned to them, and comments" },
  { id: "edit", name: "Can edit", about: "Changes anything on this board" },
];

export function PeopleAccessHost() {
  const boardId = usePeopleAccess((s) => s.boardId);
  const board = useStore((s) => (boardId ? s.data.boards[boardId] : undefined));
  const people = useStore((s) => s.data.settings.people);
  const me = useStore((s) => s.data.settings.me);
  if (!board) return null;
  const close = () => usePeopleAccess.setState({ boardId: null });
  const others = people.filter((p) => p !== me);
  const set = (person: string, level: ShareLevel | "none") => {
    const share = { ...(board.share ?? {}) };
    if (level === "none") delete share[person];
    else share[person] = level;
    useStore.getState().updateBoard(board.id, { share: Object.keys(share).length ? share : undefined });
  };
  return (
    <Modal onClose={close} width={600} className="customize">
      <header className="customize-head">
        <h2>
          <Users size={18} /> People on “{board.title}”
        </h2>
        <button className="icon-btn" title="Close" aria-label="Close" onClick={close}>
          <X size={18} />
        </button>
      </header>
      <div className="customize-body">
        <p className="muted small">
          Who sees this board on their phone, and what they can do. Give someone a phone first: Settings &gt; Devices &gt;
          <b> Whose is it?</b> Their phone only ever gets the boards you share here, while this computer is on.
        </p>
        {others.length === 0 ? (
          <p className="muted">No one else yet. Add people in Settings &gt; People, or from a phone in Settings &gt; Devices.</p>
        ) : (
          <div className="badge-modes">
            {others.map((p) => {
              const now = board.share?.[p] ?? "none";
              return (
                <div key={p} className="badge-mode-row">
                  <span className="grow person-row">
                    <Avatar name={p} size={22} /> {p}
                    <small className="muted">{LEVELS.find((l) => l.id === now)!.about}</small>
                  </span>
                  <div className="seg">
                    {LEVELS.map((l) => (
                      <button key={l.id} className={now === l.id ? "active" : ""} onClick={() => set(p, l.id)}>
                        {l.name}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
        <p className="muted small">Assign them cards (a card's Assigned to) and the cards show in their My Day and My Tasks.</p>
      </div>
    </Modal>
  );
}
