import { useStore } from "./store";

/**
 * Easter egg #2: the beat pads in Settings → About sing "O", "I" and "A" (synthesized here, no audio
 * files). Play O-I-I-A-I-O, O-I-I-I-A-I and the Party Cat style unlocks.
 */
export type Vowel = "O" | "I" | "A";

const PATTERN: Vowel[] = ["O", "I", "I", "A", "I", "O", "O", "I", "I", "I", "A", "I"];

/** Vocal-tract resonances (formants, Hz) and a high, cat-like pitch for each vowel. */
const VOICES: Record<Vowel, { formants: [number, number, number]; pitch: number }> = {
  O: { formants: [480, 860, 2800], pitch: 540 },
  I: { formants: [320, 2450, 3100], pitch: 660 },
  A: { formants: [820, 1300, 2750], pitch: 600 },
};

let ctx: AudioContext | null = null;

/** Sing one vowel: a buzzy source shaped by three formant filters, with a little vibrato and a slide. */
export function sing(v: Vowel) {
  try {
    ctx ??= new AudioContext();
    const c = ctx;
    void c.resume();
    const t = c.currentTime;
    const { formants, pitch } = VOICES[v];

    const src = c.createOscillator();
    src.type = "sawtooth";
    src.frequency.setValueAtTime(pitch * 1.06, t);
    src.frequency.exponentialRampToValueAtTime(pitch, t + 0.08);
    src.frequency.exponentialRampToValueAtTime(pitch * 0.94, t + 0.32);

    const vib = c.createOscillator();
    const vibDepth = c.createGain();
    vib.frequency.value = 6;
    vibDepth.gain.value = pitch * 0.012;
    vib.connect(vibDepth).connect(src.frequency);

    const out = c.createGain();
    out.gain.setValueAtTime(0.0001, t);
    out.gain.exponentialRampToValueAtTime(0.5, t + 0.02);
    out.gain.exponentialRampToValueAtTime(0.0001, t + 0.34);
    out.connect(c.destination);

    formants.forEach((f, i) => {
      const bp = c.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = f;
      bp.Q.value = f / (60 + i * 40);
      const g = c.createGain();
      g.gain.value = [1, 0.55, 0.22][i];
      src.connect(bp).connect(g).connect(out);
    });

    src.start(t);
    vib.start(t);
    src.stop(t + 0.36);
    vib.stop(t + 0.36);
  } catch {
    /* no audio here; the pads still count */
  }
}

let played: Vowel[] = [];

/** Record a pad press. Returns true when it completes the pattern (and unlocks Party Cat). */
export function padPressed(v: Vowel): boolean {
  sing(v);
  played = [...played, v].slice(-PATTERN.length);
  if (played.length < PATTERN.length || played.some((x, i) => x !== PATTERN[i])) return false;
  played = [];
  const st = useStore.getState();
  const s = st.data.settings;
  const first = !s.unlockedStyles.includes("partycat");
  st.updateSettings({ style: "partycat", unlockedStyles: first ? [...s.unlockedStyles, "partycat"] : s.unlockedStyles });
  st.toast(first ? "🐱 You found Party Cat! Switch styles any time in Settings → Appearance." : "🐱 Party Cat on", { key: "style" });
  confetti();
  return true;
}

/** A short burst of confetti (skipped with Reduce motion). */
export function confetti() {
  const reduce =
    document.documentElement.hasAttribute("data-reducemotion") || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduce) return;
  const colors = ["#b8f53b", "#9d7bff", "#ffd166", "#2ee6c8", "#ff7ab6"];
  const layer = document.createElement("div");
  layer.className = "confetti";
  for (let i = 0; i < 90; i++) {
    const p = document.createElement("i");
    p.style.left = `${Math.random() * 100}%`;
    p.style.background = colors[i % colors.length];
    p.style.animationDelay = `${Math.random() * 0.4}s`;
    p.style.animationDuration = `${1.6 + Math.random() * 1.4}s`;
    p.style.setProperty("--drift", `${(Math.random() - 0.5) * 240}px`);
    p.style.setProperty("--spin", `${(Math.random() - 0.5) * 1080}deg`);
    layer.appendChild(p);
  }
  document.body.appendChild(layer);
  setTimeout(() => layer.remove(), 3400);
}
