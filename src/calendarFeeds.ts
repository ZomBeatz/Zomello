import { useEffect, useMemo, useState } from "react";
import { addDays, startOfDay } from "date-fns";
import type { Board, CalendarFeed } from "./types";
import { inTauri } from "./storage";
import { isRemote } from "./remote";
import { isServer } from "./server";
import { toISO } from "./utils";

/**
 * Calendar feeds on a board: read-only events from an iCal (.ics) address, e.g. Google Calendar's
 * "Secret address in iCal format", shown in the board's Calendar view.
 */

export interface FeedEvent {
  title: string;
  start: Date;
  /** Exclusive end; null = a moment. */
  end: Date | null;
  allDay: boolean;
  location?: string;
  feed: CalendarFeed;
}

interface VEvent {
  uid: string;
  summary: string;
  start: Date;
  end: Date | null;
  allDay: boolean;
  location?: string;
  rrule?: Record<string, string>;
  exdates: number[];
  recurrenceId?: number;
  cancelled: boolean;
}

// ---- Parsing ----

const unescapeText = (v: string) => v.replace(/\\n/gi, "\n").replace(/\\([,;\\])/g, "$1");

/** Offset (ms) of a time zone from UTC at a moment. */
function tzOffset(tz: string, utcMs: number): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(utcMs));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second")) - utcMs;
}

/** DTSTART / DTEND / EXDATE values → Date (and whether it's a whole day). */
function parseDate(value: string, params: Record<string, string>): { date: Date; allDay: boolean } | null {
  const m = value.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/);
  if (!m) return null;
  const [, y, mo, d, h, mi, s, z] = m;
  if (h === undefined || params.VALUE === "DATE") return { date: new Date(+y, +mo - 1, +d), allDay: true };
  const utc = Date.UTC(+y, +mo - 1, +d, +h, +mi, +(s ?? 0));
  if (z) return { date: new Date(utc), allDay: false };
  if (params.TZID) {
    try {
      return { date: new Date(utc - tzOffset(params.TZID, utc)), allDay: false };
    } catch {
      /* unknown zone: treat as local time */
    }
  }
  return { date: new Date(+y, +mo - 1, +d, +h, +mi, +(s ?? 0)), allDay: false };
}

export function parseICS(text: string): VEvent[] {
  const lines = text.replace(/\r?\n[ \t]/g, "").split(/\r?\n/);
  const out: VEvent[] = [];
  let ev: Partial<VEvent> | null = null;
  for (const line of lines) {
    if (line === "BEGIN:VEVENT") {
      ev = { exdates: [], summary: "", uid: "", cancelled: false };
      continue;
    }
    if (line === "END:VEVENT") {
      if (ev?.start) out.push(ev as VEvent);
      ev = null;
      continue;
    }
    if (!ev) continue;
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const head = line.slice(0, colon);
    const value = line.slice(colon + 1);
    const [name, ...paramParts] = head.split(";");
    const params: Record<string, string> = {};
    for (const p of paramParts) {
      const [k, v] = p.split("=");
      if (k && v) params[k.toUpperCase()] = v.replace(/^"|"$/g, "");
    }
    switch (name.toUpperCase()) {
      case "UID":
        ev.uid = value;
        break;
      case "SUMMARY":
        ev.summary = unescapeText(value);
        break;
      case "LOCATION":
        ev.location = unescapeText(value);
        break;
      case "STATUS":
        ev.cancelled = value.toUpperCase() === "CANCELLED";
        break;
      case "DTSTART": {
        const d = parseDate(value, params);
        if (d) {
          ev.start = d.date;
          ev.allDay = d.allDay;
        }
        break;
      }
      case "DTEND": {
        const d = parseDate(value, params);
        if (d) ev.end = d.date;
        break;
      }
      case "RRULE":
        ev.rrule = Object.fromEntries(value.split(";").map((kv) => kv.split("=") as [string, string]));
        break;
      case "EXDATE":
        for (const v of value.split(",")) {
          const d = parseDate(v, params);
          if (d) ev.exdates!.push(d.date.getTime());
        }
        break;
      case "RECURRENCE-ID": {
        const d = parseDate(value, params);
        if (d) ev.recurrenceId = d.date.getTime();
        break;
      }
    }
  }
  return out;
}

// ---- Repeating events ----

const DAYS = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

/** Start times of a repeating event that fall in [from, to). Handles the common RRULE forms. */
function occurrences(ev: VEvent, from: Date, to: Date): Date[] {
  const r = ev.rrule!;
  const interval = Math.max(1, Number(r.INTERVAL) || 1);
  const count = r.COUNT ? Number(r.COUNT) : Infinity;
  const until = r.UNTIL ? parseDate(r.UNTIL, {})?.date.getTime() ?? Infinity : Infinity;
  const byDay = r.BYDAY ? r.BYDAY.split(",") : [];
  const byMonthDay = r.BYMONTHDAY ? r.BYMONTHDAY.split(",").map(Number) : [];
  const start = ev.start;
  const time = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), start.getHours(), start.getMinutes(), start.getSeconds());
  const out: Date[] = [];
  let n = 0;
  const take = (d: Date) => {
    if (d < start) return true;
    if (d.getTime() > until || n >= count) return false;
    n++;
    if (d >= from && d < to) out.push(d);
    return d < to;
  };

  for (let k = 0; k < 5000; k++) {
    let batch: Date[] = [];
    if (r.FREQ === "DAILY") batch = [addDays(start, k * interval)];
    else if (r.FREQ === "WEEKLY") {
      const weekStart = addDays(startOfDay(start), -start.getDay() + k * 7 * interval);
      const days = byDay.length ? byDay.map((d) => DAYS.indexOf(d.slice(-2))) : [start.getDay()];
      batch = days.sort((a, b) => a - b).map((i) => time(addDays(weekStart, i)));
    } else if (r.FREQ === "MONTHLY") {
      const y = start.getFullYear();
      const m = start.getMonth() + k * interval;
      if (byDay.length) {
        for (const spec of byDay) {
          const ord = Number(spec.slice(0, -2)) || 0;
          const wd = DAYS.indexOf(spec.slice(-2));
          const matches: Date[] = [];
          for (let d = 1; d <= 31; d++) {
            const dt = new Date(y, m, d);
            if (dt.getMonth() !== ((m % 12) + 12) % 12) break;
            if (dt.getDay() === wd) matches.push(time(dt));
          }
          const pick = ord > 0 ? matches[ord - 1] : ord < 0 ? matches[matches.length + ord] : undefined;
          if (ord === 0) batch.push(...matches);
          else if (pick) batch.push(pick);
        }
      } else {
        for (const md of byMonthDay.length ? byMonthDay : [start.getDate()]) {
          const dt = new Date(y, m, md);
          if (dt.getDate() === md) batch.push(time(dt));
        }
      }
      batch.sort((a, b) => a.getTime() - b.getTime());
    } else if (r.FREQ === "YEARLY") {
      const dt = new Date(start.getFullYear() + k * interval, start.getMonth(), start.getDate());
      if (dt.getDate() === start.getDate()) batch = [time(dt)];
    } else return [];
    let more = true;
    for (const d of batch) if (!(more = take(d))) break;
    if (!more) break;
  }
  return out;
}

/** Every event happening in [from, to), repeating ones expanded and moved/cancelled ones respected. */
export function eventsBetween(events: VEvent[], feed: CalendarFeed, from: Date, to: Date): FeedEvent[] {
  const moved = new Map<string, Set<number>>();
  for (const e of events) if (e.recurrenceId != null) (moved.get(e.uid) ?? moved.set(e.uid, new Set()).get(e.uid)!).add(e.recurrenceId);
  const out: FeedEvent[] = [];
  for (const e of events) {
    const length = e.end ? e.end.getTime() - e.start.getTime() : 0;
    const starts =
      e.rrule && e.recurrenceId == null ? occurrences(e, addDays(from, -60), to) : [e.start];
    for (const s of starts) {
      if (e.cancelled || e.exdates.includes(s.getTime())) continue;
      if (e.rrule && e.recurrenceId == null && moved.get(e.uid)?.has(s.getTime())) continue;
      const end = length ? new Date(s.getTime() + length) : null;
      if ((end ?? s) < from || s >= to) continue;
      out.push({ title: e.summary || "(no title)", start: s, end, allDay: e.allDay, location: e.location, feed });
    }
  }
  return out.sort((a, b) => a.start.getTime() - b.start.getTime());
}

/** Days (yyyy-mm-dd) an event covers, for placing it on a month grid. */
export function eventDays(e: FeedEvent): string[] {
  const days = [toISO(e.start)];
  if (!e.end) return days;
  const last = e.allDay ? addDays(e.end, -1) : e.end;
  for (let d = addDays(startOfDay(e.start), 1); d <= last && days.length < 60; d = addDays(d, 1)) days.push(toISO(d));
  return days;
}

// ---- Fetching (with a short cache) ----

const FRESH_MS = 15 * 60_000;
const cache = new Map<string, { at: number; events: VEvent[] }>();

async function download(boardId: string, feed: CalendarFeed): Promise<string> {
  if (inTauri) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<string>("fetch_calendar", { url: feed.url });
  }
  if (isRemote || isServer) {
    const res = await fetch(`/api/calendar/${encodeURIComponent(boardId)}/${encodeURIComponent(feed.id)}`, { credentials: "same-origin" });
    if (!res.ok) throw new Error((await res.text()) || `${res.status}`);
    return res.text();
  }
  // Browser preview: only works for calendars that allow it (most don't).
  const res = await fetch(feed.url.replace(/^webcal:/, "https:"));
  if (!res.ok) throw new Error(`${res.status}`);
  return res.text();
}

export async function loadFeed(boardId: string, feed: CalendarFeed, force = false): Promise<VEvent[]> {
  const hit = cache.get(feed.url);
  if (hit && !force && Date.now() - hit.at < FRESH_MS) return hit.events;
  const events = parseICS(await download(boardId, feed));
  cache.set(feed.url, { at: Date.now(), events });
  return events;
}

/** A board's feed events in [from, to), refreshed every 15 minutes. `reload()` fetches again now. */
export function useFeedEvents(board: Board, from: Date, to: Date) {
  const feeds = useMemo(() => (board.calendarFeeds ?? []).filter((f) => f.show !== false && f.url), [board.calendarFeeds]);
  const [loaded, setLoaded] = useState<{ feed: CalendarFeed; events: VEvent[] }[]>([]);
  const [errors, setErrors] = useState<{ feed: CalendarFeed; message: string }[]>([]);
  const [tick, setTick] = useState(0);
  const [force, setForce] = useState(false);

  useEffect(() => {
    if (!feeds.length) {
      setLoaded([]);
      setErrors([]);
      return;
    }
    let gone = false;
    void Promise.allSettled(feeds.map((f) => loadFeed(board.id, f, force))).then((rs) => {
      if (gone) return;
      setLoaded(rs.flatMap((r, i) => (r.status === "fulfilled" ? [{ feed: feeds[i], events: r.value }] : [])));
      setErrors(rs.flatMap((r, i) => (r.status === "rejected" ? [{ feed: feeds[i], message: String(r.reason) }] : [])));
      setForce(false);
    });
    const t = setTimeout(() => setTick((n) => n + 1), FRESH_MS);
    return () => {
      gone = true;
      clearTimeout(t);
    };
  }, [feeds, board.id, tick, force]);

  const events = useMemo(() => loaded.flatMap((l) => eventsBetween(l.events, l.feed, from, to)), [loaded, from, to]);
  return { events, errors, reload: () => setForce(true), hasFeeds: feeds.length > 0 };
}
