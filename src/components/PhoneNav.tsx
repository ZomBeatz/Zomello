import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight, Smartphone } from "lucide-react";
import { onLinkedDevices, openDeviceWindow, type LinkedDevice } from "../deviceWindow";
import { useStore } from "../store";

/**
 * Desktop app: phones connected right now (same Wi‑Fi, Zomello open), each with its boards. Clicking
 * one opens it in a window that edits the phone's board directly. A phone that goes away disappears
 * from here. Hide a phone's boards in Settings → Phones & tablets.
 */
export function PhoneNav({ collapsed }: { collapsed: boolean }) {
  const [phones, setPhones] = useState<LinkedDevice[]>([]);
  const [shut, setShut] = useState<string[]>([]);
  useEffect(() => onLinkedDevices(setPhones), []);
  if (!phones.length) return null;
  const open = (id: string, board?: string) =>
    void openDeviceWindow(id, board).catch((e) => useStore.getState().toast(String(e instanceof Error ? e.message : e)));

  return (
    <>
      {phones.map((p) => {
        const closed = shut.includes(p.id);
        const cats = [...new Set([...p.boards.map((b) => b.category), ...(p.sections ?? [])].filter((c): c is string => !!c))].sort((a, b) => a.localeCompare(b));
        const row = (b: LinkedDevice["boards"][number]) => (
          <button key={b.id} className="nav-item" title={collapsed ? `${b.title} (on ${p.name})` : `Open on ${p.name}`} onClick={() => open(p.id, b.id)}>
            {b.icon ? <span className="nav-emoji">{b.icon}</span> : <span className="board-dot" style={{ background: b.color }} />}
            <span className="ellipsis label">{b.title}</span>
          </button>
        );
        return (
          <div key={p.id} className="phone-nav">
            <div className="nav-heading phone-nav-head">
              <button className="link-plain row gap-sm grow" onClick={() => setShut(closed ? shut.filter((x) => x !== p.id) : [...shut, p.id])} aria-expanded={!closed} title="Boards on this phone, while it's connected">
                {closed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                <Smartphone size={12} />
                <span className="label ellipsis">{p.name}</span>
              </button>
              <span className="live-dot" title="Connected now" />
            </div>
            {!closed && (
              <div className="nav-boards">
                {p.boards.filter((b) => !b.category).map(row)}
                {!collapsed &&
                  cats.map((c) => (
                    <div key={c} className="nav-category">
                      <div className="nav-category-head static">
                        <span className="grow ellipsis">{c}</span>
                        <span className="count">{p.boards.filter((b) => b.category === c).length}</span>
                      </div>
                      {p.boards.filter((b) => b.category === c).map(row)}
                    </div>
                  ))}
                {p.boards.length === 0 && <p className="muted small place-empty">No boards on it yet</p>}
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}

/** In a phone's window on this computer: whose boards these are. */
export function DeviceBanner({ id }: { id: string }) {
  const [name, setName] = useState("your phone");
  useEffect(() => onLinkedDevices((l) => setName(l.find((d) => d.id === id)?.name ?? "your phone")), [id]);
  return (
    <div className="device-banner" title="Changes here go straight to the phone">
      <Smartphone size={15} /> Boards on {name}
    </div>
  );
}
