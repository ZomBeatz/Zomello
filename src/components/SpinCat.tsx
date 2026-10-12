import { useEffect, useRef } from "react";
import { useStore } from "../store";
import { sing, preloadPads, type Vowel } from "../partyCat";

/**
 * Party Cat's sidebar cat. It mostly sits still, and every so often spins like the meme: random
 * speeds, random lengths, the odd change of direction. Click it for a spin with the song; completing a
 * card gets a celebration spin. Frames come from public/spin-cat.webp (frame 0 = standing, 1–59 = spin).
 */
const FRAMES = 60;
const SPIN_FIRST = 1;
const SPIN_COUNT = FRAMES - SPIN_FIRST;
const SONG: Vowel[][] = [
  ["O", "I", "I", "A", "I", "O"],
  ["O", "I", "I", "I", "A", "I"],
];

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const reducedMotion = () =>
  document.documentElement.hasAttribute("data-reducemotion") || window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function SpinCat({ size = 64 }: { size?: number }) {
  const el = useRef<HTMLButtonElement>(null);
  const state = useRef({
    spinning: false,
    frame: 0,
    pos: 0, // position in the spin, in frames (fractional)
    speed: 0, // frames per second (current)
    target: 0, // frames per second it's heading for
    dir: 1,
    until: 0,
    nextSpin: performance.now() + rand(4000, 9000),
  });

  const spin = (ms: number, speed?: number) => {
    const s = state.current;
    if (reducedMotion()) return;
    s.spinning = true;
    s.until = performance.now() + ms;
    s.target = speed ?? rand(18, 75);
    if (!s.speed) s.speed = s.target * 0.4;
  };

  useEffect(() => {
    void preloadPads();
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const s = state.current;
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      if (!s.spinning && now >= s.nextSpin) spin(rand(700, 3800));
      if (s.spinning) {
        // Now and then mid-spin: a new speed, or a sudden change of direction.
        if (Math.random() < dt * 0.9) s.target = rand(12, 80);
        if (Math.random() < dt * 0.25) s.dir = -s.dir;
        s.speed += (s.target - s.speed) * Math.min(1, dt * 4);
        s.pos = (s.pos + s.dir * s.speed * dt + SPIN_COUNT * 100) % SPIN_COUNT;
        s.frame = SPIN_FIRST + Math.floor(s.pos);
        if (now >= s.until) {
          s.spinning = false;
          s.speed = 0;
          s.frame = 0;
          // Sometimes a quick encore, usually a longer rest.
          s.nextSpin = now + (Math.random() < 0.2 ? rand(400, 1200) : rand(6000, 20000));
        }
      }
      if (el.current) el.current.style.backgroundPosition = `${-s.frame * size}px 0`;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    // Completing a card earns a celebration spin.
    const unsub = useStore.subscribe((st, prev) => {
      if (st.data.cards === prev.data.cards) return;
      for (const id in st.data.cards) {
        const c = st.data.cards[id];
        if (c.progress === "completed" && prev.data.cards[id] && prev.data.cards[id].progress !== "completed") {
          spin(1600, 70);
          break;
        }
      }
    });
    return () => {
      cancelAnimationFrame(raf);
      unsub();
    };
  }, [size]);

  // Click: spin and sing the song, one note per step.
  const party = () => {
    const notes = SONG.flat();
    const step = 175;
    const gap = 260;
    spin(notes.length * step + gap + 300, 60);
    let t = 0;
    SONG.forEach((phrase, p) => {
      phrase.forEach((v) => {
        setTimeout(() => sing(v), t);
        t += step;
      });
      if (p === 0) t += gap;
    });
  };

  return (
    <button
      ref={el}
      className="spin-cat"
      onClick={party}
      title="O-I-I-A-I-O"
      aria-label="Spinning cat"
      style={{ width: size, height: size, backgroundSize: `${FRAMES * size}px ${size}px` }}
    />
  );
}
