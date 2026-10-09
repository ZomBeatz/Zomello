import { useMemo, useState } from "react";
import {
  addDays,
  addMonths,
  differenceInCalendarDays,
  endOfMonth,
  endOfWeek,
  format,
  isSameMonth,
  isToday,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import type { Board, Card, List } from "../../types";
import { useStore } from "../../store";
import { fromISO, progressMeta, toISO } from "../../utils";
import { ProgressIcon } from "../ui";
import { openCardMenu } from "../ContextMenu";

const DRAG_MIME = "text/planwise-card";

export function CalendarView({ board, lists, cards }: { board: Board; lists: List[]; cards: Card[] }) {
  const openCard = useStore((s) => s.openCard);
  const updateCard = useStore((s) => s.updateCard);
  const createCard = useStore((s) => s.createCard);
  const [month, setMonth] = useState(() => startOfMonth(new Date()));
  const [hoverDay, setHoverDay] = useState<string | null>(null);

  const days = useMemo(() => {
    const start = startOfWeek(startOfMonth(month), { weekStartsOn: 1 });
    const end = endOfWeek(endOfMonth(month), { weekStartsOn: 1 });
    const n = differenceInCalendarDays(end, start) + 1;
    return Array.from({ length: n }, (_, i) => addDays(start, i));
  }, [month]);

  const byDay = useMemo(() => {
    const m: Record<string, Card[]> = {};
    for (const c of cards) if (c.dueDate) (m[c.dueDate] ??= []).push(c);
    return m;
  }, [cards]);
  const unscheduled = cards.filter((c) => !c.dueDate && c.progress !== "completed");

  const dropOn = (day: string | null, e: React.DragEvent) => {
    e.preventDefault();
    setHoverDay(null);
    const id = e.dataTransfer.getData(DRAG_MIME);
    const card = cards.find((c) => c.id === id);
    if (!card) return;
    // Keep the start→due span length when moving a card that has both.
    let startDate = card.startDate;
    if (day && card.startDate && card.dueDate) {
      startDate = toISO(addDays(fromISO(day), differenceInCalendarDays(fromISO(card.startDate), fromISO(card.dueDate))));
    } else if (!day || (startDate && startDate > day)) startDate = null;
    updateCard(id, { dueDate: day, startDate });
  };

  const chip = (c: Card) => (
    <div
      key={c.id}
      className={`cal-chip ${c.progress === "completed" ? "done" : ""}`}
      style={{ borderLeftColor: c.cover ?? board.labels.find((l) => c.labelIds.includes(l.id))?.color ?? progressMeta(c.progress).color }}
      draggable
      onDragStart={(e) => e.dataTransfer.setData(DRAG_MIME, c.id)}
      onClick={() => openCard(c.id)}
      onContextMenu={(e) => openCardMenu(e, c.id)}
      title={c.title}
    >
      <ProgressIcon progress={c.progress} size={12} />
      <span>{c.title}</span>
    </div>
  );

  return (
    <div className="calendar-wrap">
      <div className="calendar">
        <div className="cal-toolbar">
          <button className="icon-btn" onClick={() => setMonth((m) => addMonths(m, -1))}>
            <ChevronLeft size={18} />
          </button>
          <h2>{format(month, "MMMM yyyy")}</h2>
          <button className="icon-btn" onClick={() => setMonth((m) => addMonths(m, 1))}>
            <ChevronRight size={18} />
          </button>
          <button className="btn sm" onClick={() => setMonth(startOfMonth(new Date()))}>
            Today
          </button>
        </div>
        <div className="cal-grid head">
          {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
            <div key={d}>{d}</div>
          ))}
        </div>
        <div className="cal-grid body" style={{ gridTemplateRows: `repeat(${days.length / 7}, minmax(110px, 1fr))` }}>
          {days.map((d) => {
            const iso = toISO(d);
            return (
              <div
                key={iso}
                className={`cal-day ${isSameMonth(d, month) ? "" : "other"} ${isToday(d) ? "today" : ""} ${hoverDay === iso ? "drop" : ""}`}
                onDragOver={(e) => {
                  e.preventDefault();
                  setHoverDay(iso);
                }}
                onDragLeave={() => setHoverDay((h) => (h === iso ? null : h))}
                onDrop={(e) => dropOn(iso, e)}
              >
                <div className="cal-day-head">
                  <span className="num">{format(d, "d")}</span>
                  {lists.length > 0 && (
                    <button
                      className="icon-btn tiny"
                      title="Add card due this day"
                      onClick={() => {
                        const id = createCard(lists[0].id, "New task", { dueDate: iso });
                        openCard(id);
                      }}
                    >
                      <Plus size={13} />
                    </button>
                  )}
                </div>
                <div className="cal-chips">{(byDay[iso] ?? []).map(chip)}</div>
              </div>
            );
          })}
        </div>
      </div>
      <aside
        className={`cal-side ${hoverDay === "none" ? "drop" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setHoverDay("none");
        }}
        onDragLeave={() => setHoverDay(null)}
        onDrop={(e) => dropOn(null, e)}
      >
        <h3>Unscheduled</h3>
        <p className="muted small">Drag onto a day to set a due date. Drop here to clear it.</p>
        {unscheduled.map(chip)}
      </aside>
    </div>
  );
}
