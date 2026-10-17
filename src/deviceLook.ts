import type { AppData, Settings } from "./types";
import { isMobileApp, waitForAppBridge } from "./storage";
import { inZomelloApp } from "./places";

/**
 * Phones and tablets keep their own look. Your computer's (or a server's) boards shown in the phone app
 * come with that place's settings, theme included; the phone's look is laid over them on the way in and
 * the place's own put back on the way out, so neither changes the other. Changing the look while on
 * another place's boards changes the phone's.
 */
export const LOOK_KEYS = ["theme", "style", "accent", "density", "a11y", "unlockedStyles", "catSings"] as const;
type Look = Partial<Pick<Settings, (typeof LOOK_KEYS)[number]>>;

/** On another place's page inside the phone app (where the phone's look applies). */
export const lookIsDevices = !isMobileApp && inZomelloApp();

/** The phone's look (when lookIsDevices), and the place's own look values to send back unchanged. */
let device: Look | null = null;
let placeOwn: Look | null = null;

const pick = (s: Partial<Settings>): Look => Object.fromEntries(LOOK_KEYS.filter((k) => k in s).map((k) => [k, s[k]])) as Look;

const call = async <T,>(cmd: string, args?: Record<string, unknown>): Promise<T> => {
  if (!(await waitForAppBridge())) throw new Error("not in the app");
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
};

/** Before the first load on another place's page: fetch the phone's look. */
export async function loadDeviceLook(): Promise<void> {
  if (!lookIsDevices) return;
  try {
    const v = await call<{ look?: Look }>("places_read");
    if (v.look && typeof v.look === "object") device = pick(v.look);
  } catch {
    /* not available: the place's own look it is */
  }
}

/** Data coming in from the place: show it with the phone's look (remembering the place's own). */
export function withDeviceLook(data: AppData): AppData {
  if (!lookIsDevices || !device) return data;
  placeOwn = pick(data.settings);
  return { ...data, settings: { ...data.settings, ...device } };
}

/** Data going out to the place: with its own look, as it sent it. */
export function withPlaceLook<T extends { settings: Settings }>(data: T): T {
  if (!lookIsDevices || !device || !placeOwn) return data;
  return { ...data, settings: { ...data.settings, ...placeOwn } };
}

let lastSaved = "";
/**
 * Settings changed: if the look did, it's the phone's (on the phone's own page, or on another place's
 * page inside the app), so save it for every page to use.
 */
export function noteSettings(s: Settings): void {
  if (!isMobileApp && !lookIsDevices) return;
  const look = pick(s);
  const j = JSON.stringify(look);
  if (j === lastSaved) return;
  lastSaved = j;
  if (lookIsDevices) device = look;
  void call("places_save_look", { look }).catch(() => {});
}
