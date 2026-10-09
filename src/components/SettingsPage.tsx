import { useEffect, useRef, useState } from "react";
import { format } from "date-fns";
import { Accessibility, Bell, Download, Minus, Plus, Eraser, LayoutTemplate, RotateCcw, Trash2, Upload, UserPlus, X } from "lucide-react";
import type { Settings, ViewMode } from "../types";
import { normalize, useStore } from "../store";
import {
  cleanupStoredFiles, dataLocation, exportFile, inTauri, listBackups, notify, readBackup, type BackupInfo,
} from "../storage";
import { PALETTE } from "../utils";
import { SHORTCUTS } from "../shortcuts";
import { setZoom, ZOOM_MAX, ZOOM_MIN } from "../zoom";
import type { A11ySettings } from "../types";
import { ask, Avatar, InlineEdit } from "./ui";

const A11Y_OPTIONS: { key: keyof A11ySettings; name: string; hint: string }[] = [
  { key: "highContrast", name: "High contrast", hint: "Stronger borders and text; turns off card fading" },
  { key: "reduceMotion", name: "Reduce motion", hint: "No animations (also follows your system setting)" },
  { key: "strongFocus", name: "Strong focus outline", hint: "Thick ring around whatever the keyboard is on" },
  { key: "largerTargets", name: "Larger click targets", hint: "Bigger buttons, checkboxes and menu items" },
  { key: "readableSpacing", name: "Readable spacing", hint: "Extra letter, word and line spacing" },
  { key: "underlineLinks", name: "Underline links", hint: "Make every link stand out without color" },
];

const ACCENTS = ["#2580c3", "#ec6a3f", ...PALETTE.filter((c) => c !== "#0ea5e9")];

export function SettingsPage() {
  const settings = useStore((s) => s.data.settings);
  const templates = useStore((s) => s.data.templates);
  const { updateSettings, replaceData, updateTemplate, deleteTemplate } = useStore.getState();
  const [person, setPerson] = useState("");
  const [location, setLocation] = useState("");
  const [backups, setBackups] = useState<BackupInfo[]>([]);
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const setReminders = (patch: Partial<Settings["reminders"]>) =>
    updateSettings({ reminders: { ...settings.reminders, ...patch } });

  useEffect(() => {
    void dataLocation().then(setLocation);
    void listBackups().then(setBackups).catch(() => setBackups([]));
  }, []);

  const doExport = async () => {
    try {
      const json = JSON.stringify(useStore.getState().data, null, 2);
      const path = await exportFile(json, `zomello-export-${format(new Date(), "yyyy-MM-dd-HHmm")}.json`);
      setMsg({ text: `Exported to ${path}` });
    } catch (e) {
      setMsg({ text: `Export failed: ${e}`, error: true });
    }
  };

  const importJson = async (json: string, source: string) => {
    try {
      const data = normalize(JSON.parse(json));
      const n = Object.keys(data.cards).length;
      if (!(await ask(`Replace ALL current data with ${source} (${Object.keys(data.boards).length} boards, ${n} cards)? You can undo this with Ctrl+Z.`, { okText: "Replace", danger: true })))
        return;
      replaceData(data);
      setMsg({ text: `Loaded ${source}.` });
    } catch (e) {
      setMsg({ text: `Could not import: ${e}`, error: true });
    }
  };

  const cleanup = async () => {
    const d = useStore.getState().data;
    const refs = new Set<string>();
    for (const c of Object.values(d.cards)) for (const a of c.attachments) if (a.stored) refs.add(a.url);
    for (const b of Object.values(d.boards)) if (b.background.type === "image") refs.add(b.background.value);
    try {
      const n = await cleanupStoredFiles(refs);
      setMsg({ text: n ? `Removed ${n} unused file${n === 1 ? "" : "s"}.` : "No unused files found." });
    } catch (e) {
      setMsg({ text: `Cleanup failed: ${e}`, error: true });
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
        <div className="field-row">
          <label>Theme</label>
          <div className="seg">
            {(["system", "light", "dark"] as const).map((t) => (
              <button key={t} className={settings.theme === t ? "active" : ""} onClick={() => updateSettings({ theme: t })}>
                {t[0].toUpperCase() + t.slice(1)}
              </button>
            ))}
          </div>
        </div>
        <div className="field-row">
          <label>Accent</label>
          <div className="swatches">
            <button
              className={`swatch none ${settings.accent === null ? "sel" : ""}`}
              title="Zomello blue (default)"
              style={{ background: "linear-gradient(135deg, #2580c3, #4fb0ec)" }}
              onClick={() => updateSettings({ accent: null })}
            />
            {ACCENTS.map((c) => (
              <button
                key={c}
                className={`swatch ${settings.accent === c ? "sel" : ""}`}
                style={{ background: c }}
                onClick={() => updateSettings({ accent: c })}
              />
            ))}
            <label className="swatch custom" title="Any color">
              <input type="color" value={settings.accent ?? "#2580c3"} onChange={(e) => updateSettings({ accent: e.target.value })} />
            </label>
          </div>
        </div>
        <div className="field-row">
          <label>Density</label>
          <div className="seg">
            {(["compact", "normal", "comfortable"] as const).map((d) => (
              <button key={d} className={settings.density === d ? "active" : ""} onClick={() => updateSettings({ density: d })}>
                {d[0].toUpperCase() + d.slice(1)}
              </button>
            ))}
          </div>
        </div>
        <div className="field-row">
          <label>Week starts on</label>
          <div className="seg">
            <button className={settings.weekStartsOn === 0 ? "active" : ""} onClick={() => updateSettings({ weekStartsOn: 0 })}>
              Sunday
            </button>
            <button className={settings.weekStartsOn === 1 ? "active" : ""} onClick={() => updateSettings({ weekStartsOn: 1 })}>
              Monday
            </button>
          </div>
        </div>
        <div className="field-row">
          <label>New boards open in</label>
          <select value={settings.defaultView} onChange={(e) => updateSettings({ defaultView: e.target.value as ViewMode })}>
            <option value="board">Board view</option>
            <option value="list">List view</option>
            <option value="calendar">Calendar view</option>
            <option value="timeline">Timeline view</option>
          </select>
        </div>
        <p className="muted small">Each board also has its own look — open a board and press Customize (or B).</p>
      </section>

      <section className="panel">
        <h3>
          <Accessibility size={15} /> Accessibility
        </h3>
        <div className="field-row">
          <label>Zoom</label>
          <div className="zoom-control">
            <button className="icon-btn" title="Zoom out (Ctrl −)" onClick={() => setZoom(settings.zoom - 0.1)}>
              <Minus size={15} />
            </button>
            <input
              type="range"
              min={ZOOM_MIN * 100}
              max={ZOOM_MAX * 100}
              step={10}
              value={Math.round(settings.zoom * 100)}
              aria-label="Zoom level"
              onChange={(e) => setZoom(+e.target.value / 100)}
            />
            <button className="icon-btn" title="Zoom in (Ctrl +)" onClick={() => setZoom(settings.zoom + 0.1)}>
              <Plus size={15} />
            </button>
            <span className="zoom-value">{Math.round(settings.zoom * 100)}%</span>
            {settings.zoom !== 1 && (
              <button className="btn sm ghost" onClick={() => setZoom(1)}>
                Reset
              </button>
            )}
          </div>
        </div>
        <p className="muted small">Hold Ctrl and scroll, or use Ctrl + / Ctrl − / Ctrl 0, anywhere in the app.</p>
        <div className="a11y-grid">
          {A11Y_OPTIONS.map((o) => (
            <label key={o.key} className="check-row">
              <input
                type="checkbox"
                checked={settings.a11y[o.key]}
                onChange={(e) => updateSettings({ a11y: { ...settings.a11y, [o.key]: e.target.checked } })}
              />
              <span>
                {o.name}
                <small className="muted">{o.hint}</small>
              </span>
            </label>
          ))}
        </div>
      </section>

      <section className="panel">
        <h3>People</h3>
        <p className="muted small">People you can assign tasks to. "Me" drives My Tasks, Home and reminders.</p>
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
        <h3>
          <Bell size={15} /> Reminders
        </h3>
        <label className="check-row">
          <input type="checkbox" checked={settings.reminders.enabled} onChange={(e) => setReminders({ enabled: e.target.checked })} />
          Desktop notifications
        </label>
        <label className="check-row">
          <input
            type="checkbox"
            checked={settings.reminders.digest}
            disabled={!settings.reminders.enabled}
            onChange={(e) => setReminders({ digest: e.target.checked })}
          />
          Daily summary of late and due-today tasks at
          <input
            type="time"
            value={settings.reminders.digestTime}
            disabled={!settings.reminders.enabled || !settings.reminders.digest}
            onChange={(e) => e.target.value && setReminders({ digestTime: e.target.value })}
          />
        </label>
        <p className="muted small">
          Set a reminder on any card (card → Reminder, or right-click → Remind me). Notifications appear while Zomello is
          running.
        </p>
        <button className="btn sm" onClick={() => void notify("Zomello", "Notifications are working 🎧")}>
          Send a test notification
        </button>
      </section>

      <section className="panel">
        <h3>
          <LayoutTemplate size={15} /> Card templates
        </h3>
        {templates.length === 0 ? (
          <p className="muted small">Open a card and choose “Save as template”. Templates appear under “+ Add card” and in Quick add.</p>
        ) : (
          <ul className="archive-list">
            {templates.map((t) => (
              <li key={t.id}>
                <LayoutTemplate size={15} className="muted" />
                <InlineEdit className="grow" value={t.name} onSave={(name) => updateTemplate(t.id, { name })} />
                <span className="muted small">
                  {t.checklist.length} checklist items · {t.labels.length} labels
                </span>
                <button className="icon-btn danger" title="Delete template" onClick={() => deleteTemplate(t.id)}>
                  <Trash2 size={15} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="panel">
        <h3>Data</h3>
        <p className="muted small">
          Everything is stored locally at <code>{location}</code>. Attached files live in an <code>attachments</code>{" "}
          folder next to it.
        </p>
        <div className="row gap-sm wrap">
          <button className="btn" onClick={doExport}>
            <Download size={14} /> Export JSON
          </button>
          <button className="btn" onClick={() => fileRef.current?.click()}>
            <Upload size={14} /> Import JSON
          </button>
          {inTauri && (
            <button className="btn" onClick={cleanup} title="Delete stored files no card or board uses any more">
              <Eraser size={14} /> Clean up unused files
            </button>
          )}
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
        <ShortcutList />
      </section>
    </div>
  );
}

export function ShortcutList() {
  return (
    <div className="shortcut-groups">
      {SHORTCUTS.map((g) => (
        <div key={g.group}>
          <h4>{g.group}</h4>
          <dl>
            {g.items.map(([k, v]) => (
              <div key={k}>
                <dt>
                  {k.split(/\s{2}or\s{2}/).map((combo, i) => (
                    <span key={i}>
                      {i > 0 && <span className="muted"> or </span>}
                      {combo.split(" ").map((part) => (
                        <kbd key={part}>{part}</kbd>
                      ))}
                    </span>
                  ))}
                </dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
        </div>
      ))}
    </div>
  );
}
