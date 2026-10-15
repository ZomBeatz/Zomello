import { useStore } from "./store";

/**
 * Easter egg #2: the beat pads in Settings → About sing "O", "I" and "A" (short clips in
 * public/sounds; a synthesized voice if they can't play). Play O-I-I-A-I-O-I-I-I-A-I-I and the
 * Party Cat style unlocks.
 */
export type Vowel = "O" | "I" | "A";

const PATTERN: Vowel[] = ["O", "I", "I", "A", "I", "O", "I", "I", "I", "A", "I", "I"];

/** Vocal-tract resonances (formants, Hz) and a high, cat-like pitch for each vowel. */
const VOICES: Record<Vowel, { formants: [number, number, number]; pitch: number }> = {
  O: { formants: [480, 860, 2800], pitch: 540 },
  I: { formants: [320, 2450, 3100], pitch: 660 },
  A: { formants: [820, 1300, 2750], pitch: 600 },
};

let ctx: AudioContext | null = null;
const CLIPS: Record<Vowel, string> = { O: "/sounds/pad-1.wav", I: "/sounds/pad-2.wav", A: "/sounds/pad-3.wav" };
const buffers: Partial<Record<Vowel, AudioBuffer>> = {};
let loading: Promise<void> | null = null;

function audio(): AudioContext | null {
  try {
    ctx ??= new AudioContext();
    return ctx;
  } catch {
    return null;
  }
}

/** Load the three clips once (called when the pads appear, so the first tap plays right away). */
export function preloadPads(): Promise<void> {
  loading ??= (async () => {
    const c = audio();
    if (!c) return;
    await Promise.all(
      (Object.keys(CLIPS) as Vowel[]).map(async (v) => {
        try {
          const res = await fetch(CLIPS[v]);
          buffers[v] = await c.decodeAudioData(await res.arrayBuffer());
        } catch {
          /* falls back to the synthesized voice */
        }
      }),
    );
  })();
  return loading;
}

/** Play one vowel: the recorded clip, or the synthesized voice if the clip isn't available. */
export function sing(v: Vowel) {
  const c = audio();
  if (!c) return;
  void c.resume();
  const buf = buffers[v];
  if (buf) {
    const src = c.createBufferSource();
    src.buffer = buf;
    src.connect(c.destination);
    src.start();
    return;
  }
  void preloadPads();
  synth(c, v);
}

/** The fallback voice: a buzzy source shaped by three formant filters, with a little vibrato and a slide. */
function synth(c: AudioContext, v: Vowel) {
  try {
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

/** How many of the latest presses match the start of the pattern (0 = off track). */
function streak(): number {
  for (let n = Math.min(played.length, PATTERN.length); n > 0; n--) {
    const tail = played.slice(-n);
    if (tail.every((x, i) => x === PATTERN[i])) return n;
  }
  return 0;
}

/**
 * Record a pad press. Returns how far along the pattern the latest presses are (so the page can give a
 * little nod), and whether this press finished it (which unlocks Party Cat).
 */
export function padPressed(v: Vowel): { streak: number; done: boolean } {
  sing(v);
  played = [...played, v].slice(-PATTERN.length);
  const n = streak();
  if (n < PATTERN.length) return { streak: n, done: false };
  played = [];
  const st = useStore.getState();
  const s = st.data.settings;
  const first = !s.unlockedStyles.includes("partycat");
  st.updateSettings({ style: "partycat", unlockedStyles: first ? [...s.unlockedStyles, "partycat"] : s.unlockedStyles });
  st.toast(first ? "🐱 You found Party Cat! Switch styles any time in Settings → Appearance." : "🐱 Party Cat on", { key: "style" });
  confetti();
  return { streak: PATTERN.length, done: true };
}

/** A short burst of confetti (skipped with Reduce motion). */
export function confetti() {
  const reduce =
    document.documentElement.hasAttribute("data-reducemotion") || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduce) return;
  const colors = ["#3dd6d0", "#ff5e7e", "#eaf8ff", "#ffd166", "#8ff3ee"];
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
