import { addDays, addMonths, addYears, differenceInCalendarDays, format, parseISO, startOfWeek } from "date-fns";
import type { Board, Card, DueFilter, Filter, GroupBy, LinkType, List, Priority, Progress, Recurrence } from "./types";

export const uid = (): string => crypto.randomUUID();

export const todayISO = () => format(new Date(), "yyyy-MM-dd");
export const toISO = (d: Date) => format(d, "yyyy-MM-dd");
export const fromISO = (s: string) => parseISO(s);
export const prettyDate = (s: string) => {
  const d = parseISO(s);
  return format(d, d.getFullYear() === new Date().getFullYear() ? "MMM d" : "MMM d, yyyy");
};

export const PRIORITIES: { id: Priority; name: string; color: string }[] = [
  { id: "urgent", name: "Urgent", color: "#ef4444" },
  { id: "important", name: "Important", color: "#f97316" },
  { id: "medium", name: "Medium", color: "#3b82f6" },
  { id: "low", name: "Low", color: "#94a3b8" },
];
export const PROGRESS: { id: Progress; name: string; color: string }[] = [
  { id: "notStarted", name: "Not started", color: "#94a3b8" },
  { id: "inProgress", name: "In progress", color: "#3b82f6" },
  { id: "completed", name: "Completed", color: "#22c55e" },
];
export const priorityMeta = (p: Priority) => PRIORITIES.find((x) => x.id === p)!;
export const progressMeta = (p: Progress) => PROGRESS.find((x) => x.id === p)!;

export const PALETTE = [
  "#ef4444", "#f97316", "#eab308", "#22c55e", "#14b8a6",
  "#0ea5e9", "#6366f1", "#a855f7", "#ec4899", "#64748b",
];

export const emptyFilter = (): Filter => ({
  text: "",
  labelIds: [],
  priorities: [],
  progress: [],
  assignees: [],
  due: "any",
});

export const filterIsActive = (f: Filter) =>
  !!f.text || f.labelIds.length > 0 || f.priorities.length > 0 || f.progress.length > 0 ||
  f.assignees.length > 0 || f.due !== "any";

export type DueStatus = "overdue" | "today" | "soon" | "later" | "done" | null;

export function dueStatus(card: Card): DueStatus {
  if (!card.dueDate) return null;
  if (card.progress === "completed") return "done";
  const diff = differenceInCalendarDays(parseISO(card.dueDate), new Date());
  if (diff < 0) return "overdue";
  if (diff === 0) return "today";
  if (diff <= 3) return "soon";
  return "later";
}

export const isLate = (c: Card) => dueStatus(c) === "overdue";

function matchesDue(card: Card, due: DueFilter): boolean {
  if (due === "any") return true;
  if (due === "none") return !card.dueDate;
  if (!card.dueDate) return false;
  const diff = differenceInCalendarDays(parseISO(card.dueDate), new Date());
  if (due === "overdue") return diff < 0 && card.progress !== "completed";
  if (due === "today") return diff === 0;
  return diff >= 0 && diff <= 7;
}

export function cardText(card: Card): string {
  return [
    card.title,
    card.description,
    ...card.checklist.map((i) => i.text),
    ...card.comments.map((c) => c.text),
    ...card.attachments.map((a) => a.name),
  ]
    .join("\n")
    .toLowerCase();
}

export function matchesFilter(card: Card, f: Filter): boolean {
  if (f.text && !cardText(card).includes(f.text.toLowerCase())) return false;
  if (f.labelIds.length && !f.labelIds.some((l) => card.labelIds.includes(l))) return false;
  if (f.priorities.length && !f.priorities.includes(card.priority)) return false;
  if (f.progress.length && !f.progress.includes(card.progress)) return false;
  if (f.assignees.length) {
    const wantsNone = f.assignees.includes("");
    const hit = f.assignees.some((a) => a && card.assignees.includes(a));
    if (!hit && !(wantsNone && card.assignees.length === 0)) return false;
  }
  return matchesDue(card, f.due);
}

export const byOrder = <T extends { order: number }>(a: T, b: T) => a.order - b.order;

export interface Group {
  id: string;
  title: string;
  color?: string;
  cards: Card[];
  /** The list this group represents (bucket grouping only). */
  list?: List;
  /** Patch applied to a card dropped into / created in this group; null = not droppable. */
  patch: ((card: Card | null) => Partial<Card>) | null;
}

/** Split a board's (already filtered) cards into columns for the chosen grouping. */
export function buildGroups(
  groupBy: GroupBy,
  board: Board,
  lists: List[],
  cards: Card[],
  people: string[],
): Group[] {
  const sorted = [...cards].sort(byOrder);
  switch (groupBy) {
    case "bucket":
      return lists.map((l) => ({
        id: l.id,
        title: l.title,
        list: l,
        cards: sorted.filter((c) => c.listId === l.id),
        patch: () => ({ listId: l.id }),
      }));
    case "progress":
      return PROGRESS.map((p) => ({
        id: `progress:${p.id}`,
        title: p.name,
        color: p.color,
        cards: sorted.filter((c) => c.progress === p.id),
        patch: () => ({ progress: p.id }),
      }));
    case "priority":
      return PRIORITIES.map((p) => ({
        id: `priority:${p.id}`,
        title: p.name,
        color: p.color,
        cards: sorted.filter((c) => c.priority === p.id),
        patch: () => ({ priority: p.id }),
      }));
    case "assignee": {
      const names = Array.from(new Set([...people, ...cards.flatMap((c) => c.assignees)]));
      return [
        {
          id: "assignee:",
          title: "Unassigned",
          cards: sorted.filter((c) => c.assignees.length === 0),
          patch: () => ({ assignees: [] }),
        },
        ...names.map((n) => ({
          id: `assignee:${n}`,
          title: n,
          color: colorFor(n),
          cards: sorted.filter((c) => c.assignees.includes(n)),
          patch: () => ({ assignees: [n] }),
        })),
      ];
    }
    case "label":
      return [
        {
          id: "label:",
          title: "No label",
          cards: sorted.filter((c) => c.labelIds.length === 0),
          patch: null,
        },
        ...board.labels.map((l) => ({
          id: `label:${l.id}`,
          title: l.name || "Unnamed",
          color: l.color,
          cards: sorted.filter((c) => c.labelIds.includes(l.id)),
          patch: null,
        })),
      ];
    case "due": {
      const today = new Date();
      const iso = (n: number) => toISO(addDays(today, n));
      const buckets: { id: string; title: string; color?: string; test: (c: Card) => boolean; due: string | null }[] = [
        { id: "late", title: "Late", color: "#ef4444", test: (c) => isLate(c), due: iso(-1) },
        { id: "today", title: "Today", color: "#f97316", test: (c) => c.dueDate === iso(0), due: iso(0) },
        { id: "tomorrow", title: "Tomorrow", color: "#eab308", test: (c) => c.dueDate === iso(1), due: iso(1) },
        {
          id: "week", title: "This week", color: "#3b82f6",
          test: (c) => !!c.dueDate && c.dueDate > iso(1) && c.dueDate <= iso(7), due: iso(7),
        },
        { id: "future", title: "Future", test: (c) => !!c.dueDate && c.dueDate > iso(7), due: null },
        { id: "none", title: "No date", test: (c) => !c.dueDate, due: null },
      ];
      return buckets.map((b) => ({
        id: `due:${b.id}`,
        title: b.title,
        color: b.color,
        // completed cards with a past date should not land in "Late"
        cards: sorted.filter((c) =>
          b.id === "future" ? b.test(c) || (!!c.dueDate && c.dueDate < iso(0) && !isLate(c)) : b.test(c),
        ),
        patch: b.id === "future" ? null : () => ({ dueDate: b.due }),
      }));
    }
  }
}

export function colorFor(name: string): string {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("") || "?";

export const checklistStats = (c: Card) => ({
  done: c.checklist.filter((i) => i.done).length,
  total: c.checklist.length,
});

export const timeAgo = (ts: number) => {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)}d ago`;
  return format(ts, "MMM d, yyyy");
};

// ---- Recurrence ----
export const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** The next date after `fromDate` (yyyy-MM-dd) that the rule produces, or null past `until`. */
export function nextRecurrenceDate(r: Recurrence, fromDate: string): string | null {
  const base = parseISO(fromDate);
  const n = Math.max(1, r.interval);
  let next: Date | null = null;
  if (r.freq === "daily") next = addDays(base, n);
  else if (r.freq === "monthly") next = addMonths(base, n);
  else if (r.freq === "yearly") next = addYears(base, n);
  else if (r.weekdays.length === 0) next = addDays(base, 7 * n);
  else {
    const week0 = startOfWeek(base);
    for (let i = 1; i <= 7 * n + 7 && !next; i++) {
      const d = addDays(base, i);
      const weeks = Math.round(differenceInCalendarDays(startOfWeek(d), week0) / 7);
      if (weeks % n === 0 && r.weekdays.includes(d.getDay())) next = d;
    }
  }
  if (!next) return null;
  const iso = toISO(next);
  return r.until && iso > r.until ? null : iso;
}

export function describeRecurrence(r: Recurrence): string {
  const n = Math.max(1, r.interval);
  const unit = { daily: "day", weekly: "week", monthly: "month", yearly: "year" }[r.freq];
  let s = n === 1 ? { daily: "Daily", weekly: "Weekly", monthly: "Monthly", yearly: "Yearly" }[r.freq] : `Every ${n} ${unit}s`;
  if (r.freq === "weekly" && r.weekdays.length) {
    const days = [...r.weekdays].sort();
    s += days.join() === "1,2,3,4,5" ? " on weekdays" : ` on ${days.map((d) => WEEKDAYS[d]).join(", ")}`;
  }
  if (r.until) s += ` until ${prettyDate(r.until)}`;
  return s;
}

export const RECURRENCE_PRESETS: { name: string; rule: Recurrence | null }[] = [
  { name: "Does not repeat", rule: null },
  { name: "Daily", rule: { freq: "daily", interval: 1, weekdays: [], until: null } },
  { name: "Weekdays", rule: { freq: "weekly", interval: 1, weekdays: [1, 2, 3, 4, 5], until: null } },
  { name: "Weekly", rule: { freq: "weekly", interval: 1, weekdays: [], until: null } },
  { name: "Every 2 weeks", rule: { freq: "weekly", interval: 2, weekdays: [], until: null } },
  { name: "Monthly", rule: { freq: "monthly", interval: 1, weekdays: [], until: null } },
  { name: "Yearly", rule: { freq: "yearly", interval: 1, weekdays: [], until: null } },
];

// ---- Links ----
export const LINK_TYPES: { id: LinkType; name: string; inverse: LinkType }[] = [
  { id: "relates", name: "Related to", inverse: "relates" },
  { id: "blocks", name: "Blocks", inverse: "blockedBy" },
  { id: "blockedBy", name: "Blocked by", inverse: "blocks" },
];
export const inverseLink = (t: LinkType) => LINK_TYPES.find((l) => l.id === t)!.inverse;
export const linkName = (t: LinkType) => LINK_TYPES.find((l) => l.id === t)!.name;

/** True when the card is blocked by at least one card that isn't completed yet. */
export const isBlocked = (c: Card, cards: Record<string, Card>) =>
  c.links.some((l) => l.type === "blockedBy" && cards[l.cardId] && cards[l.cardId].progress !== "completed");

// ---- Time tracking ----
export const trackedMs = (c: Card, now = Date.now()) =>
  c.time.reduce((sum, t) => sum + ((t.end ?? now) - t.start), 0);

export function formatDuration(ms: number, withSeconds = false): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (withSeconds) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  if (h === 0) return `${m}m`;
  return m ? `${h}h ${m}m` : `${h}h`;
}

/** Parses "1h30m", "1.5h", "45m", "90" (minutes), "1:30". Returns minutes or null. */
export function parseDuration(input: string): number | null {
  const s = input.trim().toLowerCase().replace(/\s+/g, "");
  if (!s) return null;
  const colon = s.match(/^(\d+):(\d{1,2})$/);
  if (colon) return +colon[1] * 60 + +colon[2];
  if (/^\d+(\.\d+)?$/.test(s)) return Math.round(+s);
  const m = s.match(/^(?:(\d+(?:\.\d+)?)h)?(?:(\d+)m)?$/);
  if (!m || (!m[1] && !m[2])) return null;
  return Math.round((m[1] ? +m[1] * 60 : 0) + (m[2] ? +m[2] : 0));
}

// ---- Card aging ----
/** 0 = fresh, 1 = a week untouched, 2 = two weeks, 3 = four weeks+. */
export function agingLevel(c: Card): 0 | 1 | 2 | 3 {
  if (c.progress === "completed") return 0;
  const days = (Date.now() - c.updatedAt) / 86_400_000;
  return days >= 28 ? 3 : days >= 14 ? 2 : days >= 7 ? 1 : 0;
}

// ---- Board customization presets ----
export const GRADIENTS = [
  "linear-gradient(135deg, #2580c3 0%, #4fb0ec 100%)",
  "linear-gradient(135deg, #ec6a3f 0%, #f5a35c 100%)",
  "linear-gradient(135deg, #1f2937 0%, #4b5563 100%)",
  "linear-gradient(135deg, #6366f1 0%, #a855f7 100%)",
  "linear-gradient(135deg, #0f766e 0%, #22c55e 100%)",
  "linear-gradient(135deg, #be185d 0%, #f97316 100%)",
  "linear-gradient(135deg, #0ea5e9 0%, #22d3ee 50%, #a7f3d0 100%)",
  "linear-gradient(160deg, #0b1020 0%, #1e3a8a 60%, #2580c3 100%)",
];
export const BOARD_EMOJIS = [
  "📋", "🚀", "💼", "🏠", "🎧", "🎬", "🎵", "💻", "🛠️", "📈",
  "🎯", "🧪", "📚", "✈️", "💡", "🔥", "🌱", "🎨", "🖥️", "📦",
];

export const fileSize = (n?: number) =>
  n == null ? "" : n < 1024 ? `${n} B` : n < 1024 ** 2 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1024 ** 2).toFixed(1)} MB`;

export const isImage = (name: string, mime?: string) =>
  (mime ?? "").startsWith("image/") || /\.(png|jpe?g|gif|webp|bmp|svg|avif)$/i.test(name);
