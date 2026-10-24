import { addDays } from "date-fns";
import { isServer } from "./server";
import { useStore } from "./store";
import { isMobileApp, notify } from "./storage";
import type { AppData, Card } from "./types";
import { prettyDate, toISO, todayISO } from "./utils";

/**
 * Notifications:
 *  - a card's own reminder (date + time), once;
 *  - a daily digest of what's late / due today, once a day at the chosen time.
 * On a computer Zomello checks every 30 seconds while it runs. Sent reminders are remembered per-device so
 * restarts don't repeat them. The phone and tablet app hands them to the system ahead of time instead (see
 * `scheduleOnPhone`), so they arrive while Zomello is closed.
 */
const SENT_KEY = "zomello-reminders-sent";
const CHECK_EVERY_MS = 30_000;

function loadSent(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(SENT_KEY) ?? "[]"));
  } catch {
    return new Set();
  }
}
function saveSent(s: Set<string>) {
  try {
    // Keep the list from growing forever.
    localStorage.setItem(SENT_KEY, JSON.stringify([...s].slice(-500)));
  } catch {
    /* not critical */
  }
}

function localNow() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    dateTime: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  };
}

/** Cards that can still remind: not done, not archived, on a board that's still there. */
function liveCards(data: AppData): Card[] {
  return Object.values(data.cards).filter(
    (c) => !c.archived && data.boards[c.boardId] && !data.boards[c.boardId].archived && c.progress !== "completed",
  );
}

function digestText(data: AppData, live: Card[], day: string): string | null {
  const me = data.settings.me;
  const relevant = live.filter((c) => !me || c.assignees.length === 0 || c.assignees.includes(me));
  const late = relevant.filter((c) => !!c.dueDate && c.dueDate < day).length;
  const today = relevant.filter((c) => c.dueDate === day).length;
  if (!late && !today) return null;
  const parts = [today && `${today} due today`, late && `${late} late`].filter(Boolean);
  return `${parts.join(", ")}. Open My Tasks to see them.`;
}

export function checkReminders() {
  const { data, loaded } = useStore.getState();
  if (!loaded || !data.settings.reminders.enabled) return;
  const sent = loadSent();
  const now = localNow();
  const live = liveCards(data);

  for (const c of live) {
    if (!c.reminder || c.reminder > now.dateTime) continue;
    const key = `r:${c.id}:${c.reminder}`;
    if (sent.has(key)) continue;
    sent.add(key);
    const board = data.boards[c.boardId].title;
    void notify(`⏰ ${c.title}`, c.dueDate ? `${board} · due ${prettyDate(c.dueDate)}` : board);
  }

  const r = data.settings.reminders;
  const digestKey = `digest:${todayISO()}`;
  if (r.digest && now.time >= r.digestTime && !sent.has(digestKey)) {
    sent.add(digestKey);
    const text = digestText(data, live, todayISO());
    if (text) void notify("Zomello: your day", text);
  }
  saveSent(sent);
}

// ---- Phones and tablets: scheduled with the system ----
const SCHEDULED_KEY = "zomello-reminders-scheduled";
/** iPhone and iPad keep at most 64 waiting notifications per app; stay under that. */
const MAX_SCHEDULED = 50;
const DIGEST_DAYS = 7;

/** A stable 31-bit id for a notification, so the same reminder keeps the same id. */
function notificationId(key: string): number {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (Math.imul(h, 31) + key.charCodeAt(i)) | 0;
  return (h & 0x7fffffff) || 1;
}

/**
 * Hand the coming reminders to the system: each card's reminder, and the daily digest for the next week (counted
 * from the cards as they are now; opening Zomello recounts). Everything scheduled before is replaced.
 */
export async function scheduleOnPhone(data: AppData) {
  const n = await import("@tauri-apps/plugin-notification");
  let before: number[] = [];
  try {
    before = JSON.parse(localStorage.getItem(SCHEDULED_KEY) ?? "[]");
  } catch {
    /* start over */
  }
  if (before.length) await n.cancel(before).catch(() => {});

  const plan: { key: string; at: Date; title: string; body: string }[] = [];
  const r = data.settings.reminders;
  const now = Date.now();
  if (r.enabled) {
    const live = liveCards(data);
    for (const c of live) {
      if (!c.reminder) continue;
      const at = new Date(c.reminder);
      if (isNaN(+at) || +at <= now) continue;
      const board = data.boards[c.boardId].title;
      plan.push({ key: `r:${c.id}:${c.reminder}`, at, title: `⏰ ${c.title}`, body: c.dueDate ? `${board} · due ${prettyDate(c.dueDate)}` : board });
    }
    if (r.digest) {
      const [hh, mm] = r.digestTime.split(":").map(Number);
      for (let i = 0; i < DIGEST_DAYS; i++) {
        const d = addDays(new Date(), i);
        d.setHours(hh || 0, mm || 0, 0, 0);
        if (+d <= now) continue;
        const text = digestText(data, live, toISO(d));
        if (text) plan.push({ key: `digest:${toISO(d)}`, at: d, title: "Zomello: your day", body: text });
      }
    }
  }
  plan.sort((a, b) => +a.at - +b.at);
  const ids: number[] = [];
  if (plan.length) {
    let ok = await n.isPermissionGranted();
    if (!ok) ok = (await n.requestPermission()) === "granted";
    if (ok) {
      for (const p of plan.slice(0, MAX_SCHEDULED)) {
        const id = notificationId(p.key);
        n.sendNotification({ id, title: p.title, body: p.body, schedule: n.Schedule.at(p.at, false, true), icon: "ic_stat_zomello", iconColor: "#2580C3" });
        ids.push(id);
      }
    }
  }
  try {
    localStorage.setItem(SCHEDULED_KEY, JSON.stringify(ids));
  } catch {
    /* not critical */
  }
}

export function startReminders() {
  // The phone's own boards (not a server opened in the app): let the system deliver them.
  if (isMobileApp && !isServer) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const later = () => (clearTimeout(timer), (timer = setTimeout(() => void scheduleOnPhone(useStore.getState().data).catch(() => {}), 2000)));
    later();
    const unsub = useStore.subscribe((s, prev) => {
      if (s.data !== prev.data) later();
    });
    return () => (clearTimeout(timer), unsub());
  }
  checkReminders();
  const t = setInterval(checkReminders, CHECK_EVERY_MS);
  return () => clearInterval(t);
}
