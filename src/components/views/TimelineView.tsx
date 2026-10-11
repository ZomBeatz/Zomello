import { useMemo, useState } from "react";
import { addDays, differenceInCalendarDays, format, isToday, isWeekend, startOfWeek } from "date-fns";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { Card, List } from "../../types";
import { useStore } from "../../store";
import { fromISO, isLate, plural, progressMeta } from "../../utils";
import { openCardMenu } from "../ContextMenu";

const DAY_W = 34;
const SPANS = { "2 weeks": 14, "6 weeks": 42, "3 months": 91 } as const;

export function TimelineView({ lists, cards }: { lists: List[]; cards: Card[] }) {
  const openCard = useStore((s) => s.openCard);
  const [span, setSpan] = useState<keyof typeof SPANS>("6 weeks");
  const weekStartsOn = useStore((s) => s.data.settings.weekStartsOn);
  const [start, setStart] = useState(() => addDays(startOfWeek(new Date(), { weekStartsOn }), -7));
  const nDays = SPANS[span];
  const days = useMemo(() => Array.from({ length: nDays }, (_, i) => addDays(start, i)), [start, nDays]);
  const dayW = span === "3 months" ? 18 : DAY_W;

  const scheduled = cards.filter((c) => c.startDate || c.dueDate);
  const unscheduledCount = cards.length - scheduled.length;

  const rows = lists
    .map((l) => ({
      list: l,
      cards: scheduled
        .filter((c) => c.listId === l.id)
        .sort((a, b) => (a.startDate ?? a.dueDate!).localeCompare(b.startDate ?? b.dueDate!)),
    }))
    .filter((r) => r.cards.length > 0);

  const bar = (c: Card) => {
    const s = fromISO(c.startDate ?? c.dueDate!);
    const e = fromISO(c.dueDate ?? c.startDate!);
    const from = differenceInCalendarDays(s, start);
    const to = differenceInCalendarDays(e, start);
    if (to < 0 || from >= nDays) return null;
    const left = Math.max(0, from) * dayW;
    const width = (Math.min(nDays - 1, to) - Math.max(0, from) + 1) * dayW - 4;
    const color = isLate(c) ? "#ef4444" : progressMeta(c.progress).color;
    return (
      <button
        className={`tl-bar ${c.progress === "completed" ? "done" : ""}`}
        style={{ left: left + 2, width, background: c.cover ?? color }}
        onClick={() => openCard(c.id)}
        onContextMenu={(e) => openCardMenu(e, c.id)}
        title={`${c.title}\n${c.startDate ?? "?"} → ${c.dueDate ?? "?"}`}
      >
        {c.title}
      </button>
    );
  };

  return (
    <div className="timeline">
      <div className="cal-toolbar">
        <button className="icon-btn" title="Previous week" aria-label="Previous week" onClick={() => setStart((d) => addDays(d, -7))}>
          <ChevronLeft size={18} />
        </button>
        <h2>
          {format(days[0], "MMM d")} – {format(days[days.length - 1], "MMM d, yyyy")}
        </h2>
        <button className="icon-btn" title="Next week" aria-label="Next week" onClick={() => setStart((d) => addDays(d, 7))}>
          <ChevronRight size={18} />
        </button>
        <button className="btn sm" onClick={() => setStart(addDays(startOfWeek(new Date(), { weekStartsOn }), -7))}>
          Today
        </button>
        <div className="seg">
          {(Object.keys(SPANS) as (keyof typeof SPANS)[]).map((k) => (
            <button key={k} className={k === span ? "active" : ""} onClick={() => setSpan(k)}>
              {k}
            </button>
          ))}
        </div>
        {unscheduledCount > 0 && <span className="muted small">{plural(unscheduledCount, "task")} without dates not shown</span>}
      </div>
      <div className="tl-scroll">
        <div className="tl-grid" style={{ width: 220 + nDays * dayW }}>
          <div className="tl-header">
            <div className="tl-label-col" />
            {days.map((d) => (
              <div
                key={d.toISOString()}
                className={`tl-day ${isWeekend(d) ? "weekend" : ""} ${isToday(d) ? "today" : ""}`}
                style={{ width: dayW }}
              >
                {(dayW > 20 || d.getDate() % 7 === 1) && (
                  <>
                    <span className="small muted">{format(d, dayW > 20 ? "EEEEE" : "MMM")}</span>
                    <span>{format(d, "d")}</span>
                  </>
                )}
              </div>
            ))}
          </div>
          {rows.length === 0 && <p className="muted pad">Give tasks a start or due date to see them here.</p>}
          {rows.map((r) => (
            <div key={r.list.id} className="tl-group">
              <div className="tl-group-title">{r.list.title}</div>
              {r.cards.map((c) => (
                <div key={c.id} className="tl-row">
                  <div className="tl-label-col" onClick={() => openCard(c.id)} onContextMenu={(e) => openCardMenu(e, c.id)} title={c.title}>
                    {c.title}
                  </div>
                  <div className="tl-track" style={{ width: nDays * dayW }}>
                    {days.map((d) => (
                      <div
                        key={d.toISOString()}
                        className={`tl-cell ${isWeekend(d) ? "weekend" : ""} ${isToday(d) ? "today" : ""}`}
                        style={{ width: dayW }}
                      />
                    ))}
                    {bar(c)}
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
