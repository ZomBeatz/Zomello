import { useMemo, useState } from "react";
import { useDragSensors } from "../../mobile";
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
import { CalendarDays, ChevronLeft, ChevronRight, Plus, RefreshCw } from "lucide-react";
import { eventDays, useFeedEvents, type FeedEvent } from "../../calendarFeeds";
import { DndContext, DragOverlay, useDraggable, useDroppable } from "@dnd-kit/core";
import type { Board, Card, List } from "../../types";
import { useStore } from "../../store";
import { fromISO, progressMeta, toISO } from "../../utils";
import { ProgressIcon } from "../ui";
import { openCardMenu } from "../ContextMenu";

/** A chip you can drag between days (pointer-based, so it works the same on Linux and Windows). */
function Chip({ card, color, onOpen }: { card: Card; color: string; onOpen: () => void }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: card.id });
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className={`cal-chip ${card.progress === "completed" ? "done" : ""} ${isDragging ? "ghost" : ""}`}
      style={{ borderLeftColor: color }}
      onClick={onOpen}
      onContextMenu={(e) => openCardMenu(e, card.id)}
      title={card.title}
    >
      <ProgressIcon progress={card.progress} size={12} />
      <span>{card.title}</span>
    </div>
  );
}

/** A calendar-feed event: read-only, in its calendar's color. */
function EventChip({ event: e }: { event: FeedEvent }) {
  const time = e.allDay ? "" : format(e.start, "p").replace(":00", "").replace(" ", "").toLowerCase();
  const when = e.allDay ? "All day" : `${format(e.start, "p")}${e.end ? ` – ${format(e.end, "p")}` : ""}`;
  return (
    <div
      className={`cal-event ${e.allDay ? "all-day" : ""}`}
      style={{ "--ev": e.feed.color } as React.CSSProperties}
      title={`${e.title}\n${when}${e.location ? `\n${e.location}` : ""}\n${e.feed.name}`}
    >
      <CalendarDays size={11} />
      {time && <span className="ev-time">{time}</span>}
      <span className="ev-title">{e.title}</span>
    </div>
  );
}

function DropCell({ id, className, children }: { id: string; className: string; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div ref={setNodeRef} className={`${className} ${isOver ? "drop" : ""}`}>
      {children}
    </div>
  );
}

export function CalendarView({ board, lists, cards }: { board: Board; lists: List[]; cards: Card[] }) {
  const openCard = useStore((s) => s.openCard);
  const updateCard = useStore((s) => s.updateCard);
  const createCard = useStore((s) => s.createCard);
  const [month, setMonth] = useState(() => startOfMonth(new Date()));
  const [dragging, setDragging] = useState<Card | null>(null);
  const sensors = useDragSensors(5);
  const weekStartsOn = useStore((s) => s.data.settings.weekStartsOn);

  const days = useMemo(() => {
    const start = startOfWeek(startOfMonth(month), { weekStartsOn });
    const end = endOfWeek(endOfMonth(month), { weekStartsOn });
    const n = differenceInCalendarDays(end, start) + 1;
    return Array.from({ length: n }, (_, i) => addDays(start, i));
  }, [month, weekStartsOn]);

  // Events from the board's calendar feeds (Google Calendar etc.), read-only.
  const range = useMemo(() => ({ from: days[0], to: addDays(days[days.length - 1], 1) }), [days]);
  const feeds = useFeedEvents(board, range.from, range.to);
  const eventsByDay = useMemo(() => {
    const m: Record<string, FeedEvent[]> = {};
    for (const e of feeds.events) for (const d of eventDays(e)) (m[d] ??= []).push(e);
    return m;
  }, [feeds.events]);

  const byDay = useMemo(() => {
    const m: Record<string, Card[]> = {};
    for (const c of cards) if (c.dueDate) (m[c.dueDate] ??= []).push(c);
    return m;
  }, [cards]);
  const unscheduled = cards.filter((c) => !c.dueDate && c.progress !== "completed");

  const dropOn = (day: string | null, id: string) => {
    const card = cards.find((c) => c.id === id);
    if (!card) return;
    // Keep the start→due span length when moving a card that has both.
    let startDate = card.startDate;
    if (day && card.startDate && card.dueDate) {
      startDate = toISO(addDays(fromISO(day), differenceInCalendarDays(fromISO(card.startDate), fromISO(card.dueDate))));
    } else if (!day || (startDate && startDate > day)) startDate = null;
    updateCard(id, { dueDate: day, startDate });
  };

  const colorOf = (c: Card) =>
    c.cover ?? board.labels.find((l) => c.labelIds.includes(l.id))?.color ?? progressMeta(c.progress).color;
  const chip = (c: Card) => <Chip key={c.id} card={c} color={colorOf(c)} onOpen={() => openCard(c.id)} />;

  return (
    <DndContext
      sensors={sensors}
      onDragStart={(e) => setDragging(cards.find((c) => c.id === e.active.id) ?? null)}
      onDragCancel={() => setDragging(null)}
      onDragEnd={(e) => {
        setDragging(null);
        const over = e.over?.id ? String(e.over.id) : null;
        if (!over) return;
        dropOn(over === "unscheduled" ? null : over.slice(4), String(e.active.id));
      }}
    >
    <div className="calendar-wrap">
      <div className="calendar">
        <div className="cal-toolbar">
          <button className="icon-btn" title="Previous month" aria-label="Previous month" onClick={() => setMonth((m) => addMonths(m, -1))}>
            <ChevronLeft size={18} />
          </button>
          <h2>{format(month, "MMMM yyyy")}</h2>
          <button className="icon-btn" title="Next month" aria-label="Next month" onClick={() => setMonth((m) => addMonths(m, 1))}>
            <ChevronRight size={18} />
          </button>
          <button className="btn sm" onClick={() => setMonth(startOfMonth(new Date()))}>
            Today
          </button>
          {feeds.hasFeeds && (
            <button className="btn ghost sm" title="Fetch the calendars again now" onClick={feeds.reload}>
              <RefreshCw size={13} /> Calendars
            </button>
          )}
          {feeds.errors.length > 0 && (
            <span className="small danger-text" title={feeds.errors.map((e) => `${e.feed.name}: ${e.message}`).join("\n")}>
              Couldn't load {feeds.errors.map((e) => e.feed.name).join(", ")}
            </span>
          )}
        </div>
        <div className="cal-grid head">
          {days.slice(0, 7).map((d) => format(d, "EEE")).map((d) => (
            <div key={d}>{d}</div>
          ))}
        </div>
        <div className="cal-grid body" style={{ gridTemplateRows: `repeat(${days.length / 7}, minmax(110px, 1fr))` }}>
          {days.map((d) => {
            const iso = toISO(d);
            return (
              <DropCell key={iso} id={`day:${iso}`} className={`cal-day ${isSameMonth(d, month) ? "" : "other"} ${isToday(d) ? "today" : ""}`}>
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
                <div className="cal-chips">
                  {(eventsByDay[iso] ?? []).map((e, i) => (
                    <EventChip key={`${e.feed.id}-${i}-${e.start.getTime()}`} event={e} />
                  ))}
                  {(byDay[iso] ?? []).map(chip)}
                </div>
              </DropCell>
            );
          })}
        </div>
      </div>
      <DropCell id="unscheduled" className="cal-side">
        <h3>Unscheduled</h3>
        <p className="muted small">Drag onto a day to set a due date. Drop here to clear it.</p>
        {unscheduled.map(chip)}
      </DropCell>
    </div>
      <DragOverlay dropAnimation={null}>
        {dragging && (
          <div className="cal-chip drag-chip" style={{ borderLeftColor: colorOf(dragging) }}>
            <ProgressIcon progress={dragging.progress} size={12} />
            <span>{dragging.title}</span>
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}
