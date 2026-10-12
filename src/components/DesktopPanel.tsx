import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { AppWindow } from "lucide-react";
import { useStore } from "../store";

/** Settings → Desktop app: keep running in the tray, start at login. */
export function DesktopPanel() {
  const bg = useStore((s) => s.data.settings.runInBackground);
  const [autostart, setAutostart] = useState<boolean | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    void invoke<boolean>("get_autostart").then(setAutostart).catch(() => setAutostart(false));
  }, []);

  const setBackground = async (on: boolean) => {
    setError("");
    try {
      await invoke("set_background_mode", { enabled: on });
      useStore.getState().updateSettings({ runInBackground: on });
      if (on) useStore.getState().toast("Closing the window now keeps Zomello running in the tray");
    } catch (e) {
      setError(String(e));
    }
  };
  const setLogin = async (on: boolean) => {
    setError("");
    try {
      await invoke("set_autostart", { enabled: on });
      setAutostart(on);
    } catch (e) {
      setError(String(e));
    }
  };

  return (
    <section className="panel" id="set-desktop">
      <h3>
        <AppWindow size={15} /> Desktop app
      </h3>
      <label className="check-row">
        <input type="checkbox" checked={bg} onChange={(e) => void setBackground(e.target.checked)} />
        <span>
          Keep running in the tray when I close the window
          <small className="muted">
            Phones and tablets stay connected and reminders keep coming. Open or quit Zomello from its tray icon.
          </small>
        </span>
      </label>
      <label className="check-row">
        <input type="checkbox" checked={!!autostart} disabled={autostart === null} onChange={(e) => void setLogin(e.target.checked)} />
        <span>
          Start Zomello when I log in
          <small className="muted">{bg ? "It starts quietly in the tray." : "Turn on the option above to have it start quietly in the tray."}</small>
        </span>
      </label>
      {error && <p className="small danger-text">{error}</p>}
    </section>
  );
}
