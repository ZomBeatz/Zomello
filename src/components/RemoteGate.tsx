import { useEffect, useState, type ReactNode } from "react";
import { Smartphone, WifiOff } from "lucide-react";
import { guessDeviceName, isRemote, onConnectionChange, remotePair, remoteStatus, UNPAIRED_EVENT } from "../remote";
import { LogoMark } from "./Logo";

type Gate = "checking" | "paired" | "unpaired" | "unreachable";

/** On a phone or tablet: show the pairing screen until this device is paired with the PC. */
export function RemoteGate({ children }: { children: ReactNode }) {
  const [gate, setGate] = useState<Gate>(isRemote ? "checking" : "paired");

  const check = () =>
    remoteStatus()
      .then((s) => setGate(s.paired ? "paired" : "unpaired"))
      .catch(() => setGate("unreachable"));

  useEffect(() => {
    if (!isRemote) return;
    void check();
    const h = () => setGate("unpaired");
    window.addEventListener(UNPAIRED_EVENT, h);
    return () => window.removeEventListener(UNPAIRED_EVENT, h);
  }, []);

  if (gate === "paired") return <>{children}</>;
  if (gate === "checking")
    return (
      <div className="splash">
        <LogoMark size={72} />
      </div>
    );
  if (gate === "unreachable")
    return (
      <div className="pair-screen">
        <WifiOff size={36} className="muted" />
        <h2>Can't reach Zomello on your PC</h2>
        <p className="muted">Make sure the PC is on, Zomello is open, and this device is on the same Wi‑Fi.</p>
        <button className="btn primary" onClick={() => (setGate("checking"), void check())}>
          Try again
        </button>
      </div>
    );
  return <PairForm onPaired={() => location.reload()} />;
}

function PairForm({ onPaired }: { onPaired: () => void }) {
  // Scanning the QR code opens …/#pair=123456; the code is in the fragment, so it never reaches the server.
  const [code, setCode] = useState(() => new URLSearchParams(location.hash.slice(1)).get("pair") ?? "");
  const [name, setName] = useState(guessDeviceName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (location.hash) history.replaceState(null, "", location.pathname);
  }, []);

  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      await remotePair(code.replace(/\D/g, ""), name);
      onPaired();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <form
      className="pair-screen"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <LogoMark size={56} />
      <h2>Connect this device to Zomello</h2>
      <p className="muted">
        On your PC, open <b>Settings → Phones &amp; tablets</b> and choose <b>Pair a device</b>. Enter the code it shows.
      </p>
      <label>
        Pairing code
        <input
          className="pair-code"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={7}
          placeholder="123456"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          autoFocus={!code}
        />
      </label>
      <label>
        Name this device
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
      </label>
      {error && <p className="pair-error">{error}</p>}
      <button className="btn primary" disabled={busy || code.replace(/\D/g, "").length !== 6}>
        <Smartphone size={16} /> {busy ? "Connecting…" : "Connect"}
      </button>
    </form>
  );
}

/** Thin banner while a device has lost its connection to the PC. */
export function ConnectionBanner() {
  const [online, setOnline] = useState(true);
  useEffect(() => (isRemote ? onConnectionChange(setOnline) : undefined), []);
  if (online) return null;
  return (
    <div className="save-error conn-banner">
      <WifiOff size={14} /> Reconnecting to your PC… Changes you make are kept and sent when it's back.
    </div>
  );
}
