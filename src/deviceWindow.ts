import { invoke } from "@tauri-apps/api/core";
import { diff, rebaseSnapshot } from "./server";
import { LOOK_KEYS } from "./deviceLook";
import { windowDeviceId } from "./windows";
import { isRemote } from "./remote";
import type { AppData } from "./types";

/**
 * Also used by your other devices: a phone or tablet viewing this computer's boards (a page the
 * computer serves) can open another connected device's boards the same way, through the computer
 * (`/api/devices…` in link.rs), when that device shares them.
 */
const viaComputer = isRemote;

async function deviceJson(id: string): Promise<string | null> {
  if (!viaComputer) return invoke<string | null>("linked_data", { id });
  const res = await fetch(`/api/devices/${encodeURIComponent(id)}/data`, { credentials: "same-origin" });
  return res.ok ? res.text() : null;
}

/** Every time a connected device's boards change (or it comes or goes): its id. */
function onLinkedChange(cb: (id: string) => void): () => void {
  if (viaComputer) {
    let es: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let closed = false;
    const connect = () => {
      es = new EventSource("/api/devices/events");
      es.addEventListener("linked", (e) => cb((e as MessageEvent<string>).data));
      es.onerror = () => {
        es?.close();
        if (!closed) retry = setTimeout(connect, 4000);
      };
    };
    connect();
    return () => {
      closed = true;
      clearTimeout(retry);
      es?.close();
    };
  }
  let un: (() => void) | undefined;
  let gone = false;
  void import("@tauri-apps/api/event").then(async ({ listen }) => {
    const u = await listen<{ id: string }>("zomello://linked-changed", (e) => cb(e.payload.id));
    if (gone) u();
    else un = u;
  });
  return () => {
    gone = true;
    un?.();
  };
}

/**
 * This computer's window onto a phone's boards (index.html?device=<id>), while the phone is connected
 * on the same network. The phone sends its data file (src-tauri/src/link.rs); this window shows it with
 * this computer's look, and sends back only what you change here: boards, buckets and cards, card by
 * card, so edits on both at once don't undo each other.
 */
export const DEVICE_OFFLINE = "Your phone isn't connected right now.";

/** The phone's data as it last sent it (what changes here are measured against). */
let base: AppData | null = null;
export const setDeviceBase = (d: AppData) => void (base = d);

/** The phone's data with this computer's look laid over it (theme, style, colors…). */
async function merged(phoneJson: string): Promise<string> {
  const phone = JSON.parse(phoneJson);
  // On another device the look is that device's own (deviceLook.ts lays it over when loading).
  if (viaComputer) return JSON.stringify(phone);
  try {
    const mine = JSON.parse((await invoke<string | null>("load_data")) ?? "{}");
    for (const k of LOOK_KEYS) if (mine.settings && k in mine.settings) (phone.settings ??= {})[k] = mine.settings[k];
  } catch {
    /* the phone's own look, then */
  }
  return JSON.stringify(phone);
}

export async function loadDeviceData(): Promise<string> {
  const json = await deviceJson(windowDeviceId!);
  if (!json) throw new Error(DEVICE_OFFLINE);
  return merged(json);
}

/** Send what changed here to the phone. */
export async function sendDeviceChanges(next: AppData): Promise<void> {
  if (!base) return void (base = next);
  const changes = diff(base, next);
  if (!changes) return;
  const ops = { upserts: changes.upserts, deletes: changes.deletes };
  if (!Object.keys(ops.upserts).length && !Object.keys(ops.deletes).length) {
    base = next; // only this window's view or look changed: nothing for the phone
    return;
  }
  if (viaComputer) {
    const res = await fetch(`/api/devices/${encodeURIComponent(windowDeviceId!)}/ops`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(ops),
    });
    if (!res.ok) throw new Error(DEVICE_OFFLINE);
  } else await invoke("linked_send", { id: windowDeviceId, ops });
  base = rebaseSnapshot(base, ops);
}

/** The phone sent new data (null: it disconnected). */
export function onDeviceData(cb: (json: string | null) => void): () => void {
  return onLinkedChange(async (id) => {
    if (id !== windowDeviceId) return;
    const json = await deviceJson(id);
    cb(json ? await merged(json) : null);
  });
}

export interface LinkedDevice {
  id: string;
  name: string;
  boards: { id: string; title: string; color: string; icon: string | null; category: string | null }[];
  sections: string[] | null;
}

/** Phones connected right now, as last loaded (for menus that are built on the spot). */
export let linkedNow: LinkedDevice[] = [];

/** Phones connected now (with boards shown on this computer), kept up to date. */
export function onLinkedDevices(cb: (list: LinkedDevice[]) => void): () => void {
  let gone = false;
  const fetchList = (): Promise<LinkedDevice[]> =>
    viaComputer
      ? fetch("/api/devices", { credentials: "same-origin" }).then((r) => (r.ok ? r.json() : []))
      : invoke<LinkedDevice[]>("linked_devices");
  const load = () =>
    void fetchList().then((l) => {
      if (!viaComputer) linkedNow = l;
      if (!gone) cb(l);
    }, () => {});
  load();
  const off = onLinkedChange(load);
  return () => {
    gone = true;
    off();
  };
}

/** Desktop: the phone's boards in their own window. Another device: open them in this page. */
export const openDeviceWindow = async (id: string, board?: string) => {
  if (viaComputer) {
    location.href = `/?device=${encodeURIComponent(id)}${board ? `#/board/${encodeURIComponent(board)}` : ""}`;
    return;
  }
  await invoke("open_device_window", { id, board: board ?? null });
};
