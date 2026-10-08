import { useEffect, useRef, useState } from "react";
import { format } from "date-fns";
import { Download, RotateCcw, Upload, UserPlus, X } from "lucide-react";
import { normalize, useStore } from "../store";
import { dataLocation, exportFile, inTauri, listBackups, readBackup, type BackupInfo } from "../storage";
import { ask, Avatar } from "./ui";

export function SettingsPage() {
  const settings = useStore((s) => s.data.settings);
  const { updateSettings, replaceData } = useStore.getState();
  const [person, setPerson] = useState("");
  const [location, setLocation] = useState("");
  const [backups, setBackups] = useState<BackupInfo[]>([]);
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void dataLocation().then(setLocation);
    void listBackups().then(setBackups).catch(() => setBackups([]));
  }, []);

  const doExport = async () => {
    try {
      const json = JSON.stringify(useStore.getState().data, null, 2);
      const path = await exportFile(json, `planwise-export-${format(new Date(), "yyyy-MM-dd-HHmm")}.json`);
      setMsg({ text: `Exported to ${path}` });
    } catch (e) {
      setMsg({ text: `Export failed: ${e}`, error: true });
    }
  };

  const importJson = async (json: string, source: string) => {
    try {
      const data = normalize(JSON.parse(json));
      const n = Object.keys(data.cards).length;
      if (!(await ask(`Replace ALL current data with ${source} (${Object.keys(data.boards).length} boards, ${n} cards)?`, { okText: "Replace", danger: true })))
        return;
      replaceData(data);
      setMsg({ text: `Loaded ${source}.` });
    } catch (e) {
      setMsg({ text: `Could not import: ${e}`, error: true });
    }
  };

  const addPerson = () => {
    const p = person.trim();
    if (p && !settings.people.includes(p)) updateSettings({ people: [...settings.people, p] });
    setPerson("");
  };

  return (
    <div className="page settings">
      <h1>Settings</h1>

      <section className="panel">
        <h3>Appearance</h3>
        <div className="seg">
          {(["system", "light", "dark"] as const).map((t) => (
            <button key={t} className={settings.theme === t ? "active" : ""} onClick={() => updateSettings({ theme: t })}>
              {t[0].toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>
      </section>

      <section className="panel">
        <h3>People</h3>
        <p className="muted small">People you can assign tasks to. "Me" is used for the Home page.</p>
        <div className="field-row">
          <label>Me</label>
          <select value={settings.me} onChange={(e) => updateSettings({ me: e.target.value })}>
            <option value="">(nobody)</option>
            {settings.people.map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
        </div>
        <div className="row wrap gap-sm">
          {settings.people.map((p) => (
            <span key={p} className="chip">
              <Avatar name={p} size={18} /> {p}
              <button
                className="icon-btn tiny"
                onClick={() => updateSettings({ people: settings.people.filter((x) => x !== p), me: settings.me === p ? "" : settings.me })}
              >
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
        <div className="row gap-sm" style={{ marginTop: 10 }}>
          <input placeholder="Add a person…" value={person} onChange={(e) => setPerson(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addPerson()} />
          <button className="btn sm" onClick={addPerson}>
            <UserPlus size={14} /> Add
          </button>
        </div>
      </section>

      <section className="panel">
        <h3>Data</h3>
        <p className="muted small">
          Everything is stored locally at <code>{location}</code>
        </p>
        <div className="row gap-sm wrap">
          <button className="btn" onClick={doExport}>
            <Download size={14} /> Export JSON
          </button>
          <button className="btn" onClick={() => fileRef.current?.click()}>
            <Upload size={14} /> Import JSON
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) await importJson(await f.text(), f.name);
            }}
          />
        </div>
        {msg && <p className={`small ${msg.error ? "danger-text" : "ok-text"}`}>{msg.text}</p>}
      </section>

      {inTauri && (
        <section className="panel">
          <h3>Automatic backups</h3>
          <p className="muted small">A snapshot is kept every 30 minutes while you work (last 30 kept).</p>
          {backups.length === 0 && <p className="muted small">No backups yet.</p>}
          <ul className="archive-list">
            {backups.map((b) => (
              <li key={b.timestamp}>
                <span className="grow">{format(b.timestamp * 1000, "EEE MMM d, yyyy · HH:mm")}</span>
                <span className="muted small">{(b.size / 1024).toFixed(1)} KB</span>
                <button
                  className="btn sm"
                  onClick={async () => importJson(await readBackup(b.timestamp), `backup from ${format(b.timestamp * 1000, "MMM d HH:mm")}`)}
                >
                  <RotateCcw size={14} /> Restore
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="panel">
        <h3>Keyboard shortcuts</h3>
        <ul className="shortcuts">
          <li><kbd>Ctrl</kbd>+<kbd>K</kbd> Search everything</li>
          <li><kbd>Esc</kbd> Close dialogs</li>
          <li><kbd>Enter</kbd> Add card / checklist item (in inputs)</li>
          <li><kbd>Ctrl</kbd>+<kbd>Enter</kbd> Save note</li>
        </ul>
      </section>
    </div>
  );
}
