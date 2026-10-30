import { useMemo, useState } from "react";
import { addDays, format, isSameDay } from "date-fns";
import { History, Lightbulb, Plus, Sun, X } from "lucide-react";
import type { Card, ID } from "../types";
import { useStore } from "../store";
import { byOrder, cardSpan, prettyDate, toISO, todayISO } from "../utils";
import { Empty } from "./ui";
import { TaskRow } from "./MyTasksPage";
import { myDayLists } from "../myDay";
import { useWhen, withWhen } from "./WhenChip";

/**
 * What to do today, from every board: what's late, what's due or scheduled today (timed things in time order),
 * and what you added to My Day yourself. Added cards only count on the day you added them, so the list starts
 * fresh every morning; Suggestions offers what's coming up.
 */
export function MyDayPage() {
  const data = useStore((s) => s.data);
  const { createCard, updateCard } = useStore.getState();
  const me = data.settings.me;
  const [title, setTitle] = useState("");
  const { when, chip } = useWhen(title);
  const [suggest, setSuggest] = useState(false);
  const liveBoards = useMemo(() => Object.values(data.boards).filter((b) => !b.archived).sort(byOrder), [data.boards]);
  const [target, setTarget] = useState<ID>(liveBoards[0]?.id ?? "");
  const today = todayISO();

  // Recomputed when the data changes, and when the day does (the page stays open past midnight).
  const { late, scheduled, added, leftovers, done, ideas } = useMemo(() => myDayLists(data, new Date()), [data, today]);

  const add = () => {
    const t = title.trim();
    if (!t || !target) return;
    const list = Object.values(data.lists)
      .filter((l) => l.boardId === target && !l.archived)
      .sort(byOrder)[0];
    if (!list) return;
    const w = withWhen(t, when);
    createCard(list.id, w.title, { assignees: me ? [me] : [], myDay: today, ...w.extra });
    setTitle("");
  };

  const timeOf = (c: Card) => {
    const s = cardSpan(c);
    if (!s) return undefined;
    if (!s.allDay && isSameDay(s.start, new Date())) return format(s.start, "p");
    if (c.dueDate && c.dueDate > today) return `until ${prettyDate(c.dueDate)}`;
    return undefined;
  };
  const removeBtn = (c: Card) => (
    <button
      className="icon-btn tiny"
      title="Remove from My Day"
      aria-label="Remove from My Day"
      onClick={(e) => {
        e.stopPropagation();
        updateCard(c.id, { myDay: null });
      }}
    >
      <X size={13} />
    </button>
  );
  const addBtn = (c: Card) => (
    <button
      className="btn sm"
      title="Add to My Day"
      onClick={(e) => {
        e.stopPropagation();
        updateCard(c.id, { myDay: today });
      }}
    >
      <Plus size={13} /> My Day
    </button>
  );

  const yesterday = toISO(addDays(new Date(), -1));
  const leftoverWhen = (c: Card) => (c.myDay === yesterday ? "yesterday" : format(new Date(`${c.myDay}T12:00`), "EEEE"));
  const addAllBack = () => {
    for (const c of leftovers) updateCard(c.id, { myDay: today });
  };
  const letGo = () => {
    for (const c of leftovers) updateCard(c.id, { myDay: null });
    useStore.getState().toast("Cleared the unfinished tasks from My Day. They're still on their boards.", { undo: true });
  };

  const groups: { key: string; title: string; color?: string; cards: Card[]; row: (c: Card) => React.ReactNode }[] = [
    { key: "late", title: "Late", color: "#ef4444", cards: late, row: (c) => <TaskRow key={c.id} card={c} /> },
    { key: "today", title: "Today", color: "#f97316", cards: scheduled, row: (c) => <TaskRow key={c.id} card={c} time={timeOf(c)} /> },
    { key: "added", title: "Added by you", color: "#3b82f6", cards: added, row: (c) => <TaskRow key={c.id} card={c} extra={removeBtn(c)} /> },
    { key: "done", title: "Done today", color: "#22c55e", cards: done, row: (c) => <TaskRow key={c.id} card={c} /> },
  ];
  const nothing = late.length + scheduled.length + added.length === 0;

  return (
    <div className="page my-tasks my-day">
      <h1>
        <Sun size={24} /> My Day
      </h1>
      <p className="muted">
        {format(new Date(), "EEEE, MMMM d")}. What's late, due or scheduled today on every board
        {me ? <> (for {me}, or no one)</> : null}, plus what you add here. Added tasks leave My Day at midnight.
      </p>

      {liveBoards.length > 0 && (
        <div className="list-add">
          <Plus size={16} />
          <input
            placeholder="Add a task to My Day… (Enter)"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && add()}
          />
          {chip}
          <select value={target} onChange={(e) => setTarget(e.target.value)} aria-label="Board for the new task">
            {liveBoards.map((b) => (
              <option key={b.id} value={b.id}>
                {b.title}
              </option>
            ))}
          </select>
        </div>
      )}

      {leftovers.length > 0 && (
        <section className="task-group leftovers">
          <h3>
            <History size={15} className="muted" />
            Not finished from earlier
            <span className="count">{leftovers.length}</span>
            <span className="grow" />
            <button className="btn sm" onClick={addAllBack}>
              Add all to today
            </button>
            <button className="btn ghost sm" onClick={letGo} title="Take them off this list (they stay on their boards)">
              Clear
            </button>
          </h3>
          <ul className="task-rows">
            {leftovers.map((c) => (
              <TaskRow key={c.id} card={c} time={`from ${leftoverWhen(c)}`} extra={addBtn(c)} />
            ))}
          </ul>
        </section>
      )}

      {groups
        .filter((g) => g.cards.length > 0)
        .map((g) => (
          <section key={g.key} className="task-group">
            <h3>
              {g.color && <span className="dot" style={{ background: g.color }} />}
              {g.title}
              <span className="count">{g.cards.length}</span>
            </h3>
            <ul className="task-rows">{g.cards.map(g.row)}</ul>
          </section>
        ))}

      {nothing && (
        <Empty icon={<Sun size={32} />} title="Nothing planned for today">
          {leftovers.length > 0 ? "Add back what's not finished from earlier, add" : "Add"} a task above, pick some from Suggestions, or use <b>Add to My Day</b> in any card's menu.
        </Empty>
      )}

      {ideas.length > 0 && (
        <section className="task-group">
          <button className="btn ghost sm" onClick={() => setSuggest((v) => !v)} aria-expanded={suggest}>
            <Lightbulb size={14} /> {suggest ? "Hide suggestions" : `Suggestions (${ideas.length})`}
          </button>
          {suggest && (
            <>
              <p className="muted small">Due or starting tomorrow, in progress, or important with no date.</p>
              <ul className="task-rows">
                {ideas.map((c) => (
                  <TaskRow key={c.id} card={c} extra={addBtn(c)} />
                ))}
              </ul>
            </>
          )}
        </section>
      )}
    </div>
  );
}
