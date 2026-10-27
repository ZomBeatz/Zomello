import { addDays, isSameDay, startOfDay } from "date-fns";
import type { AppData, Card } from "./types";
import { cardSpan, PRIORITIES, toISO } from "./utils";

const rank = (c: Card) => PRIORITIES.findIndex((p) => p.id === c.priority);

/**
 * What My Day shows for a day, from every board: what's late, what's due or scheduled that day (timed
 * things in time order), what was added to My Day for it, what got done, and ideas for what's next.
 * Used by the My Day page and the home-screen widget (which keeps today and tomorrow).
 */
export function myDayLists(data: AppData, day: Date) {
  const iso = toISO(day);
  const me = data.settings.me;
  const cards = Object.values(data.cards).filter(
    (c) => !c.archived && data.boards[c.boardId] && !data.boards[c.boardId].archived && data.lists[c.listId] && !data.lists[c.listId].archived,
  );
  const mine = (c: Card) => !me || c.assignees.length === 0 || c.assignees.includes(me);
  const open = cards.filter((c) => c.progress !== "completed");
  const dayStart = startOfDay(day);
  const dayEnd = addDays(dayStart, 1);
  const onDay = (c: Card) => {
    const s = cardSpan(c);
    return !!s && s.start < dayEnd && s.end > dayStart;
  };
  const isLate = (c: Card) => !!c.dueDate && c.dueDate < iso;
  const late = open.filter((c) => mine(c) && isLate(c)).sort((a, b) => a.dueDate!.localeCompare(b.dueDate!) || rank(a) - rank(b));
  const scheduled = open
    .filter((c) => mine(c) && !isLate(c) && onDay(c))
    .sort((a, b) => {
      const sa = cardSpan(a)!, sb = cardSpan(b)!;
      // Timed things first, in time order; then the rest by priority.
      if (!sa.allDay || !sb.allDay) return sa.allDay ? 1 : sb.allDay ? -1 : +sa.start - +sb.start;
      return rank(a) - rank(b);
    });
  const shown = new Set([...late, ...scheduled].map((c) => c.id));
  const added = open.filter((c) => c.myDay === iso && !shown.has(c.id)).sort((a, b) => rank(a) - rank(b));
  for (const c of added) shown.add(c.id);
  const done = cards.filter((c) => c.progress === "completed" && c.completedAt && isSameDay(c.completedAt, day) && (mine(c) || c.myDay === iso));
  const next = toISO(addDays(day, 1));
  const ideas = open
    .filter((c) => mine(c) && !shown.has(c.id))
    .filter((c) => c.dueDate === next || c.startDate === next || c.progress === "inProgress" || (!c.dueDate && (c.priority === "urgent" || c.priority === "important")))
    .sort((a, b) => (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999") || rank(a) - rank(b))
    .slice(0, 10);
  return { late, scheduled, added, done, ideas };
}
