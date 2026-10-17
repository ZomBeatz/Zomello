import { invoke } from "@tauri-apps/api/core";
import { diff, rebaseSnapshot } from "./server";
import { LOOK_KEYS } from "./deviceLook";
import { windowDeviceId } from "./windows";
import type { AppData } from "./types";

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
  try {
    const mine = JSON.parse((await invoke<string | null>("load_data")) ?? "{}");
    for (const k of LOOK_KEYS) if (mine.settings && k in mine.settings) (phone.settings ??= {})[k] = mine.settings[k];
  } catch {
    /* the phone's own look, then */
  }
  return JSON.stringify(phone);
}

export async function loadDeviceData(): Promise<string> {
  const json = await invoke<string | null>("linked_data", { id: windowDeviceId });
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
  await invoke("linked_send", { id: windowDeviceId, ops });
  base = rebaseSnapshot(base, ops);
}

/** The phone sent new data (null: it disconnected). */
export function onDeviceData(cb: (json: string | null) => void): () => void {
  let un: (() => void) | undefined;
  let gone = false;
  void import("@tauri-apps/api/event").then(async ({ listen }) => {
    const u = await listen<{ id: string }>("zomello://linked-changed", async (e) => {
      if (e.payload.id !== windowDeviceId) return;
      const json = await invoke<string | null>("linked_data", { id: windowDeviceId });
      cb(json ? await merged(json) : null);
    });
    if (gone) u();
    else un = u;
  });
  return () => {
    gone = true;
    un?.();
  };
}

export interface LinkedDevice {
  id: string;
  name: string;
  boards: { id: string; title: string; color: string; icon: string | null; category: string | null }[];
  sections: string[] | null;
}

/** Phones connected now (with boards shown on this computer), kept up to date. */
export function onLinkedDevices(cb: (list: LinkedDevice[]) => void): () => void {
  let un: (() => void) | undefined;
  let gone = false;
  const load = () => void invoke<LinkedDevice[]>("linked_devices").then((l) => !gone && cb(l), () => {});
  load();
  void import("@tauri-apps/api/event").then(async ({ listen }) => {
    const u = await listen("zomello://linked-changed", load);
    if (gone) u();
    else un = u;
  });
  return () => {
    gone = true;
    un?.();
  };
}

export const openDeviceWindow = (id: string, board?: string) => invoke("open_device_window", { id, board: board ?? null });
