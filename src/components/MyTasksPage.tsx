import { useMemo, useState } from "react";
import { addDays } from "date-fns";
import { CheckSquare, Plus, Timer, UserCheck } from "lucide-react";
import type { Card, ID } from "../types";
import { useStore } from "../store";
import {
  byOrder, checklistStats, dueStatus, formatDuration, isLate, prettyDate, PRIORITIES, PROGRESS, toISO, todayISO, trackedMs,
} from "../utils";
import { Empty, PriorityBadge, ProgressIcon } from "./ui";
import { openCardMenu } from "./ContextMenu";
import { useWhen, withWhen } from "./WhenChip";

type GroupMode = "due" | "board" | "progress" | "priority";

export function MyTasksPage() {
  const data = useStore((s) => s.data);
  const { createCard } = useStore.getState();
  const me = data.settings.me;
  const [group, setGroup] = useState<GroupMode>("due");
  const [includeUnassigned, setIncludeUnassigned] = useState(false);
  const [showDone, setShowDone] = useState(false);
  const [title, setTitle] = useState("");
  const { when, chip } = useWhen(title);
  const liveBoards = useMemo(() => Object.values(data.boards).filter((b) => !b.archived).sort(byOrder), [data.boards]);
  const [target, setTarget] = useState<ID>(liveBoards[0]?.id ?? "");

  const mine = useMemo(() => {
    const live = new Set(liveBoards.map((b) => b.id));
    return Object.values(data.cards).filter(
      (c) =>
        !c.archived &&
        live.has(c.boardId) &&
        data.lists[c.listId] &&
        !data.lists[c.listId].archived &&
        (showDone || c.progress !== "completed") &&
        (me ? c.assignees.includes(me) || (includeUnassigned && c.assignees.length === 0) : true),
    );
  }, [data, liveBoards, me, includeUnassigned, showDone]);

  const groups = useMemo((): { key: string; title: string; color?: string; cards: Card[] }[] => {
    const byDue = (a: Card, b: Card) => (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999") || byOrder(a, b);
    if (group === "board")
      return liveBoards.map((b) => ({
        key: b.id,
        title: `${b.icon ? `${b.icon} ` : ""}${b.title}`,
        color: b.color,
        cards: mine.filter((c) => c.boardId === b.id).sort(byDue),
      }));
    if (group === "progress")
      return PROGRESS.map((p) => ({ key: p.id, title: p.name, color: p.color, cards: mine.filter((c) => c.progress === p.id).sort(byDue) }));
    if (group === "priority")
      return PRIORITIES.map((p) => ({ key: p.id, title: p.name, color: p.color, cards: mine.filter((c) => c.priority === p.id).sort(byDue) }));
    const t = todayISO();
    const tomorrow = toISO(addDays(new Date(), 1));
    const week = toISO(addDays(new Date(), 7));
    const open = mine.filter((c) => c.progress !== "completed");
    return [
      { key: "late", title: "Late", color: "#ef4444", cards: open.filter(isLate) },
      { key: "today", title: "Today", color: "#f97316", cards: open.filter((c) => c.dueDate === t) },
      { key: "tomorrow", title: "Tomorrow", color: "#eab308", cards: open.filter((c) => c.dueDate === tomorrow) },
      { key: "week", title: "Next 7 days", color: "#3b82f6", cards: open.filter((c) => !!c.dueDate && c.dueDate > tomorrow && c.dueDate <= week) },
      { key: "later", title: "Later", cards: open.filter((c) => !!c.dueDate && c.dueDate > week) },
      { key: "none", title: "No date", cards: open.filter((c) => !c.dueDate) },
      { key: "done", title: "Completed", color: "#22c55e", cards: mine.filter((c) => c.progress === "completed") },
    ].map((g) => ({ ...g, cards: g.cards.sort(byDue) }));
  }, [group, mine, liveBoards]);

  const add = () => {
    const t = title.trim();
    if (!t || !target) return;
    const list = Object.values(data.lists)
      .filter((l) => l.boardId === target && !l.archived)
      .sort(byOrder)[0];
    if (!list) return;
    const w = withWhen(t, when);
    createCard(list.id, w.title, { assignees: me ? [me] : [], ...(group === "due" ? { dueDate: todayISO() } : {}), ...w.extra });
    setTitle("");
  };

  return (
    <div className="page my-tasks">
      <h1>
        <UserCheck size={24} /> My Tasks
      </h1>
      <p className="muted">
        {me ? <>Everything assigned to <b>{me}</b> across all boards.</> : "Set who you are in Settings → People."}
      </p>

      <div className="toolbar flat">
        <div className="seg">
          {(
            [
              ["due", "Due date"],
              ["board", "Board"],
              ["progress", "Progress"],
              ["priority", "Priority"],
            ] as [GroupMode, string][]
          ).map(([id, name]) => (
            <button key={id} className={group === id ? "active" : ""} onClick={() => setGroup(id)}>
              {name}
            </button>
          ))}
        </div>
        <label className="check-row">
          <input type="checkbox" checked={includeUnassigned} onChange={(e) => setIncludeUnassigned(e.target.checked)} />
          Include unassigned
        </label>
        <label className="check-row">
          <input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} />
          Show completed
        </label>
      </div>

      {liveBoards.length > 0 && (
        <div className="list-add">
          <Plus size={16} />
          <input
            placeholder={`Add a task for ${me || "me"}${group === "due" ? ", due today" : ""}… (Enter)`}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && add()}
          />
          {chip}
          <select value={target} onChange={(e) => setTarget(e.target.value)}>
            {liveBoards.map((b) => (
              <option key={b.id} value={b.id}>
                {b.title}
              </option>
            ))}
          </select>
        </div>
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
            <ul className="task-rows">
              {g.cards.map((c) => (
                <TaskRow key={c.id} card={c} />
              ))}
            </ul>
          </section>
        ))}
      {mine.length === 0 && (
        <Empty icon={<UserCheck size={32} />} title="Nothing assigned to you">
          Assign tasks to {me || "yourself"} from a card, or tick “Include unassigned”.
        </Empty>
      )}
    </div>
  );
}

/** One task in My Tasks and My Day: tick it off, open it, or jump to its board. */
export function TaskRow({ card: c, time, extra }: { card: Card; time?: string; extra?: React.ReactNode }) {
  const data = useStore((s) => s.data);
  const { openCard, updateCard, navigate } = useStore.getState();
  const b = data.boards[c.boardId];
  const cl = checklistStats(c);
  const tracked = trackedMs(c);
  return (
    <li onClick={() => openCard(c.id)} onContextMenu={(e) => openCardMenu(e, c.id)}>
      <button
        className="progress-toggle"
        aria-label={c.progress === "completed" ? "Mark incomplete" : "Mark complete"}
        onClick={(e) => {
          e.stopPropagation();
          updateCard(c.id, { progress: c.progress === "completed" ? "notStarted" : "completed" });
        }}
      >
        <ProgressIcon progress={c.progress} />
      </button>
      {time && <span className="task-time">{time}</span>}
      <span className={`grow ellipsis ${c.progress === "completed" ? "strike" : ""}`}>{c.title}</span>
      <PriorityBadge priority={c.priority} />
      {cl.total > 0 && (
        <span className="badge">
          <CheckSquare size={12} /> {cl.done}/{cl.total}
        </span>
      )}
      {tracked > 0 && (
        <span className="badge">
          <Timer size={12} /> {formatDuration(tracked)}
        </span>
      )}
      <button
        className="board-tag"
        style={{ "--c": b.color } as React.CSSProperties}
        onClick={(e) => {
          e.stopPropagation();
          navigate({ page: "board", boardId: b.id });
        }}
      >
        {b.title} › {data.lists[c.listId]?.title}
      </button>
      <span className={`due-text due-${dueStatus(c)}`}>{c.dueDate ? prettyDate(c.dueDate) : ""}</span>
      {extra}
    </li>
  );
}
