import { useEffect, useState } from "react";
import { KeyRound, X } from "lucide-react";
import { useStore } from "../store";
import { deviceWord } from "../storage";
import type { AppData } from "../types";
import { Modal } from "./ui";

/**
 * Phones and tablets: your computer sent back this device's private boards from a backup, locked with the
 * backup password (see backup.rs). Ask for the password and add them.
 */
export function PrivateRestore() {
  const [blob, setBlob] = useState<string | null>(null);
  const [pw, setPw] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let gone = false;
    let un: (() => void) | undefined;
    const check = async () => {
      const { invoke } = await import("@tauri-apps/api/core");
      const b = await invoke<string | null>("backup_pending", { clear: false }).catch(() => null);
      if (!gone && b) setBlob(b);
    };
    void check();
    void import("@tauri-apps/api/event").then(async ({ listen }) => {
      const u = await listen("zomello://private-backup", () => void check());
      if (gone) u();
      else un = u;
    });
    return () => {
      gone = true;
      un?.();
    };
  }, []);

  if (!blob) return null;
  const done = async (clear: boolean) => {
    if (clear) {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("backup_pending", { clear: true }).catch(() => {});
    }
    setBlob(null);
    setPw("");
    setError("");
  };
  const restore = async () => {
    setBusy(true);
    setError("");
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const json = await invoke<string>("backup_open", { blob, password: pw });
      const n = useStore.getState().restoreBoards(JSON.parse(json) as Pick<AppData, "boards" | "lists" | "cards" | "ui">);
      useStore.getState().toast(n ? `Restored ${n} private ${n === 1 ? "board" : "boards"}` : `Those private boards are already on this ${deviceWord}`);
      await done(true);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal onClose={() => void done(false)} width={440}>
      <header className="customize-head">
        <h2>
          <KeyRound size={18} /> Restore private boards
        </h2>
        <button className="icon-btn" title="Not now" aria-label="Not now" onClick={() => void done(false)}>
          <X size={18} />
        </button>
      </header>
      <form
        className="customize-body"
        onSubmit={(e) => {
          e.preventDefault();
          void restore();
        }}
      >
        <p className="small">
          Your computer sent this {deviceWord}'s private boards from a backup. They're locked: enter the backup password you set to add them
          here.
        </p>
        <input type="password" autoFocus autoComplete="current-password" placeholder="Backup password" value={pw} onChange={(e) => setPw(e.target.value)} />
        {error && <p className="danger-text small">{error}</p>}
        <div className="row gap-sm end">
          <button type="button" className="btn ghost" onClick={() => void done(true)}>
            Don't restore them
          </button>
          <button className="btn primary" disabled={busy || !pw}>
            {busy ? "Opening…" : "Restore"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
