import { useStore } from "../store";

/**
 * The Zomello mark: headphones around kanban columns (same art as app-icon.svg). In the Bass Drop
 * style (an Easter egg) the columns become a neon equalizer and sound waves come off the ear cups.
 */
export function LogoMark({ size = 28, animate = false }: { size?: number; animate?: boolean }) {
  const style = useStore((s) => s.data.settings.style);
  if (style === "bassdrop") return <BassDropMark size={size} animate={animate} />;
  if (style === "partycat") return <PartyCatMark size={size} animate={animate} />;
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

/** Party Cat: the headphones grow cat ears and a party hat; lime and violet. It spins like the meme. */
function PartyCatMark({ size, animate }: { size: number; animate: boolean }) {
  return (
    <svg width={size} height={size} viewBox="48 48 928 928" aria-hidden="true" className={`partycat-mark ${animate ? "spinning" : ""}`}>
      <defs>
        <linearGradient id="pc-bg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#221a4d" />
          <stop offset="1" stopColor="#0d0a1f" />
        </linearGradient>
        <linearGradient id="pc-bars" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#b8f53b" />
          <stop offset="1" stopColor="#2ee6c8" />
        </linearGradient>
      </defs>
      <rect x="48" y="48" width="928" height="928" rx="208" fill="url(#pc-bg)" />
      {/* confetti */}
      <g opacity=".9">
        <rect x="150" y="190" width="26" height="12" rx="6" fill="#ffd166" transform="rotate(-25 163 196)" />
        <rect x="840" y="210" width="26" height="12" rx="6" fill="#2ee6c8" transform="rotate(30 853 216)" />
        <circle cx="200" cy="860" r="11" fill="#9d7bff" />
        <circle cx="830" cy="850" r="11" fill="#ff7ab6" />
        <rect x="120" y="470" width="22" height="10" rx="5" fill="#b8f53b" transform="rotate(40 131 475)" />
        <rect x="880" y="430" width="22" height="10" rx="5" fill="#ffd166" transform="rotate(-35 891 435)" />
      </g>
      {/* cat ears on the headband */}
      <path d="M 262 444 L 236 270 L 392 352 Z" fill="#9d7bff" stroke="#0a0614" strokeWidth="18" strokeLinejoin="round" />
      <path d="M 278 400 L 266 318 L 344 360 Z" fill="#ff7ab6" />
      <path d="M 762 444 L 788 270 L 632 352 Z" fill="#9d7bff" stroke="#0a0614" strokeWidth="18" strokeLinejoin="round" />
      <path d="M 746 400 L 758 318 L 680 360 Z" fill="#ff7ab6" />
      <path d="M 214 600 A 298 298 0 0 1 810 600" fill="none" stroke="#0a0614" strokeWidth="64" strokeLinecap="round" />
      <path d="M 214 600 A 298 298 0 0 1 810 600" fill="none" stroke="#9d7bff" strokeWidth="30" strokeLinecap="round" />
      {/* party hat */}
      <path d="M 452 312 L 512 150 L 572 312 Z" fill="#ffd166" stroke="#0a0614" strokeWidth="14" strokeLinejoin="round" />
      <path d="M 478 242 L 546 242 M 466 278 L 558 278" stroke="#ff7ab6" strokeWidth="14" strokeLinecap="round" />
      <circle cx="512" cy="146" r="24" fill="#b8f53b" stroke="#0a0614" strokeWidth="10" />
      <rect x="196" y="500" width="84" height="264" rx="30" fill="#9d7bff" />
      <rect x="150" y="522" width="86" height="220" rx="30" fill="#0a0614" />
      <rect x="744" y="500" width="84" height="264" rx="30" fill="#9d7bff" />
      <rect x="788" y="522" width="86" height="220" rx="30" fill="#0a0614" />
      <rect x="334" y="400" width="96" height="364" rx="30" fill="url(#pc-bars)" />
      <rect x="464" y="500" width="96" height="264" rx="30" fill="url(#pc-bars)" opacity=".88" />
      <rect x="594" y="590" width="96" height="174" rx="30" fill="url(#pc-bars)" opacity=".76" />
      {/* whiskers */}
      <g stroke="#e9e3ff" strokeWidth="9" strokeLinecap="round" opacity=".75">
        <path d="M 124 610 L 60 594 M 124 640 L 62 652" />
        <path d="M 900 610 L 964 594 M 900 640 L 962 652" />
      </g>
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
