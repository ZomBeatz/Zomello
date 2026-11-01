import { useStore } from "../store";

/**
 * The Zomello mark: headphones around kanban columns (same art as app-icon.svg). In the Bass Drop
 * style (an Easter egg) the columns become a neon equalizer and sound waves come off the ear cups.
 */
export function LogoMark({ size = 28, animate = false }: { size?: number; animate?: boolean }) {
  const style = useStore((s) => s.data.settings.style);
  if (style === "bassdrop") return <BassDropMark size={size} animate={animate} />;
  if (style === "partycat") return <PartyCatMark size={size} animate={animate} />;
  if (style === "undead") return <UndeadMark size={size} animate={animate} />;
  return (
    <svg width={size} height={size} viewBox="48 48 928 928" aria-hidden="true">
      <defs>
        <linearGradient id="zm-bg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#232833" />
          <stop offset="1" stopColor="#12151b" />
        </linearGradient>
        <linearGradient id="zm-blue" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#4fb0ec" />
          <stop offset="1" stopColor="#2580c3" />
        </linearGradient>
      </defs>
      <rect x="48" y="48" width="928" height="928" rx="208" fill="url(#zm-bg)" />
      <path d="M 214 600 A 298 298 0 0 1 810 600" fill="none" stroke="#0a0c10" strokeWidth="64" strokeLinecap="round" />
      <path d="M 214 600 A 298 298 0 0 1 810 600" fill="none" stroke="#ec6a3f" strokeWidth="30" strokeLinecap="round" />
      <rect x="196" y="500" width="84" height="264" rx="30" fill="#ec6a3f" />
      <rect x="150" y="522" width="86" height="220" rx="30" fill="#0a0c10" />
      <rect x="744" y="500" width="84" height="264" rx="30" fill="#ec6a3f" />
      <rect x="788" y="522" width="86" height="220" rx="30" fill="#0a0c10" />
      <rect x="334" y="400" width="96" height="364" rx="30" fill="url(#zm-blue)" />
      <rect x="464" y="500" width="96" height="264" rx="30" fill="url(#zm-blue)" opacity=".85" />
      <rect x="594" y="590" width="96" height="174" rx="30" fill="url(#zm-blue)" opacity=".7" />
    </svg>
  );
}

/** Bass Drop: same headphones, neon pink band, and an equalizer (cyan → pink) for columns. */
function BassDropMark({ size, animate }: { size: number; animate: boolean }) {
  return (
    <svg width={size} height={size} viewBox="48 48 928 928" aria-hidden="true" className={`bassdrop-mark ${animate ? "dancing" : ""}`}>
      <defs>
        <linearGradient id="bd-bg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#2a1650" />
          <stop offset="1" stopColor="#0f0a1e" />
        </linearGradient>
        <linearGradient id="bd-eq" x1="0" y1="1" x2="0" y2="0">
          <stop offset="0" stopColor="#22e1ff" />
          <stop offset="1" stopColor="#ff3fa4" />
        </linearGradient>
      </defs>
      <rect x="48" y="48" width="928" height="928" rx="208" fill="url(#bd-bg)" />
      {/* sound waves off the ear cups */}
      <g fill="none" stroke="#22e1ff" strokeWidth="18" strokeLinecap="round" opacity=".85" className="bd-waves">
        <path d="M 112 560 Q 86 632 112 704" />
        <path d="M 912 560 Q 938 632 912 704" />
      </g>
      <path d="M 214 600 A 298 298 0 0 1 810 600" fill="none" stroke="#0a0614" strokeWidth="64" strokeLinecap="round" />
      <path d="M 214 600 A 298 298 0 0 1 810 600" fill="none" stroke="#ff3fa4" strokeWidth="30" strokeLinecap="round" />
      <rect x="196" y="500" width="84" height="264" rx="30" fill="#ff3fa4" />
      <rect x="150" y="522" width="86" height="220" rx="30" fill="#0a0614" />
      <rect x="744" y="500" width="84" height="264" rx="30" fill="#ff3fa4" />
      <rect x="788" y="522" width="86" height="220" rx="30" fill="#0a0614" />
      {/* five equalizer bars instead of three columns */}
      <g fill="url(#bd-eq)" className="bd-bars">
        <rect x="324" y="470" width="62" height="294" rx="24" />
        <rect x="402" y="380" width="62" height="384" rx="24" />
        <rect x="480" y="540" width="62" height="224" rx="24" />
        <rect x="558" y="430" width="62" height="334" rx="24" />
        <rect x="636" y="600" width="62" height="164" rx="24" />
      </g>
    </svg>
  );
}

/**
 * Party Cat: the classic Zomello mark, quietly a cat: tabby ears on the headband and a tail curling
 * out of an ear cup, in the Disco ball colors. It spins like the meme.
 */
function PartyCatMark({ size, animate }: { size: number; animate: boolean }) {
  return (
    <svg width={size} height={size} viewBox="48 48 928 928" aria-hidden="true" className={`partycat-mark ${animate ? "spinning" : ""}`}>
      <defs>
        <linearGradient id="pc-bg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#14263d" />
          <stop offset="1" stopColor="#0a1220" />
        </linearGradient>
        <linearGradient id="pc-bars" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#8ff3ee" />
          <stop offset=".5" stopColor="#3dd6d0" />
          <stop offset="1" stopColor="#1fa7a2" />
        </linearGradient>
      </defs>
      <rect x="48" y="48" width="928" height="928" rx="208" fill="url(#pc-bg)" />
      {/* disco sparkles */}
      <g fill="#eaf8ff">
        <path d="M 170 200 l 10 26 l 26 10 l -26 10 l -10 26 l -10 -26 l -26 -10 l 26 -10 z" opacity=".9" />
        <path d="M 850 180 l 7 18 l 18 7 l -18 7 l -7 18 l -7 -18 l -18 -7 l 18 -7 z" opacity=".75" />
        <circle cx="880" cy="320" r="8" opacity=".6" />
        <circle cx="140" cy="380" r="7" opacity=".5" />
      </g>
      {/* tabby ears */}
      <path d="M 268 420 Q 236 288 262 196 Q 352 246 414 318 Z" fill="#8a847b" stroke="#0a0c10" strokeWidth="16" strokeLinejoin="round" />
      <path d="M 284 378 Q 266 300 280 244 Q 334 280 372 322 Z" fill="#f2a7c3" />
      <path d="M 756 420 Q 788 288 762 196 Q 672 246 610 318 Z" fill="#8a847b" stroke="#0a0c10" strokeWidth="16" strokeLinejoin="round" />
      <path d="M 740 378 Q 758 300 744 244 Q 690 280 652 322 Z" fill="#f2a7c3" />
      <path d="M 214 600 A 298 298 0 0 1 810 600" fill="none" stroke="#0a0c10" strokeWidth="64" strokeLinecap="round" />
      <path d="M 214 600 A 298 298 0 0 1 810 600" fill="none" stroke="#ff5e7e" strokeWidth="30" strokeLinecap="round" />
      <rect x="196" y="500" width="84" height="264" rx="30" fill="#ff5e7e" />
      <rect x="150" y="522" width="86" height="220" rx="30" fill="#0a0c10" />
      <rect x="744" y="500" width="84" height="264" rx="30" fill="#ff5e7e" />
      <rect x="788" y="522" width="86" height="220" rx="30" fill="#0a0c10" />
      <rect x="334" y="400" width="96" height="364" rx="30" fill="url(#pc-bars)" />
      <rect x="464" y="500" width="96" height="264" rx="30" fill="url(#pc-bars)" opacity=".88" />
      <rect x="594" y="590" width="96" height="174" rx="30" fill="url(#pc-bars)" opacity=".76" />
      {/* tail curling up out of the right ear cup */}
      <path d="M 830 752 C 912 752 936 668 900 604 C 880 566 896 520 936 528" fill="none" stroke="#0a0c10" strokeWidth="56" strokeLinecap="round" />
      <path d="M 830 752 C 912 752 936 668 900 604 C 880 566 896 520 936 528" fill="none" stroke="#8a847b" strokeWidth="34" strokeLinecap="round" />
      <path d="M 884 734 L 896 712 M 910 676 L 888 664 M 888 618 L 910 600" stroke="#5c574f" strokeWidth="11" strokeLinecap="round" />
    </svg>
  );
}

/**
 * Undead: the headphones in slime green over a graveyard at night: the columns are tombstones, and a
 * zombie hand claws up out of the ground in the middle. The hand rises on hover.
 */
function UndeadMark({ size, animate }: { size: number; animate: boolean }) {
  const stone = (x: number, y: number) => `M ${x} 764 V ${y + 48} A 48 48 0 0 1 ${x + 96} ${y + 48} V 764 Z`;
  return (
    <svg width={size} height={size} viewBox="48 48 928 928" aria-hidden="true" className={`undead-mark ${animate ? "rising" : ""}`}>
      <defs>
        <linearGradient id="ud-bg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#1b2a20" />
          <stop offset="1" stopColor="#0a110c" />
        </linearGradient>
        <linearGradient id="ud-stone" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#a7ae9c" />
          <stop offset="1" stopColor="#6b7366" />
        </linearGradient>
        <clipPath id="ud-ground">
          <rect x="48" y="48" width="928" height="716" />
        </clipPath>
      </defs>
      <rect x="48" y="48" width="928" height="928" rx="208" fill="url(#ud-bg)" />
      {/* full moon */}
      <circle cx="786" cy="226" r="92" fill="#e8e4c9" opacity=".9" />
      <circle cx="756" cy="204" r="16" fill="#cfcab0" opacity=".7" />
      <circle cx="812" cy="262" r="11" fill="#cfcab0" opacity=".6" />
      <path d="M 214 600 A 298 298 0 0 1 810 600" fill="none" stroke="#050806" strokeWidth="64" strokeLinecap="round" />
      <path d="M 214 600 A 298 298 0 0 1 810 600" fill="none" stroke="#8fd14f" strokeWidth="30" strokeLinecap="round" />
      <rect x="196" y="500" width="84" height="264" rx="30" fill="#8fd14f" />
      <rect x="150" y="522" width="86" height="220" rx="30" fill="#050806" />
      <rect x="744" y="500" width="84" height="264" rx="30" fill="#8fd14f" />
      <rect x="788" y="522" width="86" height="220" rx="30" fill="#050806" />
      {/* tombstones for columns */}
      <path d={stone(334, 440)} fill="url(#ud-stone)" />
      <path d="M 382 520 V 600 M 356 552 H 408" stroke="#4b5246" strokeWidth="14" strokeLinecap="round" />
      <path d={stone(594, 590)} fill="url(#ud-stone)" opacity=".85" />
      {/* the hand, clawing up from the ground */}
      <g clipPath="url(#ud-ground)">
        <g className="ud-hand" fill="#8fbf6a" stroke="#050806" strokeWidth="12" strokeLinejoin="round">
          <path d="M 488 780 L 492 640 L 540 640 L 546 780 Z" />
          <path d="M 470 650 Q 466 590 480 556 L 556 556 Q 566 600 560 650 Z" />
          <rect x="474" y="478" width="22" height="92" rx="11" transform="rotate(-8 485 524)" />
          <rect x="500" y="452" width="22" height="112" rx="11" />
          <rect x="526" y="466" width="22" height="100" rx="11" transform="rotate(6 537 516)" />
          <rect x="548" y="500" width="20" height="74" rx="10" transform="rotate(16 558 537)" />
          <rect x="430" y="574" width="62" height="22" rx="11" transform="rotate(-28 461 585)" />
        </g>
      </g>
      {/* fresh earth */}
      <path d="M 300 772 Q 512 712 724 772 Z" fill="#2c3a25" />
    </svg>
  );
}

export function Wordmark() {
  return (
    <span className="wordmark">
      Zom<span>ello</span>
    </span>
  );
}
