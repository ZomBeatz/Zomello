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

/** On another place's page inside the phone app (where the phone's look applies, not the place's). */
export const lookIsDevices = !isMobileApp && inZomelloApp();
/** The phone app's own page, or another place's page inside it. */
const inPhoneApp = isMobileApp || lookIsDevices;

/** The phone's look as saved in the app, and (on another place's page) that place's own look. */
let device: Look | null = null;
let placeOwn: Look | null = null;

const pick = (s: Partial<Settings>): Look => Object.fromEntries(LOOK_KEYS.filter((k) => k in s).map((k) => [k, s[k]])) as Look;

const call = async <T,>(cmd: string, args?: Record<string, unknown>): Promise<T> => {
  if (!(await waitForAppBridge())) throw new Error("not in the app");
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
};

/** Before the first load: fetch the phone's look (it may have been changed on another place's page). */
export async function loadDeviceLook(): Promise<void> {
  if (!inPhoneApp) return;
  try {
    const v = await call<{ phoneLook?: Look }>("places_read");
    if (v.phoneLook && typeof v.phoneLook === "object") device = pick(v.phoneLook);
  } catch {
    /* not available: the page's own settings it is */
  }
}

/** Data coming in: show it with the phone's look (on another place's page, remembering the place's own). */
export function withDeviceLook(data: AppData): AppData {
  if (!inPhoneApp || !device) return data;
  if (lookIsDevices) placeOwn = pick(data.settings);
  return { ...data, settings: { ...data.settings, ...device } };
}

/** Data going out to another place: with its own look, as it sent it. */
export function withPlaceLook<T extends { settings: Settings }>(data: T): T {
  if (!lookIsDevices || !placeOwn) return data;
  return { ...data, settings: { ...data.settings, ...placeOwn } };
}

const save = (look: Look) => void call("places_save_look", { look }).catch(() => {});

let lastSaved = "";
/** The phone's own page: its settings' look is the phone's look; keep the app's copy current. */
export function noteSettings(s: Settings): void {
  if (!isMobileApp) return;
  const look = pick(s);
  const j = JSON.stringify(look);
  if (j === lastSaved) return;
  lastSaved = j;
  device = look;
  save(look);
}

/**
 * Another place's page inside the app: the look changed by you (Settings, the welcome guide…) is the
 * phone's, not the place's. Anything else that changes there belongs to the place as usual.
 */
export function noteLookPatch(patch: Partial<Settings>, current: Settings): void {
  if (!lookIsDevices) return;
  const changed = pick(patch);
  if (!Object.keys(changed).length) return;
  // First look change here, before the phone had a look of its own: remember the place's, to send back.
  placeOwn ??= pick(current);
  device = { ...pick(current), ...(device ?? {}), ...changed };
  save(device);
}
