import { invoke } from "@tauri-apps/api/core";
import { inTauri } from "./storage";

/**
 * This device's log, for bug reports: errors from the page plus (in the apps) crashes caught by the
 * Rust side. It stays on the device; Settings > About can copy or save it, and Send feedback adds the
 * last lines. The apps keep it in a file (src-tauri/src/logs.rs); a browser keeps the last lines in
 * localStorage.
 */

type Level = "error" | "warn" | "info";

const KEY = "zomello-log";
const KEEP = 200; // lines a browser keeps
const PER_SESSION = 100; // a loop that throws on every frame shouldn't fill the log
let written = 0;

function stamp(): string {
  return new Date().toISOString().replace("T", " ").replace(/\.\d+Z$/, "Z");
}

export function logLine(level: Level, message: string): void {
  if (++written > PER_SESSION) return;
  if (inTauri) {
    void invoke("log_write", { level, message }).catch(() => {});
    return;
  }
  try {
    const lines = (localStorage.getItem(KEY) ?? "").split("\n").filter(Boolean);
    lines.push(`${stamp()} [${level}] ${message.slice(0, 2000).replace(/\n/g, " | ")}`);
    localStorage.setItem(KEY, lines.slice(-KEEP).join("\n"));
  } catch {
    // Storage full or blocked: nothing to do.
  }
}

/** The whole log, oldest first. */
export async function readLog(): Promise<string> {
  if (inTauri) return invoke<string>("log_read").catch(() => "");
  try {
    const text = localStorage.getItem(KEY) ?? "";
    return text ? text + "\n" : "";
  } catch {
    return "";
  }
}

export async function clearLog(): Promise<void> {
  written = 0;
  if (inTauri) return invoke<void>("log_clear").catch(() => {});
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Nothing to clear.
  }
}

/** The last `count` problem lines (errors, warnings, crashes), for a feedback email. */
export async function recentProblems(count = 15): Promise<string[]> {
  const lines = (await readLog()).split("\n").filter((l) => /\] /.test(l));
  const problems = lines.filter((l) => !l.includes("[info]"));
  return problems.slice(-count).map((l) => (l.length > 300 ? l.slice(0, 300) + "…" : l));
}

function describe(e: unknown): string {
  if (e instanceof Error) return `${e.name}: ${e.message}${e.stack ? `\n${e.stack.split("\n").slice(1, 6).join("\n")}` : ""}`;
  return String(e);
}

/** Records uncaught errors and rejected promises. Called once when the page starts. */
export function catchPageErrors(): void {
  window.addEventListener("error", (ev) => {
    const where = ev.filename ? ` (${ev.filename.split("/").pop()}:${ev.lineno}:${ev.colno})` : "";
    logLine("error", ev.error ? describe(ev.error) : `${ev.message}${where}`);
  });
  window.addEventListener("unhandledrejection", (ev) => logLine("error", `Unhandled: ${describe(ev.reason)}`));
}

/** A view that crashed (from ErrorBoundary). */
export function logViewCrash(error: Error, componentStack?: string | null): void {
  const where = componentStack?.trim().split("\n").slice(0, 4).join("\n");
  logLine("error", `View crashed: ${describe(error)}${where ? `\n${where}` : ""}`);
}
