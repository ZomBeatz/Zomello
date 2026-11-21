/**
 * Android app: the sizes of the status bar, notch and navigation bar, from MainActivity (its WebView
 * often reports 0 for env(safe-area-inset-*), which left the menu's bottom under the navigation buttons).
 * They become the --safe-* values in styles.css; other platforms keep env().
 */
type Sides = { top: number; right: number; bottom: number; left: number };

const android = () => (window as unknown as { ZomelloAndroid?: { insets?(): string } }).ZomelloAndroid;

function apply() {
  const raw = android()?.insets?.();
  if (!raw) return;
  try {
    const sides = JSON.parse(raw) as Sides;
    const root = document.documentElement.style;
    for (const side of ["top", "right", "bottom", "left"] as const)
      root.setProperty(`--safe-${side}`, `max(env(safe-area-inset-${side}, 0px), ${Math.round(sides[side] ?? 0)}px)`);
  } catch {
    // Keep env().
  }
}

export function watchAndroidInsets(): void {
  if (!android()?.insets) return;
  apply();
  window.addEventListener("zomello-insets", apply);
}
