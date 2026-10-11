import { useEffect, useState } from "react";
import { MouseSensor, TouchSensor, useSensor, useSensors, type SensorDescriptor } from "@dnd-kit/core";

/** Phone-sized screens get the drawer sidebar and one-bucket-at-a-time board (matches styles.css). */
const PHONE_QUERY = "(max-width: 680px)";

export function useIsPhone(): boolean {
  const [phone, setPhone] = useState(() => window.matchMedia(PHONE_QUERY).matches);
  useEffect(() => {
    const mq = window.matchMedia(PHONE_QUERY);
    const h = () => setPhone(mq.matches);
    mq.addEventListener("change", h);
    return () => mq.removeEventListener("change", h);
  }, []);
  return phone;
}

/**
 * Drag sensors for mouse and touch. On touch a drag starts after holding still briefly, so swiping
 * still scrolls the page and the board.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function useDragSensors(distance: number, ...extra: SensorDescriptor<any>[]) {
  return useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
    ...extra,
  );
}

const LONG_PRESS_MS = 450;
const MOVE_SLOP = 10;
const isEditable = (t: EventTarget | null) => t instanceof Element && !!t.closest("input, textarea, select, [contenteditable]");

/**
 * Touch: press and hold, then let go, opens the same right-click menus as on the PC. iPad Safari never
 * fires `contextmenu` for touch, and on Android the native one would collide with dragging, so both are
 * handled here the same way. Text fields keep the system's own menu.
 */
export function installLongPressMenus(): () => void {
  let start: { x: number; y: number; t: number; target: Element } | null = null;
  let moved = false;
  let swallowClickUntil = 0;

  const onStart = (e: TouchEvent) => {
    if (e.touches.length !== 1 || isEditable(e.target)) return void (start = null);
    const p = e.touches[0];
    start = { x: p.clientX, y: p.clientY, t: Date.now(), target: e.target as Element };
    moved = false;
  };
  const onMove = (e: TouchEvent) => {
    if (!start) return;
    const p = e.touches[0];
    if (Math.hypot(p.clientX - start.x, p.clientY - start.y) > MOVE_SLOP) moved = true;
  };
  const onEnd = () => {
    const s = start;
    start = null;
    if (!s || moved || Date.now() - s.t < LONG_PRESS_MS || !s.target.isConnected) return;
    swallowClickUntil = Date.now() + 500;
    s.target.dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: s.x, clientY: s.y, button: 2 }),
    );
  };
  // The browser's own long-press menu (Android) would fire mid-hold, even during a drag: ours replaces it.
  const onNativeMenu = (e: Event) => {
    if (!e.isTrusted || !start || isEditable(e.target)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
  };
  // Lifting the finger after a long press can also count as a tap on what's underneath.
  const onClick = (e: Event) => {
    if (Date.now() < swallowClickUntil) {
      e.preventDefault();
      e.stopImmediatePropagation();
      swallowClickUntil = 0;
    }
  };

  const opts = { capture: true, passive: true } as const;
  window.addEventListener("touchstart", onStart, opts);
  window.addEventListener("touchmove", onMove, opts);
  window.addEventListener("touchend", onEnd, opts);
  const onCancel = () => void (start = null);
  window.addEventListener("touchcancel", onCancel, opts);
  window.addEventListener("contextmenu", onNativeMenu, true);
  window.addEventListener("click", onClick, true);
  return () => {
    window.removeEventListener("touchstart", onStart, opts);
    window.removeEventListener("touchmove", onMove, opts);
    window.removeEventListener("touchend", onEnd, opts);
    window.removeEventListener("touchcancel", onCancel, opts);
    window.removeEventListener("contextmenu", onNativeMenu, true);
    window.removeEventListener("click", onClick, true);
  };
}
