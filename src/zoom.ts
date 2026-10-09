import { useStore } from "./store";
import { inTauri } from "./storage";

export const ZOOM_MIN = 0.5;
export const ZOOM_MAX = 2;
const STEP = 0.1;

const clamp = (z: number) => Math.round(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z)) * 100) / 100;

/** Apply zoom natively in the desktop app (keeps clicks and menus aligned); CSS zoom in the browser. */
export async function applyZoom(z: number) {
  if (inTauri) {
    const { getCurrentWebview } = await import("@tauri-apps/api/webview");
    await getCurrentWebview().setZoom(z);
  } else {
    document.documentElement.style.setProperty("zoom", String(z));
  }
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;
export function setZoom(z: number) {
  const st = useStore.getState();
  const next = clamp(z);
  if (next === st.data.settings.zoom) return;
  st.updateSettings({ zoom: next });
  // One toast for a burst of wheel steps.
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => st.toast(`Zoom ${Math.round(next * 100)}%  ·  Ctrl+0 to reset`, { key: "zoom" }), 250);
}
export const zoomBy = (delta: number) => setZoom(useStore.getState().data.settings.zoom + delta);

/** Ctrl + mouse wheel, Ctrl +/-, Ctrl 0. */
export function installZoomControls() {
  let acc = 0;
  const onWheel = (e: WheelEvent) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    // Trackpads send many small deltas; step once per ~100px of scrolling.
    acc += e.deltaY;
    if (Math.abs(acc) >= 50) {
      zoomBy(acc < 0 ? STEP : -STEP);
      acc = 0;
    }
  };
  const onKey = (e: KeyboardEvent) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    if (e.key === "=" || e.key === "+") zoomBy(STEP);
    else if (e.key === "-" || e.key === "_") zoomBy(-STEP);
    else if (e.key === "0") setZoom(1);
    else return;
    e.preventDefault();
  };
  window.addEventListener("wheel", onWheel, { passive: false });
  window.addEventListener("keydown", onKey);
  return () => {
    window.removeEventListener("wheel", onWheel);
    window.removeEventListener("keydown", onKey);
  };
}
