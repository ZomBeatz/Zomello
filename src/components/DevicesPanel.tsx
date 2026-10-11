import { useEffect, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { invoke } from "@tauri-apps/api/core";
import { Smartphone, Unlink, X } from "lucide-react";
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
  error: string | null;
  devices: DeviceInfo[];
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

  return (
    <section className="panel">
      <h3>
        <Smartphone size={16} /> Phones &amp; tablets
      </h3>
      <p className="muted small">
        Use Zomello from your phone or iPad on your home Wi‑Fi. It works while this PC is on and Zomello is open; your data
        stays here. Only devices you pair can connect.
      </p>
      <label className="row gap-sm">
        <input type="checkbox" checked={st.enabled} onChange={(e) => void setEnabled(e.target.checked)} />
        Allow access from phones and tablets on this network
      </label>
      {st.enabled && st.running && st.url && (
        <p className="small">
          Running at <code>{st.url}</code>
        </p>
      )}
      {st.error && <p className="small danger-text">{st.error}</p>}
      {st.enabled && st.running && (
        <p className="muted small">
          Device can't connect? Your firewall may be blocking port {st.port}. On Linux with ufw:{" "}
          <code>sudo ufw allow from 192.168.0.0/16 to any port {st.port} proto tcp</code>
        </p>
      )}
      <div className="row gap-sm wrap">
        {st.enabled && st.running && (
          <button className="btn primary" onClick={startPairing}>
            <Smartphone size={14} /> Pair a device
          </button>
        )}
        <label className="row gap-sm small muted">
          Port
          <input
            className="port-input"
            inputMode="numeric"
            placeholder={String(st.port)}
            value={port}
            onChange={(e) => setPort(e.target.value.replace(/\D/g, ""))}
            onKeyDown={(e) => e.key === "Enter" && st.enabled && void setEnabled(true)}
            title="Change only if 7311 is taken. Press Enter to apply."
          />
        </label>
      </div>

      {st.enabled && st.running && st.url && (
        <details className="install-help small">
          <summary>Install it as an app on the phone</summary>
          <p>
            <b>Android (Chrome):</b> Chrome only offers “Install app” on secure addresses, so tell it this one is safe:
          </p>
          <ol>
            <li>
              In Chrome, open <code>chrome://flags/#unsafely-treat-insecure-origin-as-secure</code>
            </li>
            <li>
              Paste <code className="copyable" onClick={() => void copyText(st.url!.replace(/\/$/, ""))} title="Copy">{st.url.replace(/\/$/, "")}</code>{" "}
              into the box, set it to <b>Enabled</b>, then tap <b>Relaunch</b>.
            </li>
            <li>
              Open {st.url}, then <b>⋮ → Install app</b> (or “Add to Home screen” → Install).
            </li>
          </ol>
          <p>
            <b>iPad / iPhone (Safari):</b> Share → <b>Add to Home Screen</b>. It opens full-screen like an app, then pair it once
            more from there.
          </p>
          <p className="muted">
            Tip: give this PC a fixed address in your router (a “DHCP reservation”) so the address above never changes.
          </p>
        </details>
      )}

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
              Or open <code>{info.url}</code> in its browser and enter:
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
