import { useStore } from "./store";
import { notify } from "./storage";

/** A short three-note chime made with WebAudio (no sound files needed). */
export function playChime() {
  try {
    const ctx = new AudioContext();
    [0, 0.22, 0.44].forEach((t, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = [880, 1108.7, 1318.5][i];
      gain.gain.setValueAtTime(0.0001, ctx.currentTime + t);
      gain.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + t + 0.5);
      osc.connect(gain).connect(ctx.destination);
      osc.start(ctx.currentTime + t);
      osc.stop(ctx.currentTime + t + 0.55);
    });
    setTimeout(() => void ctx.close(), 1500);
  } catch {
    /* audio unavailable */
  }
}

/** Ends the focus countdown when it reaches zero (also catches up after sleep / reload). */
export function startFocusWatcher() {
  const tick = () => {
    const st = useStore.getState();
    const f = st.focus;
    if (!f?.endsAt || f.endsAt > Date.now()) return;
    st.endFocus(true);
    if (st.data.settings.focusSound) playChime();
    void notify("Time's up", `${f.label}: ${Math.round(f.durationMs / 60_000)} minutes done.`);
  };
  tick();
  const t = setInterval(tick, 1000);
  return () => clearInterval(t);
}
