import { useEffect, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { invoke } from "@tauri-apps/api/core";
import { ShieldCheck, Smartphone, Unlink, X } from "lucide-react";
import { useStore } from "../store";
import { ask, InlineEdit, Modal } from "./ui";
import { copyText } from "./Markdown";

interface DeviceInfo {
  id: string;
  name: string;
  created: number;
  last_seen: number;
}
interface RemoteStatus {
  enabled: boolean;
  running: boolean;
  port: number;
  url: string | null;
  secure_url: string | null;
  setup_url: string | null;
  error: string | null;
  devices: DeviceInfo[];
  firewall: { kind: "ufw" | "firewalld" | "windows" | "none"; allowed: boolean; command: string | null };
}
interface PairingInfo {
  code: string;
  url: string;
  qr_svg: string;
  expires_in: number;
}

/** Settings → Phones & tablets (desktop app only): the home-network server, pairing and unlinking. */
export function DevicesPanel() {
  const [st, setSt] = useState<RemoteStatus | null>(null);
  const [pairing, setPairing] = useState<PairingInfo | null>(null);
  const [port, setPort] = useState("");
  const [fwBusy, setFwBusy] = useState(false);

  useEffect(() => {
    const refresh = () => void invoke<RemoteStatus>("remote_status").then(setSt);
    refresh();
    // A device just paired (from its own screen): refresh the list and close the pairing window.
    let un: (() => void) | undefined;
    let gone = false;
    void import("@tauri-apps/api/event").then(({ listen }) =>
      listen("zomello://remote-changed", () => {
        refresh();
        setPairing((p) => {
          if (p) useStore.getState().toast("Device connected");
          return null;
        });
      }).then((u) => (gone ? u() : (un = u))),
    );
    return () => {
      gone = true;
      un?.();
    };
  }, []);

  if (!st) return null;

  const setEnabled = async (enabled: boolean) => {
    const p = Number(port);
    setSt(await invoke<RemoteStatus>("remote_set_enabled", { enabled, port: p >= 1024 && p <= 65535 ? p : null }));
    setPort("");
  };
  const startPairing = async () => {
    try {
      setPairing(await invoke<PairingInfo>("remote_start_pairing"));
    } catch (e) {
      useStore.getState().toast(String(e));
    }
  };
  const unlink = async (d: DeviceInfo) => {
    if (!(await ask(`Unlink “${d.name}”? It's disconnected right away and would need to pair again.`, { okText: "Unlink", danger: true })))
      return;
    setSt(await invoke<RemoteStatus>("remote_unlink", { id: d.id }));
  };

  const openFirewall = async () => {
    setFwBusy(true);
    try {
      setSt(await invoke<RemoteStatus>("remote_open_firewall"));
      useStore.getState().toast("Firewall now lets phones and tablets reach Zomello");
    } catch (e) {
      useStore.getState().toast(`Firewall not changed: ${e}`);
    } finally {
      setFwBusy(false);
    }
  };

  const on = st.enabled && st.running;
  const fw = st.firewall;
  const fwDone = fw.kind === "none" || fw.kind === "windows" || fw.allowed;

  return (
    <section className="panel">
      <h3>
        <Smartphone size={16} /> Phones &amp; tablets
      </h3>
      <p className="muted small">
        Use Zomello from phones and tablets on your home Wi‑Fi, and install it on them as an app. It works while this PC
        is on and Zomello is open; your data stays on this PC, and only devices you pair can connect.
      </p>

      <ol className="setup-steps">
        <li className={on ? "done" : "current"}>
          <div className="step-title">Turn it on</div>
          <label className="row gap-sm">
            <input type="checkbox" checked={st.enabled} onChange={(e) => void setEnabled(e.target.checked)} />
            Allow access from phones and tablets on this network
          </label>
          {st.error && <p className="small danger-text">{st.error}</p>}
          <details className="small muted">
            <summary>Port ({st.port})</summary>
            <label className="row gap-sm">
              Use port
              <input
                className="port-input"
                inputMode="numeric"
                placeholder={String(st.port)}
                value={port}
                onChange={(e) => setPort(e.target.value.replace(/\D/g, ""))}
                onKeyDown={(e) => e.key === "Enter" && st.enabled && void setEnabled(true)}
              />
              <span>(only if something else uses {st.port}; press Enter)</span>
            </label>
          </details>
        </li>

        <li className={!on ? "" : fwDone ? "done" : "current"}>
          <div className="step-title">Let it through this PC's firewall</div>
          {fw.kind === "none" && <p className="small muted">No firewall is blocking it. Nothing to do.</p>}
          {fw.kind === "windows" && (
            <p className="small muted">
              Windows asks the first time it's turned on. Choose <b>Allow</b> (with <b>Private networks</b> ticked). If you
              missed it, set your Wi‑Fi to <b>Private</b> in Windows Settings → Network.
            </p>
          )}
          {(fw.kind === "ufw" || fw.kind === "firewalld") &&
            (fw.allowed ? (
              <p className="small ok-text">Allowed through the firewall ({fw.kind}).</p>
            ) : (
              <>
                <p className="small muted">
                  This PC's firewall ({fw.kind}) blocks phones until you allow Zomello. You'll be asked for your password.
                </p>
                <button className="btn" disabled={!on || fwBusy} onClick={() => void openFirewall()}>
                  <ShieldCheck size={14} /> {fwBusy ? "Waiting for your password…" : "Allow through firewall"}
                </button>
                {fw.command && (
                  <details className="small muted">
                    <summary>Or run it yourself</summary>
                    <code className="copyable" onClick={() => void copyText(fw.command!)} title="Copy">
                      {fw.command}
                    </code>
                  </details>
                )}
              </>
            ))}
        </li>

        <li className={on && fwDone ? (st.devices.length ? "done" : "current") : ""}>
          <div className="step-title">Pair a phone or tablet</div>
          <p className="small muted">
            Scan the QR code with the device. It opens a short setup page there: install this PC's security certificate
            (once per device), then <b>Install app</b> in Chrome or <b>Add to Home Screen</b> on iPhone/iPad.
          </p>
          <button className="btn primary" disabled={!on} onClick={startPairing}>
            <Smartphone size={14} /> Pair a device
          </button>
          {on && st.setup_url && (
            <p className="small muted">
              Already paired, but it says “Not secure” or won't install? Open <code>{st.setup_url}</code> on it.
            </p>
          )}
        </li>
      </ol>

      {st.devices.length > 0 && (
        <ul className="archive-list devices">
          {st.devices.map((d) => (
            <li key={d.id}>
              <Smartphone size={15} className="muted" />
              <span className="grow">
                <InlineEdit
                  value={d.name}
                  onSave={async (name) => name.trim() && setSt(await invoke<RemoteStatus>("remote_rename", { id: d.id, name }))}
                />
                <span className="muted small">
                  Paired {formatDistanceToNow(d.created * 1000, { addSuffix: true })} · last seen{" "}
                  {formatDistanceToNow(d.last_seen * 1000, { addSuffix: true })}
                </span>
              </span>
              <button className="btn sm" onClick={() => void unlink(d)}>
                <Unlink size={14} /> Unlink
              </button>
            </li>
          ))}
        </ul>
      )}

      {pairing && (
        <PairingWindow
          info={pairing}
          onClose={() => {
            void invoke("remote_cancel_pairing");
            setPairing(null);
          }}
        />
      )}
    </section>
  );
}

function PairingWindow({ info, onClose }: { info: PairingInfo; onClose: () => void }) {
  const [left, setLeft] = useState(info.expires_in);
  useEffect(() => {
    const t = setInterval(() => setLeft((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, []);
  const expired = left === 0;
  return (
    <Modal onClose={onClose} width={440} className="pairing">
      <header className="customize-head">
        <h2>Pair a device</h2>
        <button className="icon-btn" onClick={onClose}>
          <X size={18} />
        </button>
      </header>
      <div className="customize-body pairing-body">
        {expired ? (
          <p className="muted">This code expired. Close this and choose Pair a device again.</p>
        ) : (
          <>
            <p className="small">Scan with your phone or iPad camera, on the same Wi‑Fi as this PC:</p>
            {/* Generated by the app itself (qrcode crate), not from user input. */}
            <div className="qr" dangerouslySetInnerHTML={{ __html: info.qr_svg }} />
            <p className="small muted">
              Or open <code>{info.url.replace("https://", "http://").replace(/\/$/, "/setup")}</code> in its browser and enter:
            </p>
            <div className="pair-big-code">
              {info.code.slice(0, 3)} {info.code.slice(3)}
            </div>
            <p className="small muted">
              Expires in {Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")} · works once
            </p>
          </>
        )}
      </div>
    </Modal>
  );
}
