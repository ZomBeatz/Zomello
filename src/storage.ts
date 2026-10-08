import { invoke } from "@tauri-apps/api/core";

/** True when running inside the Tauri shell; false in a plain browser (vite dev). */
export const inTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

const LS_KEY = "planwise-data";

export async function loadRaw(): Promise<string | null> {
  if (inTauri) return (await invoke<string | null>("load_data")) ?? null;
  try {
    return localStorage.getItem(LS_KEY);
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

export async function openExternal(target: string): Promise<void> {
  if (inTauri) {
    const { openUrl, openPath } = await import("@tauri-apps/plugin-opener");
    if (/^[a-z][a-z0-9+.-]*:/i.test(target)) return openUrl(target);
    return openPath(target);
  }
  window.open(target, "_blank", "noopener");
}
