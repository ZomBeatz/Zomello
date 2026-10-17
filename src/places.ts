import { invoke } from "@tauri-apps/api/core";
import { isMobileApp } from "./storage";

/**
 * Phones and tablets: one app, several places for boards. "This phone" is the app's own boards; it can
 * also switch to the boards on your computer (Zomello's Phones & tablets access) or a Zomello Server.
 * Switching loads that place's page in the app window, over https only, and remembers it so the app
 * reopens there. Pages from another place get a way back to this phone's boards.
 */

/** Saved in the app's own storage: the place it last showed (an https origin), if not this phone. */
const PLACE_KEY = "zomello-place";
/** Saved by a computer/server page inside the app: where "Boards on this phone" goes back to. */
const HOME_KEY = "zomello-app-home";
const APP_PARAM = "zomello-app";

const read = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const write = (k: string, v: string | null) => {
  try {
    if (v === null) localStorage.removeItem(k);
    else localStorage.setItem(k, v);
  } catch {
    /* private mode: just doesn't remember */
  }
};

/** The https origin from a typed address or a full pairing link (…/#pair=123456). */
export function placeFromInput(text: string): { origin: string; code: string | null } {
  const t = text.trim();
  const code = t.match(/#pair=(\d{6})/)?.[1] ?? null;
  const u = new URL(/^[a-z]+:\/\//i.test(t) ? t : `https://${t}`);
  if (u.protocol !== "https:") throw new Error("Use the https:// address, so your boards travel encrypted.");
  return { origin: u.origin, code };
}

interface AndroidBridge {
  hasLocalNetwork(): boolean;
  requestLocalNetwork(): void;
}
const android = () => (window as unknown as { ZomelloAndroid?: AndroidBridge }).ZomelloAndroid;

/** Is the address on the home network (where Android 17+ wants the "local network" permission)? */
const isLocalAddress = (origin: string) =>
  /^https?:\/\/(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|\[?fe80|[^/:]+\.local(:|$)|[^/.:]+(:|$))/i.test(origin);

/**
 * Android 17+: apps need permission to reach devices on the home network. Asks (once) when it's
 * needed; resolves true when it's allowed (or not needed on this phone).
 */
export async function ensureLocalNetwork(): Promise<boolean> {
  const a = android();
  if (!a || a.hasLocalNetwork()) return true;
  return new Promise((resolve) => {
    const on = (e: Event) => {
      window.removeEventListener("zomello-local-network", on);
      resolve(!!(e as CustomEvent<boolean>).detail);
    };
    window.addEventListener("zomello-local-network", on);
    a.requestLocalNetwork();
  });
}

export const LOCAL_NETWORK_HELP =
  "Zomello needs permission to reach devices on your Wi‑Fi. Allow it in the phone's Settings → Apps → Zomello → Permissions → Nearby devices (or Local network), then try again.";

/** Is the place there, with a certificate this phone trusts? (An opaque reply is enough to know.) */
export async function reachable(origin: string, ms = 4000): Promise<boolean> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    await fetch(`${origin}/zomello-ca.crt`, { mode: "no-cors", cache: "no-store", signal: ctl.signal });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
}

/** Switch the app to another place's boards (optionally pairing with a code from the computer). */
export async function goToPlace(origin: string, pairCode?: string | null): Promise<void> {
  if (isLocalAddress(origin) && !(await ensureLocalNetwork())) throw new Error(LOCAL_NETWORK_HELP);
  const allowed = await invoke<string>("allow_place", { address: origin });
  write(PLACE_KEY, allowed);
  const back = encodeURIComponent(location.origin);
  location.href = `${allowed}/?${APP_PARAM}=${back}${pairCode ? `#pair=${pairCode}` : ""}`;
}

/** Back to the boards stored on this phone. */
export function goToPhone(): void {
  const home = read(HOME_KEY);
  if (home) location.href = `${home}/?local=1`;
}

/** On a computer's or server's page: are we inside the Zomello app (so there's a phone to go back to)? */
export const inZomelloApp = () => !!read(HOME_KEY);

/**
 * Call first thing on start-up.
 *  - In the app's own page: reopen the place it was last on (if it's reachable), unless we just came
 *    back on purpose (?local=1). Returns true when it's leaving, so nothing else needs to start.
 *  - On a computer's or server's page opened by the app: remember the way back.
 */
export async function placeStartup(): Promise<boolean> {
  const params = new URLSearchParams(location.search);
  const home = params.get(APP_PARAM);
  if (home && /^(https?|tauri):\/\/[^/]*localhost(:\d+)?$/.test(home)) write(HOME_KEY, home);
  if (params.has(APP_PARAM) || params.has("local")) {
    params.delete(APP_PARAM);
    const q = params.toString();
    history.replaceState(history.state, "", `${location.pathname}${q ? `?${q}` : ""}${location.hash}`);
  }
  if (!isMobileApp) return false;
  if (new URLSearchParams(location.search).has("local")) {
    write(PLACE_KEY, null);
    history.replaceState(history.state, "", `${location.pathname}${location.hash}`);
    return false;
  }
  const place = read(PLACE_KEY);
  if (!place) return false;
  // Without the local network permission (Android 17+) don't ask at start-up: the message offers
  // "Try again", which asks.
  const needsPermission = isLocalAddress(place) && android() !== undefined && !android()!.hasLocalNetwork();
  if (needsPermission || !(await reachable(place, 3000))) {
    // Computer off, or not on the same Wi-Fi: open this phone's boards and say so.
    sessionStorage.setItem("zomello-place-missed", place);
    return false;
  }
  await goToPlace(place);
  return true;
}

/** The place the app couldn't reach on start-up, if any (for a message on the phone's own page). */
export const missedPlace = () => sessionStorage.getItem("zomello-place-missed");

export const currentPlace = () => (isMobileApp ? read(PLACE_KEY) : null);
export const forgetPlace = () => write(PLACE_KEY, null);
