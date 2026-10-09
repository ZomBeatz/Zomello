import { useMemo, useState } from "react";
import { addDays } from "date-fns";
import { AlertTriangle, CalendarClock, CheckCircle2, FileUp, Plus, Sun, Timer } from "lucide-react";
import type { Card } from "../types";
import { useStore } from "../store";
import { byOrder, dueStatus, isLate, PALETTE, prettyDate, toISO, todayISO } from "../utils";
import { ColorPicker, Empty, ProgressIcon } from "./ui";
import { openCardMenu } from "./ContextMenu";

export function HomePage() {
  const data = useStore((s) => s.data);
  const { navigate, openCard, createBoard, updateCard } = useStore.getState();
  const [newTitle, setNewTitle] = useState("");
  const [newColor, setNewColor] = useState<string | null>(PALETTE[6]);

  const boards = useMemo(() => Object.values(data.boards).filter((b) => !b.archived).sort(byOrder), [data.boards]);
  const liveCards = useMemo(() => {
    const liveBoards = new Set(boards.map((b) => b.id));
    return Object.values(data.cards).filter(
      (c) => !c.archived && liveBoards.has(c.boardId) && data.lists[c.listId] && !data.lists[c.listId].archived,
    );
  }, [data.cards, data.lists, boards]);

  const me = data.settings.me;
  const today = todayISO();
  const week = toISO(addDays(new Date(), 7));
  const open = liveCards.filter((c) => c.progress !== "completed");
  const sections: { title: string; icon: React.ReactNode; cards: Card[]; tone?: string }[] = [
    { title: "Late", icon: <AlertTriangle size={16} />, cards: open.filter(isLate), tone: "danger" },
    { title: "Due today", icon: <Sun size={16} />, cards: open.filter((c) => c.dueDate === today), tone: "warn" },
    {
      title: "Next 7 days",
      icon: <CalendarClock size={16} />,
      cards: open.filter((c) => c.dueDate && c.dueDate > today && c.dueDate <= week).sort((a, b) => a.dueDate!.localeCompare(b.dueDate!)),
    },
    {
      title: me ? `In progress · ${me}` : "In progress",
      icon: <Timer size={16} />,
      cards: open.filter((c) => c.progress === "inProgress" && (!me || c.assignees.length === 0 || c.assignees.includes(me))),
    },
  ];
  const recentDone = liveCards
    .filter((c) => c.progress === "completed" && c.completedAt)
    .sort((a, b) => b.completedAt! - a.completedAt!)
    .slice(0, 8);

  const Row = ({ c }: { c: Card }) => (
    <li className="home-task" onClick={() => openCard(c.id)} onContextMenu={(e) => openCardMenu(e, c.id)}>
      <button
        className="progress-toggle"
        onClick={(e) => {
          e.stopPropagation();
          updateCard(c.id, { progress: c.progress === "completed" ? "notStarted" : "completed" });
        }}
      >
        <ProgressIcon progress={c.progress} />
      </button>
      <span className="ellipsis grow">{c.title}</span>
      <span className="board-tag" style={{ "--c": data.boards[c.boardId].color } as React.CSSProperties}>
        {data.boards[c.boardId].title}
      </span>
      {c.dueDate && <span className={`due-text due-${dueStatus(c)}`}>{prettyDate(c.dueDate)}</span>}
    </li>
  );

  const hour = new Date().getHours();
  const greet = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  return (
    <div className="page home">
      <h1>
        {greet}
        {me ? `, ${me}` : ""}
      </h1>
      <p className="muted">
        {open.length} open task{open.length === 1 ? "" : "s"} across {boards.length} board{boards.length === 1 ? "" : "s"}.
      </p>

      <div className="home-grid">
        {sections.map((s) => (
          <section key={s.title} className={`panel ${s.tone ?? ""}`}>
            <h3>
              {s.icon} {s.title} <span className="count">{s.cards.length}</span>
            </h3>
            {s.cards.length === 0 ? (
              <p className="muted small">Nothing here.</p>
            ) : (
              <ul className="home-list">
                {s.cards.slice(0, 12).map((c) => (
                  <Row key={c.id} c={c} />
                ))}
              </ul>
            )}
          </section>
        ))}
      </div>

      <h2>Boards</h2>
      <div className="board-tiles">
        {boards.map((b) => {
          const cs = liveCards.filter((c) => c.boardId === b.id);
          const done = cs.filter((c) => c.progress === "completed").length;
          const late = cs.filter(isLate).length;
          return (
            <button key={b.id} className="board-tile" onClick={() => navigate({ page: "board", boardId: b.id })}>
              <span className="tile-band" style={{ background: b.color }} />
              <span className="tile-title">{b.title}</span>
              <span className="muted small">
                {done}/{cs.length} done{late ? ` · ${late} late` : ""}
              </span>
              <span className="progress-bar">
                <span style={{ width: cs.length ? `${(done / cs.length) * 100}%` : 0, background: b.color }} />
              </span>
            </button>
          );
        })}
        <div className="board-tile new">
          <input
            placeholder="New board name…"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && newTitle.trim()) navigate({ page: "board", boardId: createBoard(newTitle.trim(), newColor ?? undefined) });
            }}
          />
          <ColorPicker value={newColor} onChange={setNewColor} />
          <button
            className="btn primary sm"
            disabled={!newTitle.trim()}
            onClick={() => navigate({ page: "board", boardId: createBoard(newTitle.trim(), newColor ?? undefined) })}
          >
            <Plus size={14} /> Create board
          </button>
          <button className="btn ghost sm" onClick={() => useStore.getState().setOverlay({ importOpen: true })}>
            <FileUp size={14} /> Import from Trello or Planner
          </button>
        </div>
      </div>

      {recentDone.length > 0 && (
        <>
          <h2>
            <CheckCircle2 size={18} /> Recently completed
          </h2>
          <ul className="home-list panel">
            {recentDone.map((c) => (
              <Row key={c.id} c={c} />
            ))}
          </ul>
        </>
      )}
      {boards.length === 0 && <Empty title="No boards yet">Create one above to get started.</Empty>}
    </div>
  );
}
