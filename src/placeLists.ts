import { useEffect, useState } from "react";
import { useStore } from "./store";
import { isMobileApp, waitForAppBridge } from "./storage";
import { inZomelloApp } from "./places";
import { noteSettings } from "./deviceLook";
import { isRemote } from "./remote";
import type { ServerEntry } from "./types";

/**
 * Phones and tablets: the menu shows each place's boards in its own section. Each place's page saves
 * a short list of its boards in the app (src-tauri/src/places.rs) and reads everyone's lists.
 */
export interface PlaceBoard {
  id: string;
  title: string;
  color: string;
  category: string | null;
  starred: boolean;
}
export interface PlaceInfo {
  origin: string;
  name: string;
  kind: "server" | "computer";
}
export interface Places {
  /** "phone", or the origin of the computer/server page we're on. */
  me: string;
  list: PlaceInfo[];
  boards: Record<string, { at: number; boards: PlaceBoard[]; sections?: string[] }>;
}

/** The phone app, or a computer's/server's page inside it. */
export const placesMode = isMobileApp || inZomelloApp();

const call = async <T,>(cmd: string, args?: Record<string, unknown>): Promise<T> => {
  if (!(await waitForAppBridge())) throw new Error("not in the app");
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
};

const CHANGED = "zomello-places-changed";
const announce = () => window.dispatchEvent(new Event(CHANGED));

export function usePlaces(): Places | null {
  const [p, setP] = useState<Places | null>(null);
  useEffect(() => {
    if (!placesMode) return;
    let alive = true;
    const load = () => void call<Places>("places_read").then((v) => alive && setP(v), () => {});
    load();
    window.addEventListener(CHANGED, load);
    const onVisible = () => document.visibilityState === "visible" && load();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      alive = false;
      window.removeEventListener(CHANGED, load);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);
  return p;
}

/**
 * Your computer's page inside the phone app: link the phone with this computer, so the phone's boards
 * show here while both are on the same network. The token comes from the computer (we're signed in to
 * it), and its certificate from this same secure page, so the app trusts exactly this computer.
 */
async function linkWithComputer(): Promise<void> {
  if (!isRemote || isMobileApp) return;
  try {
    const p = await call<{ linked?: string; list: PlaceInfo[] }>("places_read");
    if (p.linked === location.origin || !p.list.some((x) => x.origin === location.origin && x.kind === "computer")) return;
    const res = await fetch("/api/link/token", { method: "POST", credentials: "same-origin" });
    if (!res.ok) return;
    const { token } = (await res.json()) as { token: string };
    const ca = await (await fetch("/zomello-ca.crt", { credentials: "same-origin" })).text();
    await call("places_save_link", { token, ca });
  } catch {
    /* try again next time */
  }
}

/** Keep this place's saved board list (and, in the app's own page, the list of places) up to date. */
export function installPlaceLists(): () => void {
  if (!placesMode) return () => {};
  let timer: ReturnType<typeof setTimeout> | undefined;
  let lastBoards = "";
  let lastList = "";
  const save = () => {
    const d = useStore.getState().data;
    const boards: PlaceBoard[] = Object.values(d.boards)
      .filter((b) => !b.archived)
      .sort((a, b) => a.order - b.order)
      .map((b) => ({ id: b.id, title: b.title, color: b.color, category: b.category ?? null, starred: b.starred }));
    const sections = d.settings.sections ?? [];
    const bj = JSON.stringify([boards, sections]);
    if (bj !== lastBoards) {
      lastBoards = bj;
      void call("places_save_boards", { boards, sections }).then(announce, () => {});
    }
    if (isMobileApp) {
      const list: PlaceInfo[] = (d.settings.servers ?? [])
        .filter((s: ServerEntry) => s.url.startsWith("https://"))
        .map((s) => ({ origin: s.url, name: s.name, kind: s.kind ?? "server" }));
      const lj = JSON.stringify(list);
      if (lj !== lastList) {
        lastList = lj;
        void call("places_save_list", { list }).then(announce, () => {});
      }
    }
  };
  save();
  noteSettings(useStore.getState().data.settings);
  void linkWithComputer();
  const unsub = useStore.subscribe((s, prev) => {
    // The look (theme, style…) belongs to the phone; keep the phone's copy current.
    if (s.data.settings !== prev.data.settings) noteSettings(s.data.settings);
    if (s.data.boards === prev.data.boards && s.data.settings.servers === prev.data.settings.servers && s.data.settings.sections === prev.data.settings.sections) return;
    clearTimeout(timer);
    timer = setTimeout(save, 600);
  });
  return () => {
    clearTimeout(timer);
    unsub();
  };
}
