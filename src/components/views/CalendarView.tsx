import { useEffect, useMemo, useRef, useState } from "react";
import { useDragSensors } from "../../mobile";
import {
  addDays,
  addMonths,
  addWeeks,
  differenceInCalendarDays,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  isToday,
  startOfDay,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { CalendarDays, ChevronLeft, ChevronRight, Plus, RefreshCw } from "lucide-react";
import { eventDays, useFeedEvents, type FeedEvent } from "../../calendarFeeds";
import { DndContext, DragOverlay, pointerWithin, rectIntersection, useDraggable, useDroppable, type CollisionDetection } from "@dnd-kit/core";
import type { Board, Card, List } from "../../types";
import { useStore } from "../../store";
import { cardSpan, fromISO, prettyTime, progressMeta, toISO } from "../../utils";
import { ProgressIcon } from "../ui";
import { openCardMenu } from "../ContextMenu";

type CalView = "month" | "week" | "day";
const VIEW_KEY = "zomello-calendar-view";
const HOUR_PX = 44;
const SLOT_MIN = 30;
const BAR_PX = 22;

const hhmm = (d: Date) => format(d, "HH:mm");
/** Drag ids: a chip is the card id, a bar `bar:<card>:<week>`, a block `blk:<card>`. */
const cardIdOf = (dragId: string) => (dragId.includes(":") ? dragId.split(":")[1] : dragId);
/** The spot under the finger or pointer decides where it goes (the card's outline can cover several hours). */
const underPointer: CollisionDetection = (args) => {
  const hit = pointerWithin(args);
  return hit.length ? hit : rectIntersection(args);
};

/** A chip you can drag between days (pointer-based, so it works the same on Linux and Windows). */
function Chip({ card, color, onOpen, time }: { card: Card; color: string; onOpen: () => void; time?: string }) {
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
      {time && <span className="ev-time">{time}</span>}
      <span>{card.title}</span>
    </div>
  );
}

/** A card that runs over several days, drawn across them (one piece per week row). */
function Bar({ dragId, card, color, style, onOpen, cont }: {
  dragId: string; card: Card; color: string; style: React.CSSProperties; onOpen: () => void;
  /** Whether it carries on before / after this row. */
  cont: { before: boolean; after: boolean };
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: dragId });
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className={`cal-bar ${card.progress === "completed" ? "done" : ""} ${isDragging ? "ghost" : ""} ${cont.before ? "cont-before" : ""} ${cont.after ? "cont-after" : ""}`}
      style={{ ...style, "--bar": color } as React.CSSProperties}
      onClick={onOpen}
      onContextMenu={(e) => openCardMenu(e, card.id)}
      title={card.title}
    >
      <ProgressIcon progress={card.progress} size={12} />
      {card.startTime && !cont.before && <span className="ev-time">{prettyTime(card.startTime)}</span>}
      <span className="bar-title">{card.title}</span>
    </div>
  );
}

/** A timed card in the Week and Day views, at its hours. */
function Block({ card, color, style, onOpen, label }: { card: Card; color: string; style: React.CSSProperties; onOpen: () => void; label: string }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: `blk:${card.id}` });
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className={`cal-block ${card.progress === "completed" ? "done" : ""} ${isDragging ? "ghost" : ""}`}
      style={{ ...style, "--bar": color } as React.CSSProperties}
      onClick={onOpen}
      onContextMenu={(e) => openCardMenu(e, card.id)}
      title={`${card.title}\n${label}`}
    >
      <span className="block-title">{card.title}</span>
      <span className="ev-time">{label}</span>
    </div>
  );
}

/** A calendar-feed event: read-only, in its calendar's color. */
function EventChip({ event: e, style }: { event: FeedEvent; style?: React.CSSProperties }) {
  const time = e.allDay ? "" : format(e.start, "p").replace(":00", "").replace(" ", "").toLowerCase();
  const when = e.allDay ? "All day" : `${format(e.start, "p")}${e.end ? ` to ${format(e.end, "p")}` : ""}`;
  return (
    <div
      className={`cal-event ${e.allDay ? "all-day" : ""} ${style ? "in-grid" : ""}`}
      style={{ ...style, "--ev": e.feed.color } as React.CSSProperties}
      title={`${e.title}\n${when}${e.location ? `\n${e.location}` : ""}\n${e.feed.name}`}
    >
      <CalendarDays size={11} />
      {time && <span className="ev-time">{time}</span>}
      <span className="ev-title">{e.title}</span>
    </div>
  );
}

function DropCell({ id, className, children, style, onDoubleClick }: {
  id: string; className: string; children?: React.ReactNode; style?: React.CSSProperties; onDoubleClick?: () => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div ref={setNodeRef} className={`${className} ${isOver ? "drop" : ""}`} style={style} onDoubleClick={onDoubleClick}>
      {children}
    </div>
  );
}

interface Placed { card: Card; col: number; span: number; lane: number; before: boolean; after: boolean }

/** Cards that run over several days, placed in lanes across a row of days so they don't overlap. */
function layoutBars(cards: Card[], days: Date[]): { placed: Placed[]; lanes: number } {
  const first = startOfDay(days[0]);
  const after = addDays(first, days.length);
  const items = cards
    .map((card) => ({ card, s: cardSpan(card)! }))
    .filter(({ s }) => s && s.start < after && s.end > first)
    .map(({ card, s }) => {
      const lastDay = new Date(+s.end - 1);
      const from = Math.max(0, differenceInCalendarDays(s.start, first));
      const to = Math.min(days.length - 1, differenceInCalendarDays(lastDay, first));
      return { card, col: from, span: to - from + 1, before: s.start < first, after: lastDay >= after };
    })
    .sort((a, b) => a.col - b.col || b.span - a.span);
  const ends: number[] = [];
  const placed = items.map((it) => {
    let lane = ends.findIndex((e) => e < it.col);
    if (lane < 0) lane = ends.length;
    ends[lane] = it.col + it.span - 1;
    return { ...it, lane };
  });
  return { placed, lanes: ends.length };
}

/** Whether a card shows as a bar (several days) rather than a chip or a block. */
const isMultiDay = (c: Card) => {
  const s = cardSpan(c);
  return !!s && !isSameDay(s.start, new Date(+s.end - 1));
};

/** Side-by-side columns for timed things that overlap in one day. */
function layoutDay<T extends { start: Date; end: Date }>(items: T[]): (T & { colIdx: number; cols: number })[] {
  const sorted = [...items].sort((a, b) => +a.start - +b.start || +b.end - +a.end);
  const out: (T & { colIdx: number; cols: number })[] = [];
  let group: (T & { colIdx: number; cols: number })[] = [];
  let groupEnd = 0;
  const flush = () => {
    const cols = Math.max(1, ...group.map((g) => g.colIdx + 1));
    for (const g of group) g.cols = cols;
    out.push(...group);
    group = [];
  };
  for (const it of sorted) {
    if (group.length && +it.start >= groupEnd) flush();
    const taken = new Set(group.filter((g) => +g.end > +it.start).map((g) => g.colIdx));
    let colIdx = 0;
    while (taken.has(colIdx)) colIdx++;
    group.push({ ...it, colIdx, cols: 1 });
    groupEnd = Math.max(groupEnd, +it.end);
  }
  if (group.length) flush();
  return out;
}

function loadView(): CalView {
  try {
    const v = localStorage.getItem(VIEW_KEY);
    if (v === "week" || v === "day" || v === "month") return v;
  } catch {
    /* storage blocked */
  }
  return "month";
}

export function CalendarView({ board, lists, cards }: { board: Board; lists: List[]; cards: Card[] }) {
  const openCard = useStore((s) => s.openCard);
  const updateCard = useStore((s) => s.updateCard);
  const createCard = useStore((s) => s.createCard);
  const [view, setViewState] = useState<CalView>(loadView);
  const [cursor, setCursor] = useState(() => startOfDay(new Date()));
  const [dragging, setDragging] = useState<Card | null>(null);
  /** Where a timed card was grabbed, in minutes below its start (so it moves by that much, not to the pointer). */
  const grabOffset = useRef(0);
  const sensors = useDragSensors(5);
  const weekStartsOn = useStore((s) => s.data.settings.weekStartsOn);

  const setView = (v: CalView) => {
    setViewState(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      /* not critical */
    }
  };

  const days = useMemo(() => {
    if (view === "day") return [cursor];
    if (view === "week") {
      const start = startOfWeek(cursor, { weekStartsOn });
      return Array.from({ length: 7 }, (_, i) => addDays(start, i));
    }
    const start = startOfWeek(startOfMonth(cursor), { weekStartsOn });
    const end = endOfWeek(endOfMonth(cursor), { weekStartsOn });
    const n = differenceInCalendarDays(end, start) + 1;
    return Array.from({ length: n }, (_, i) => addDays(start, i));
  }, [view, cursor, weekStartsOn]);

  // Events from the board's calendar feeds (Google Calendar etc.), read-only.
  const range = useMemo(() => ({ from: days[0], to: addDays(days[days.length - 1], 1) }), [days]);
  const feeds = useFeedEvents(board, range.from, range.to);
  const eventsByDay = useMemo(() => {
    const m: Record<string, FeedEvent[]> = {};
    for (const e of feeds.events) for (const d of eventDays(e)) (m[d] ??= []).push(e);
    return m;
  }, [feeds.events]);

  const scheduled = useMemo(() => cards.filter((c) => c.dueDate || c.startDate), [cards]);
  const multi = useMemo(() => scheduled.filter(isMultiDay), [scheduled]);
  /** One-day cards by day, timed ones in time order after the all-day ones. */
  const byDay = useMemo(() => {
    const m: Record<string, Card[]> = {};
    for (const c of scheduled) if (!isMultiDay(c)) (m[toISO(cardSpan(c)!.start)] ??= []).push(c);
    for (const list of Object.values(m)) list.sort((a, b) => (a.startTime ?? a.dueTime ?? "").localeCompare(b.startTime ?? b.dueTime ?? ""));
    return m;
  }, [scheduled]);
  const unscheduled = cards.filter((c) => !c.dueDate && !c.startDate && c.progress !== "completed");

  /** Dropped on a day (all-day): a chip's due date moves there, a bar's start does; the span keeps its length. */
  const dropOnDay = (day: string | null, card: Card, by: "due" | "start", extra: Partial<Card> = {}) => {
    if (!day) return updateCard(card.id, { dueDate: null, startDate: null, startTime: null, dueTime: null });
    const s = card.startDate, d = card.dueDate;
    if (by === "start" && s && d) {
      const len = differenceInCalendarDays(fromISO(d), fromISO(s));
      return updateCard(card.id, { startDate: day, dueDate: toISO(addDays(fromISO(day), len)), ...extra });
    }
    if (s && !d) return updateCard(card.id, { startDate: day, ...extra });
    const startDate = s && d ? toISO(addDays(fromISO(day), differenceInCalendarDays(fromISO(s), fromISO(d)))) : null;
    updateCard(card.id, { dueDate: day, startDate, ...extra });
  };

  /** Dropped on a time slot: it starts then, on that day, and keeps its length (an hour if it had none). */
  const dropOnSlot = (day: string, minutes: number, card: Card) => {
    const span = cardSpan(card);
    const len = span && !span.allDay && !isMultiDay(card) ? +span.end - +span.start : 3600e3;
    const start = fromISO(day);
    start.setMinutes(minutes);
    let end = new Date(+start + len);
    if (!isSameDay(start, new Date(+end - 1))) end = new Date(+addDays(startOfDay(start), 1) - 60e3);
    updateCard(card.id, { startDate: null, dueDate: day, startTime: hhmm(start), dueTime: hhmm(end) });
  };

  const colorOf = (c: Card) =>
    c.cover ?? board.labels.find((l) => c.labelIds.includes(l.id))?.color ?? progressMeta(c.progress).color;
  const chip = (c: Card) => (
    <Chip key={c.id} card={c} color={colorOf(c)} onOpen={() => openCard(c.id)} time={c.startTime ? prettyTime(c.startTime) : c.dueTime ? prettyTime(c.dueTime) : undefined} />
  );
  const addOn = (iso: string, extra: Partial<Card> = {}) => {
    if (!lists.length) return;
    openCard(createCard(lists[0].id, "New task", { dueDate: iso, ...extra }));
  };

  const step = (n: number) =>
    setCursor((c) => (view === "month" ? addMonths(startOfMonth(c), n) : view === "week" ? addWeeks(c, n) : addDays(c, n)));
  const title =
    view === "month"
      ? format(cursor, "MMMM yyyy")
      : view === "week"
        ? `${format(days[0], "MMM d")} to ${format(days[6], isSameMonth(days[0], days[6]) ? "d, yyyy" : "MMM d, yyyy")}`
        : format(cursor, "EEEE, MMM d");
  const unit = view === "month" ? "month" : view === "week" ? "week" : "day";

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={underPointer}
      onDragStart={(e) => {
        setDragging(cards.find((c) => c.id === cardIdOf(String(e.active.id))) ?? null);
        const ev = e.activatorEvent as PointerEvent | TouchEvent;
        const y = "touches" in ev ? ev.touches[0]?.clientY : ev.clientY;
        const top = e.active.rect.current.initial?.top;
        grabOffset.current =
          String(e.active.id).startsWith("blk:") && y !== undefined && top !== undefined
            ? Math.floor(((y - top) * 60) / HOUR_PX / SLOT_MIN) * SLOT_MIN
            : 0;
      }}
      onDragCancel={() => setDragging(null)}
      onDragEnd={(e) => {
        setDragging(null);
        const over = e.over?.id ? String(e.over.id) : null;
        const dragId = String(e.active.id);
        const card = cards.find((c) => c.id === cardIdOf(dragId));
        if (!over || !card) return;
        if (over === "unscheduled") return dropOnDay(null, card, "due");
        if (over.startsWith("slot:")) {
          const [, day, mins] = over.split(":");
          return dropOnSlot(day, Math.max(0, Number(mins) - grabOffset.current), card);
        }
        // Onto a day (month cell, or the all-day row): it becomes all day there.
        const day = over.slice(4);
        dropOnDay(day, card, dragId.startsWith("bar:") ? "start" : "due", over.startsWith("all:") ? { startTime: null, dueTime: null } : {});
      }}
    >
    <div className="calendar-wrap">
      <div className="calendar">
        <div className="cal-toolbar">
          <button className="icon-btn" title={`Previous ${unit}`} aria-label={`Previous ${unit}`} onClick={() => step(-1)}>
            <ChevronLeft size={18} />
          </button>
          <h2>{title}</h2>
          <button className="icon-btn" title={`Next ${unit}`} aria-label={`Next ${unit}`} onClick={() => step(1)}>
            <ChevronRight size={18} />
          </button>
          <button className="btn sm" onClick={() => setCursor(startOfDay(new Date()))}>
            Today
          </button>
          <div className="seg cal-views" role="group" aria-label="Calendar view">
            {(["day", "week", "month"] as CalView[]).map((v) => (
              <button key={v} className={view === v ? "active" : ""} aria-pressed={view === v} onClick={() => setView(v)}>
                {v === "day" ? "Day" : v === "week" ? "Week" : "Month"}
              </button>
            ))}
          </div>
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
        {view === "month" ? (
          <MonthGrid
            days={days}
            month={cursor}
            multi={multi}
            byDay={byDay}
            eventsByDay={eventsByDay}
            colorOf={colorOf}
            chip={chip}
            onOpen={openCard}
            onAdd={lists.length ? addOn : undefined}
          />
        ) : (
          <TimeGrid
            days={days}
            cards={scheduled}
            multi={multi}
            feedEvents={feeds.events}
            colorOf={colorOf}
            onOpen={openCard}
            onAdd={lists.length ? addOn : undefined}
            onPickDay={(d) => (setCursor(d), setView("day"))}
          />
        )}
      </div>
      <DropCell id="unscheduled" className="cal-side">
        <h3>Unscheduled</h3>
        <p className="muted small">Drag onto a day to set a due date, or onto a time in Week or Day. Drop here to clear it.</p>
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

function MonthGrid({ days, month, multi, byDay, eventsByDay, colorOf, chip, onOpen, onAdd }: {
  days: Date[];
  month: Date;
  multi: Card[];
  byDay: Record<string, Card[]>;
  eventsByDay: Record<string, FeedEvent[]>;
  colorOf: (c: Card) => string;
  chip: (c: Card) => React.ReactNode;
  onOpen: (id: string) => void;
  onAdd?: (iso: string) => void;
}) {
  const weeks = Array.from({ length: days.length / 7 }, (_, i) => days.slice(i * 7, i * 7 + 7));
  return (
    <>
      <div className="cal-grid head">
        {days.slice(0, 7).map((d) => (
          <div key={toISO(d)}>{format(d, "EEE")}</div>
        ))}
      </div>
      <div className="cal-month">
        {weeks.map((week, w) => {
          const { placed, lanes } = layoutBars(multi, week);
          return (
            <div key={w} className="cal-week" style={{ minHeight: 110 + lanes * BAR_PX }}>
              {week.map((d) => {
                const iso = toISO(d);
                return (
                  <DropCell key={iso} id={`day:${iso}`} className={`cal-day ${isSameMonth(d, month) ? "" : "other"} ${isToday(d) ? "today" : ""}`}>
                    <div className="cal-day-head">
                      <span className="num">{format(d, "d")}</span>
                      {onAdd && (
                        <button className="icon-btn tiny" title="Add card due this day" aria-label="Add card due this day" onClick={() => onAdd(iso)}>
                          <Plus size={13} />
                        </button>
                      )}
                    </div>
                    <div className="cal-chips" style={{ marginTop: lanes * BAR_PX }}>
                      {(eventsByDay[iso] ?? []).map((e, i) => (
                        <EventChip key={`${e.feed.id}-${i}-${e.start.getTime()}`} event={e} />
                      ))}
                      {(byDay[iso] ?? []).map(chip)}
                    </div>
                  </DropCell>
                );
              })}
              {placed.map((p) => (
                <Bar
                  key={`${p.card.id}-${w}`}
                  dragId={`bar:${p.card.id}:${w}`}
                  card={p.card}
                  color={colorOf(p.card)}
                  onOpen={() => onOpen(p.card.id)}
                  cont={{ before: p.before, after: p.after }}
                  style={{
                    top: 28 + p.lane * BAR_PX,
                    left: `calc(${(p.col * 100) / 7}% + 3px)`,
                    width: `calc(${(p.span * 100) / 7}% - 6px)`,
                  }}
                />
              ))}
            </div>
          );
        })}
      </div>
    </>
  );
}

function TimeGrid({ days, cards, multi, feedEvents, colorOf, onOpen, onAdd, onPickDay }: {
  days: Date[];
  cards: Card[];
  multi: Card[];
  feedEvents: FeedEvent[];
  colorOf: (c: Card) => string;
  onOpen: (id: string) => void;
  onAdd?: (iso: string, extra?: Partial<Card>) => void;
  onPickDay: (d: Date) => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);
  // Start the view at 7 in the morning (or the first thing that day, if earlier).
  const firstHour = useMemo(() => {
    let h = 7;
    for (const c of cards) {
      const s = cardSpan(c);
      if (s && !s.allDay && !isMultiDay(c) && days.some((d) => isSameDay(d, s.start))) h = Math.min(h, s.start.getHours());
    }
    return h;
  }, [cards, days]);
  const key = toISO(days[0]) + days.length;
  useEffect(() => {
    if (scroller.current) scroller.current.scrollTop = Math.max(0, firstHour * HOUR_PX - 8);
    // Only when the days shown change, not on every edit.
  }, [key]);

  const cols = { gridTemplateColumns: `52px repeat(${days.length}, minmax(0, 1fr))` };
  // The all-day row: multi-day cards as bars, one-day all-day cards and all-day events as chips.
  const { placed, lanes } = layoutBars(multi, days);
  const allDayOf = (iso: string) => cards.filter((c) => !isMultiDay(c) && cardSpan(c)!.allDay && toISO(cardSpan(c)!.start) === iso);
  const allDayEvents = (d: Date) => feedEvents.filter((e) => (e.allDay || (e.end && !isSameDay(e.start, new Date(+e.end - 1)))) && eventDays(e).includes(toISO(d)));
  const chipRows = Math.max(0, ...days.map((d) => allDayOf(toISO(d)).length + allDayEvents(d).length));

  return (
    <div className={`cal-time ${days.length === 1 ? "one-day" : ""}`}>
      <div className="cal-time-head" style={cols}>
        <div />
        {days.map((d) => (
          <button key={toISO(d)} className={`cal-col-head ${isToday(d) ? "today" : ""}`} onClick={() => onPickDay(d)} title="Show this day">
            <span className="dow">{format(d, "EEE")}</span>
            <span className="num">{format(d, "d")}</span>
          </button>
        ))}
      </div>
      <div className="cal-allday" style={{ ...cols, minHeight: Math.max(30, 6 + lanes * BAR_PX + chipRows * BAR_PX) }}>
        <div className="cal-hour-label">All day</div>
        {days.map((d) => {
          const iso = toISO(d);
          return (
            <DropCell key={iso} id={`all:${iso}`} className="cal-allday-cell" onDoubleClick={onAdd ? () => onAdd(iso) : undefined}>
              <div className="cal-chips" style={{ marginTop: lanes * BAR_PX }}>
                {allDayEvents(d).map((e, i) => (
                  <EventChip key={`${e.feed.id}-${i}-${e.start.getTime()}`} event={e} />
                ))}
                {allDayOf(iso).map((c) => (
                  <Chip key={c.id} card={c} color={colorOf(c)} onOpen={() => onOpen(c.id)} />
                ))}
              </div>
            </DropCell>
          );
        })}
        <div className="cal-allday-bars" style={{ left: 52 }}>
          {placed.map((p) => (
            <Bar
              key={p.card.id}
              dragId={`bar:${p.card.id}:0`}
              card={p.card}
              color={colorOf(p.card)}
              onOpen={() => onOpen(p.card.id)}
              cont={{ before: p.before, after: p.after }}
              style={{
                top: 3 + p.lane * BAR_PX,
                left: `calc(${(p.col * 100) / days.length}% + 3px)`,
                width: `calc(${(p.span * 100) / days.length}% - 6px)`,
              }}
            />
          ))}
        </div>
      </div>
      <div className="cal-time-body" ref={scroller}>
        <div className="cal-time-grid" style={{ ...cols, height: 24 * HOUR_PX }}>
          <div className="cal-hours">
            {Array.from({ length: 24 }, (_, h) => (
              <div key={h} className="cal-hour-label" style={{ top: h * HOUR_PX }}>
                {h === 0 ? "" : format(new Date(2000, 0, 1, h), "p").replace(":00", "")}
              </div>
            ))}
          </div>
          {days.map((d) => {
            const iso = toISO(d);
            const blocks = layoutDay([
              ...cards
                .filter((c) => !isMultiDay(c) && !cardSpan(c)!.allDay && isSameDay(cardSpan(c)!.start, d))
                .map((c) => ({ kind: "card" as const, card: c, ...cardSpan(c)! })),
              ...feedEvents
                .filter((e) => !e.allDay && isSameDay(e.start, d) && (!e.end || isSameDay(e.start, new Date(+e.end - 1))))
                .map((e) => ({ kind: "event" as const, event: e, start: e.start, end: e.end ?? new Date(+e.start + 1800e3) })),
            ]);
            return (
              <div key={iso} className={`cal-time-col ${isToday(d) ? "today" : ""}`}>
                {Array.from({ length: (24 * 60) / SLOT_MIN }, (_, i) => (
                  <DropCell
                    key={i}
                    id={`slot:${iso}:${i * SLOT_MIN}`}
                    className={`cal-slot ${i % 2 ? "half" : ""}`}
                    style={{ top: (i * SLOT_MIN * HOUR_PX) / 60, height: (SLOT_MIN * HOUR_PX) / 60 }}
                    onDoubleClick={
                      onAdd
                        ? () => {
                            const s = new Date(fromISO(iso));
                            s.setMinutes(i * SLOT_MIN);
                            onAdd(iso, { startTime: hhmm(s), dueTime: hhmm(new Date(+s + 3600e3)) });
                          }
                        : undefined
                    }
                  />
                ))}
                {blocks.map((b) => {
                  const top = ((b.start.getHours() * 60 + b.start.getMinutes()) * HOUR_PX) / 60;
                  const mins = Math.max(20, (+b.end - +b.start) / 60e3);
                  const style: React.CSSProperties = {
                    top,
                    height: Math.min((mins * HOUR_PX) / 60, 24 * HOUR_PX - top) - 2,
                    left: `calc(${(b.colIdx * 100) / b.cols}% + 2px)`,
                    width: `calc(${100 / b.cols}% - 4px)`,
                  };
                  if (b.kind === "event") return <EventChip key={`${b.event.feed.id}-${+b.start}-${b.event.title}`} event={b.event} style={style} />;
                  return (
                    <Block
                      key={b.card.id}
                      card={b.card}
                      color={colorOf(b.card)}
                      style={style}
                      onOpen={() => onOpen(b.card.id)}
                      label={`${format(b.start, "p")} to ${format(b.end, "p")}`}
                    />
                  );
                })}
                {isToday(d) && (
                  <div className="cal-now" style={{ top: ((now.getHours() * 60 + now.getMinutes()) * HOUR_PX) / 60 }} aria-hidden />
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
