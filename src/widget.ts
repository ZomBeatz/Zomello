import { addDays } from "date-fns";
import { myDayLists } from "./myDay";
import { isServer } from "./server";
import { isApplePhoneOrTablet, isMobileApp } from "./storage";
import { useStore } from "./store";
import type { AppData, Card } from "./types";
import { cardSpan, prettyTime, toISO } from "./utils";

/**
 * The My Day home-screen widget (Android; MyDayWidget.kt). This page hands it today's and tomorrow's My Day
 * whenever the boards change, so it's right after midnight too. Taps on the widget open My Day here.
 */
interface WidgetItem {
  title: string;
  /** "10:00 AM", "Late" or "". */
  when: string;
  late: boolean;
  board: string;
}

type Bridge = { updateWidget?(json: string): void; takeOpen?(): string | null };
const bridge = () => (window as unknown as { ZomelloAndroid?: Bridge }).ZomelloAndroid;

function itemsFor(data: AppData, day: Date): WidgetItem[] {
  const { late, scheduled, added } = myDayLists(data, day);
  const item = (c: Card, isLate: boolean): WidgetItem => {
    const s = cardSpan(c);
    const timed = s && !s.allDay && toISO(s.start) === toISO(day);
    return { title: c.title, when: isLate ? "Late" : timed ? prettyTime(c.startTime ?? c.dueTime!) : "", late: isLate, board: data.boards[c.boardId]?.title ?? "" };
  };
  return [...late.map((c) => item(c, true)), ...scheduled.map((c) => item(c, false)), ...added.map((c) => item(c, false))].slice(0, 20);
}

export function widgetData(data: AppData, now = new Date()) {
  const days: Record<string, WidgetItem[]> = {};
  for (const d of [now, addDays(now, 1)]) days[toISO(d)] = itemsFor(data, d);
  return { days, at: Date.now() };
}

/** Android hands the widget its content through MainActivity; iPhone and iPad through the app group (apple_group.rs). */
function writer(): ((json: string) => void) | null {
  const b = bridge();
  if (b?.updateWidget) return (json) => b.updateWidget!(json);
  if (isMobileApp && isApplePhoneOrTablet)
    return (json) => void import("@tauri-apps/api/core").then(({ invoke }) => invoke("widget_update", { json })).catch(() => {});
  return null;
}

export function installWidget(): () => void {
  const b = bridge();
  const write = writer();
  // Only this device's own boards (not a Zomello Server opened in the app).
  if (!write || isServer) return () => {};
  let timer: ReturnType<typeof setTimeout> | undefined;
  let last = "";
  const send = () => {
    const json = JSON.stringify(widgetData(useStore.getState().data));
    // `at` changes every time; compare without it.
    const key = json.replace(/"at":\d+/, "");
    if (key === last) return;
    last = key;
    write(json);
  };
  const later = () => (clearTimeout(timer), (timer = setTimeout(send, 1500)));
  send();
  const unsub = useStore.subscribe((s, prev) => s.data !== prev.data && later());
  // Back from the background on a new day: refresh.
  const onVisible = () => document.visibilityState === "visible" && send();
  document.addEventListener("visibilitychange", onVisible);
  // Tapped the widget: open My Day.
  const open = () => {
    if (b?.takeOpen?.() === "myday") useStore.getState().navigate({ page: "myday" });
  };
  open();
  window.addEventListener("zomello-open", open);
  return () => {
    clearTimeout(timer);
    unsub();
    document.removeEventListener("visibilitychange", onVisible);
    window.removeEventListener("zomello-open", open);
  };
}
