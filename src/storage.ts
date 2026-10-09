import { convertFileSrc, invoke } from "@tauri-apps/api/core";

/** True when running inside the Tauri shell; false in a plain browser (vite dev). */
export const inTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

const LS_KEY = "zomello-data";
const LEGACY_LS_KEY = "planwise-data";

export async function loadRaw(): Promise<string | null> {
  if (inTauri) {
    const raw = (await invoke<string | null>("load_data")) ?? null;
    dataDir = (await invoke<string>("data_location")).replace(/[\\/][^\\/]+$/, "");
    return raw;
  }
  try {
    return localStorage.getItem(LS_KEY) ?? localStorage.getItem(LEGACY_LS_KEY);
  } catch {
    return null;
  }
}

export async function saveRaw(json: string): Promise<void> {
  if (inTauri) return invoke("save_data", { data: json });
  try {
    localStorage.setItem(LS_KEY, json);
  } catch {
    /* storage unavailable: nothing else we can do in a browser */
  }
}

/** Returns the path written (Tauri) or the downloaded file name (browser). */
export async function exportFile(json: string, fileName: string): Promise<string> {
  if (inTauri) return invoke<string>("export_data", { data: json, fileName });
  const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: fileName });
  a.click();
  URL.revokeObjectURL(url);
  return fileName;
}

export interface BackupInfo {
  timestamp: number;
  size: number;
}

export async function listBackups(): Promise<BackupInfo[]> {
  return inTauri ? invoke<BackupInfo[]>("list_backups") : [];
}

export async function readBackup(timestamp: number): Promise<string> {
  return invoke<string>("read_backup", { timestamp });
}

export async function dataLocation(): Promise<string> {
  return inTauri ? invoke<string>("data_location") : "Browser localStorage (dev mode)";
}

/** file:///home/me/My%20File.jpg → /home/me/My File.jpg (Windows: file:///C:/x → C:/x). */
export function fileUrlToPath(u: string): string {
  const p = decodeURIComponent(u.replace(/^file:\/\/(localhost)?/i, ""));
  return /^\/[A-Za-z]:\//.test(p) ? p.slice(1) : p;
}

export async function openExternal(target: string): Promise<void> {
  if (/^file:/i.test(target)) target = fileUrlToPath(target);
  if (inTauri) {
    const { openUrl, openPath } = await import("@tauri-apps/plugin-opener");
    if (/^[a-z][a-z0-9+.-]*:/i.test(target)) return openUrl(target);
    return openPath(target);
  }
  window.open(target, "_blank", "noopener");
}

// ---- Stored attachments ----
let dataDir = "";

/** Copy a file into Zomello's storage. Returns the value to keep in `Attachment.url`. */
export async function storeFile(file: File): Promise<string> {
  if (inTauri) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    return invoke<string>("save_attachment", bytes, { headers: { "x-name": encodeURIComponent(file.name) } });
  }
  // Browser dev mode: inline as a data URL.
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

/** Copy a file into storage by its path (drops from a file manager only give us the path). */
export async function storeFromPath(path: string): Promise<{ rel: string; name: string; size: number }> {
  return invoke("store_file_from_path", { path });
}

/** Turn a dropped file path into a File (desktop app only). */
export async function fileFromPath(path: string): Promise<File> {
  const buf = await invoke<ArrayBuffer>("read_dropped_file", { path });
  return new File([buf], path.split(/[\\/]/).pop() || "file");
}

/** URL the webview can display for a stored file (images, previews). */
export function storedSrc(url: string): string {
  if (!inTauri || url.startsWith("data:")) return url;
  return convertFileSrc(`${dataDir}/${url}`);
}

/** Open a stored file with the system's default app. */
export async function openStored(url: string): Promise<void> {
  if (!inTauri) return void window.open(url, "_blank", "noopener");
  const abs = await invoke<string>("attachment_abs_path", { rel: url });
  const { openPath } = await import("@tauri-apps/plugin-opener");
  return openPath(abs);
}

/** Delete stored files that nothing references any more. Returns how many were removed. */
export async function cleanupStoredFiles(referenced: Set<string>): Promise<number> {
  if (!inTauri) return 0;
  const all = await invoke<string[]>("list_attachments");
  const orphans = all.filter((p) => !referenced.has(p));
  for (const rel of orphans) await invoke("delete_attachment", { rel });
  return orphans.length;
}

// ---- Notifications ----
export async function notify(title: string, body: string): Promise<void> {
  if (inTauri) {
    const n = await import("@tauri-apps/plugin-notification");
    let ok = await n.isPermissionGranted();
    if (!ok) ok = (await n.requestPermission()) === "granted";
    if (ok) n.sendNotification({ title, body });
    return;
  }
  if (!("Notification" in window)) return;
  if (Notification.permission === "default") await Notification.requestPermission();
  if (Notification.permission === "granted") new Notification(title, { body });
}

/** Temporary drag & drop diagnostics (written to debug.log next to the data file). */
export function debugLog(...parts: unknown[]) {
  const line = parts.map((p) => (typeof p === "string" ? p : JSON.stringify(p))).join(" ");
  console.debug("[zomello]", line);
  if (inTauri) void invoke("debug_log", { line }).catch(() => {});
}
