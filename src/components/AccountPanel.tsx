import { useState } from "react";
import { KeyRound, LogOut, UserCog } from "lucide-react";
import { useStore } from "../store";
import { changePassword, loadData, logout, me, updateProfile } from "../server";
import { InlineEdit } from "./ui";

/** Zomello Server: your name, password, and signing out. */
export function AccountPanel() {
  const name = useStore((s) => s.data.settings.me);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);

  return (
    <section className="panel" id="set-account">
      <h3>
        <UserCog size={15} /> Your account
      </h3>
      <div className="field-row">
        <label>Name</label>
        <InlineEdit
          value={name}
          onSave={async (displayName) => {
            try {
              await updateProfile(displayName);
              // Cards assigned to your old name follow the new one.
              useStore.getState().reloadFromServer(await loadData());
              useStore.getState().toast("Name changed everywhere");
            } catch (e) {
              useStore.getState().toast(String(e instanceof Error ? e.message : e));
            }
          }}
        />
      </div>
      <div className="field-row">
        <label>Username</label>
        <span>
          @{me?.username} {me?.isAdmin && <span className="chip small accent">Admin</span>}
        </span>
      </div>
      <form
        className="password-form"
        onSubmit={async (e) => {
          e.preventDefault();
          if (next !== again) return setMsg({ text: "The new passwords don't match.", error: true });
          try {
            await changePassword(current, next);
            setMsg({ text: "Password changed. Your other devices were signed out." });
            setCurrent("");
            setNext("");
            setAgain("");
          } catch (er) {
            setMsg({ text: String(er instanceof Error ? er.message : er), error: true });
          }
        }}
      >
        <span className="step-title">
          <KeyRound size={14} /> Change password
        </span>
        <input type="password" autoComplete="current-password" placeholder="Current password" value={current} onChange={(e) => setCurrent(e.target.value)} />
        <input type="password" autoComplete="new-password" placeholder="New password (8+ characters)" value={next} onChange={(e) => setNext(e.target.value)} />
        <input type="password" autoComplete="new-password" placeholder="New password again" value={again} onChange={(e) => setAgain(e.target.value)} />
        <button className="btn sm" disabled={!current || next.length < 8 || !again}>
          Change password
        </button>
        {msg && <p className={`small ${msg.error ? "danger-text" : "ok-text"}`}>{msg.text}</p>}
      </form>
      <button
        className="btn sm ghost"
        onClick={async () => {
          await logout().catch(() => {});
          location.hash = "";
          location.reload();
        }}
      >
        <LogOut size={14} /> Sign out
      </button>
    </section>
  );
}
