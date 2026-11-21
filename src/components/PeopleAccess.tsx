import { useMemo } from "react";
import { Users, X } from "lucide-react";
import { create } from "zustand";
import { isDemo } from "../demo";
import { useStore } from "../store";
import type { Board, BucketAccess, ID, ShareLevel, ShareRules } from "../types";
import { byOrder, priorityList } from "../utils";
import { Avatar, Modal } from "./ui";

/**
 * Board menu > People on this board…: which people in your home see this board on their phones, and what
 * they may do there. Their phones are set up in Settings > Phones & tablets (Whose is it?). This computer enforces
 * it: a phone only ever gets the boards shared with its person (src-tauri/src/people.rs).
 */
export const usePeopleAccess = create<{ boardId: ID | null }>(() => ({ boardId: null }));
export const openPeopleAccess = (boardId: ID) => usePeopleAccess.setState({ boardId });

const LEVELS: { id: ShareLevel | "none"; name: string; about: string }[] = [
  { id: "none", name: "No access", about: "Doesn't see this board" },
  { id: "view", name: "Can view", about: "Sees it, changes nothing" },
  { id: "check", name: "Can check off", about: "Comments on any card. On cards assigned to them: sets the status and ticks checklist items" },
  { id: "edit", name: "Can edit", about: "Changes anything on this board" },
  { id: "custom", name: "Custom…", about: "Your own choices: which buckets, and what they can do" },
];

const BUCKET_LEVELS: { id: BucketAccess; name: string }[] = [
  { id: "hidden", name: "Hidden" },
  { id: "see", name: "See" },
  { id: "work", name: "Work in" },
  { id: "lead", name: "In charge" },
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
    // Custom starts from what they had, so switching to it changes nothing until something is picked.
    const was = board.share?.[person];
    const rules = board.shareRules?.[person] ?? {};
    const start: ShareRules =
      level === "custom" && was !== "custom"
        ? was === "edit"
          ? { otherBuckets: "lead", comment: true, status: "any", pickUp: true, handOff: true, details: true, create: true, archive: true }
          : { ...rules, otherBuckets: "see", comment: was === "check", status: was === "check" ? "own" : "none" }
        : rules;
    useStore.getState().updateBoard(board.id, {
      share: Object.keys(share).length ? share : undefined,
      shareRules: { ...board.shareRules, [person]: start },
    });
  };
  const setRules = (person: string, patch: Partial<ShareRules>) =>
    useStore.getState().updateBoard(board.id, { shareRules: { ...board.shareRules, [person]: { ...board.shareRules?.[person], ...patch } } });
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
        {isDemo && (
          <p className="demo-note small">
            <b>In the demo:</b> try the choices here. In the desktop app, they decide what each person's phone shows; a browser
            doesn't share anything.
          </p>
        )}
        <p className="muted small">
          Who sees this board on their phone, and what they can do. Give someone a phone first: Settings &gt; Phones &amp; tablets &gt;
          <b> Whose is it?</b> Their phone only ever gets the boards you share here, while this computer is on.
        </p>
        {others.length === 0 ? (
          <p className="muted">No one else yet. Add people in Settings &gt; People, or from a phone in Settings &gt; Phones &amp; tablets.</p>
        ) : (
          <div className="badge-modes">
            {others.map((p) => {
              const now = board.share?.[p] ?? "none";
              return (
                <div key={p} className="badge-mode-row">
                  <span className="grow">
                    <span className="person-row">
                      <Avatar name={p} size={22} /> {p}
                    </span>
                    <small className="muted">{LEVELS.find((l) => l.id === now)!.about}</small>
                  </span>
                  <div className="seg">
                    {LEVELS.map((l) => (
                      <button key={l.id} className={now === l.id ? "active" : ""} onClick={() => set(p, l.id)}>
                        {l.name}
                      </button>
                    ))}
                  </div>
                  {now === "check" && <CheckExtras rules={board.shareRules?.[p] ?? {}} onChange={(r) => setRules(p, r)} />}
                  {now === "custom" && <CustomRules board={board} rules={board.shareRules?.[p] ?? {}} onChange={(r) => setRules(p, r)} />}
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

function Tick({ on, onChange, children }: { on?: boolean; onChange: (on: boolean) => void; children: React.ReactNode }) {
  return (
    <label className="check-row small">
      <input type="checkbox" checked={!!on} onChange={(e) => onChange(e.target.checked)} />
      {children}
    </label>
  );
}

/** Can check off: the extras that make sense for someone looking after their own tasks. */
function CheckExtras({ rules, onChange }: { rules: ShareRules; onChange: (r: Partial<ShareRules>) => void }) {
  return (
    <div className="access-extras">
      <Tick on={rules.pickUp} onChange={(v) => onChange({ pickUp: v })}>Pick up cards nobody has</Tick>
      <Tick on={rules.moveOwn} onChange={(v) => onChange({ moveOwn: v })}>Move their cards between buckets</Tick>
      <Tick on={rules.handOff} onChange={(v) => onChange({ handOff: v })}>Hand their cards to someone else</Tick>
    </div>
  );
}

/** Custom…: each bucket, and each thing they can do. Enforced by this computer (src-tauri/src/people.rs). */
function CustomRules({ board, rules, onChange }: { board: Board; rules: ShareRules; onChange: (r: Partial<ShareRules>) => void }) {
  const all = useStore((s) => s.data.lists);
  const lists = useMemo(() => Object.values(all).filter((l) => l.boardId === board.id && !l.archived).sort(byOrder), [all, board.id]);
  const other = rules.otherBuckets ?? "see";
  const setBucket = (id: ID, v: BucketAccess) => onChange({ buckets: { ...rules.buckets, [id]: v } });
  const pris = priorityList(board);
  const allowed = rules.priorities;
  return (
    <div className="access-extras custom-rules">
      <b className="small">Buckets</b>
      {lists.map((l) => (
        <div key={l.id} className="row gap-sm wrap small">
          <span className="grow ellipsis">{l.title}</span>
          <div className="seg">
            {BUCKET_LEVELS.map((b) => (
              <button key={b.id} className={(rules.buckets?.[l.id] ?? other) === b.id ? "active" : ""} onClick={() => setBucket(l.id, b.id)}>
                {b.name}
              </button>
            ))}
          </div>
        </div>
      ))}
      <div className="row gap-sm wrap small">
        <span className="grow muted">Buckets added later</span>
        <div className="seg">
          {BUCKET_LEVELS.map((b) => (
            <button key={b.id} className={other === b.id ? "active" : ""} onClick={() => onChange({ otherBuckets: b.id })}>
              {b.name}
            </button>
          ))}
        </div>
      </div>
      <p className="muted small">
        <b>Work in</b>: change cards there and move them between such buckets. <b>In charge</b>: also add, remove and re-assign cards there.
      </p>
      <b className="small">What they can do</b>
      <label className="check-row small">
        Set the status and tick checklists on
        <select value={rules.status ?? "none"} onChange={(e) => onChange({ status: e.target.value as ShareRules["status"] })}>
          <option value="none">no cards</option>
          <option value="own">their own cards</option>
          <option value="any">any card in buckets they work in</option>
        </select>
      </label>
      <Tick on={rules.comment} onChange={(v) => onChange({ comment: v })}>Comment on cards</Tick>
      <Tick on={rules.details} onChange={(v) => onChange({ details: v })}>Edit what cards say (title, notes, dates, labels, effort)</Tick>
      <Tick on={rules.create} onChange={(v) => onChange({ create: v })}>Add cards to buckets they work in</Tick>
      <Tick on={rules.archive} onChange={(v) => onChange({ archive: v })}>Archive or delete cards in buckets they work in</Tick>
      <Tick on={rules.pickUp} onChange={(v) => onChange({ pickUp: v })}>Pick up cards nobody has</Tick>
      <Tick on={rules.handOff} onChange={(v) => onChange({ handOff: v })}>Hand their cards to someone else</Tick>
      <b className="small">Priorities they can set</b>
      <div className="row gap wrap small">
        <Tick on={!allowed} onChange={(v) => onChange({ priorities: v ? undefined : pris.map((p) => p.id) })}>Any</Tick>
        {allowed &&
          pris.map((p) => (
            <Tick
              key={p.id}
              on={allowed.includes(p.id)}
              onChange={(v) => onChange({ priorities: v ? [...allowed, p.id] : allowed.filter((x) => x !== p.id) })}
            >
              <span className="dot" style={{ background: p.color }} /> {p.icon ? `${p.icon} ` : ""}
              {p.name}
            </Tick>
          ))}
      </div>
    </div>
  );
}
