import { useStore } from "./store";
import { notify } from "./storage";
import { isLate, todayISO } from "./utils";

/**
 * Desktop notifications:
 *  - a card's own reminder (date + time), once;
 *  - a daily digest of what's late / due today, once a day at the chosen time.
 * Sent reminders are remembered per-device so restarts don't repeat them.
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

export function checkReminders() {
  const { data, loaded } = useStore.getState();
  if (!loaded || !data.settings.reminders.enabled) return;
  const sent = loadSent();
  const now = localNow();
  const live = Object.values(data.cards).filter(
    (c) => !c.archived && data.boards[c.boardId] && !data.boards[c.boardId].archived && c.progress !== "completed",
  );

  for (const c of live) {
    if (!c.reminder || c.reminder > now.dateTime) continue;
    const key = `r:${c.id}:${c.reminder}`;
    if (sent.has(key)) continue;
    sent.add(key);
    const board = data.boards[c.boardId].title;
    void notify(`⏰ ${c.title}`, c.dueDate ? `${board} · due ${c.dueDate}` : board);
  }

  const r = data.settings.reminders;
  const digestKey = `digest:${todayISO()}`;
  if (r.digest && now.time >= r.digestTime && !sent.has(digestKey)) {
    sent.add(digestKey);
    const me = data.settings.me;
    const relevant = live.filter((c) => !me || c.assignees.length === 0 || c.assignees.includes(me));
    const late = relevant.filter(isLate).length;
    const today = relevant.filter((c) => c.dueDate === todayISO()).length;
    if (late || today) {
      const parts = [today && `${today} due today`, late && `${late} late`].filter(Boolean);
      void notify("Zomello — your day", `${parts.join(", ")}. Open My Tasks to see them.`);
    }
  }
  saveSent(sent);
}

export function startReminders() {
  checkReminders();
  const t = setInterval(checkReminders, CHECK_EVERY_MS);
  return () => clearInterval(t);
}
