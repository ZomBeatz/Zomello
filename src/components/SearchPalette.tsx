import { useEffect, useMemo, useState } from "react";
import { Kanban, Search } from "lucide-react";
import { useStore } from "../store";
import { byOrder, cardText, dueStatus, prettyDate } from "../utils";
import { Modal, ProgressIcon } from "./ui";

type Result =
  | { kind: "board"; id: string; title: string; color: string; sub: string }
  | { kind: "card"; id: string; title: string; color: string; sub: string; archived: boolean };

export function SearchPalette() {
  const data = useStore((s) => s.data);
  const { setSearchOpen, navigate, openCard } = useStore.getState();
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const [includeArchived, setIncludeArchived] = useState(false);

  const results = useMemo<Result[]>(() => {
    const t = q.trim().toLowerCase();
    const boards = Object.values(data.boards)
      .filter((b) => (includeArchived || !b.archived) && (!t || b.title.toLowerCase().includes(t)))
      .sort(byOrder)
      .map<Result>((b) => ({ kind: "board", id: b.id, title: b.title, color: b.color, sub: "Board" }));
    if (!t) return boards.slice(0, 8);
    const cards = Object.values(data.cards)
      .filter((c) => {
        const b = data.boards[c.boardId];
        const archived = c.archived || b.archived || !!data.lists[c.listId]?.archived;
        return (includeArchived || !archived) && cardText(c).includes(t);
      })
      .sort((a, b) => Number(b.title.toLowerCase().includes(t)) - Number(a.title.toLowerCase().includes(t)) || b.updatedAt - a.updatedAt)
      .slice(0, 40)
      .map<Result>((c) => ({
        kind: "card",
        id: c.id,
        title: c.title,
        color: data.boards[c.boardId].color,
        sub: `${data.boards[c.boardId].title} › ${data.lists[c.listId]?.title ?? "?"}${c.dueDate ? ` · due ${prettyDate(c.dueDate)}` : ""}`,
        archived: c.archived,
      }));
    return [...boards, ...cards];
  }, [q, data, includeArchived]);

  useEffect(() => setSel(0), [q, includeArchived]);

  const choose = (r: Result | undefined) => {
    if (!r) return;
    setSearchOpen(false);
    if (r.kind === "board") navigate({ page: "board", boardId: r.id });
    else {
      navigate({ page: "board", boardId: data.cards[r.id].boardId });
      openCard(r.id);
    }
  };

  return (
    <Modal onClose={() => setSearchOpen(false)} width={640} className="search-modal">
      <div className="search-input">
        <Search size={18} />
        <input
          autoFocus
          placeholder="Search boards, cards, checklists, notes…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setSel((s) => Math.min(results.length - 1, s + 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setSel((s) => Math.max(0, s - 1));
            } else if (e.key === "Enter") choose(results[sel]);
          }}
        />
        <label className="small muted row gap-sm">
          <input type="checkbox" checked={includeArchived} onChange={(e) => setIncludeArchived(e.target.checked)} />
          Archived
        </label>
      </div>
      <ul className="search-results">
        {results.map((r, i) => (
          <li
            key={r.kind + r.id}
            className={i === sel ? "sel" : ""}
            onMouseEnter={() => setSel(i)}
            onClick={() => choose(r)}
          >
            {r.kind === "board" ? (
              <Kanban size={16} style={{ color: r.color }} />
            ) : (
              <span className={`due-${dueStatus(data.cards[r.id])}`}>
                <ProgressIcon progress={data.cards[r.id].progress} />
              </span>
            )}
            <div className="grow ellipsis">
              <div className="ellipsis">{r.title}</div>
              <div className="muted small ellipsis">
                {r.sub}
                {r.kind === "card" && r.archived ? " · archived" : ""}
              </div>
            </div>
          </li>
        ))}
        {results.length === 0 && <li className="muted">No results.</li>}
      </ul>
    </Modal>
  );
}
