import { useEffect, useRef } from "react";
import { ArrowDown, ArrowUp, ImagePlus, Plus, Trash2, X } from "lucide-react";
import type { BadgeKey, BadgeMode, Board, BoardDisplay, CardSection, FieldDef, FieldType } from "../types";
import { useStore } from "../store";
import { BOARD_EMOJIS, GRADIENTS, isImage, PALETTE, uid } from "../utils";
import { storedSrc, storeFile, storeFromPath } from "../storage";
import { registerDropZone } from "../fileDrop";
import { ask, ColorPicker, Modal } from "./ui";

const BADGES: { key: BadgeKey; name: string; icon: string; full: string }[] = [
  { key: "dates", name: "Dates", icon: "Due date", full: "Dates + “in 3 days / 2 days late” + repeat rule" },
  { key: "priority", name: "Priority", icon: "Colored flag", full: "Named badge (Urgent, Important…)" },
  { key: "checklist", name: "Checklist", icon: "Count (2/5)", full: "The items, tickable right on the card" },
  { key: "assignees", name: "Assigned to", icon: "Avatars", full: "Avatars with names" },
  { key: "description", name: "Description", icon: "Icon", full: "First lines of the description" },
  { key: "notes", name: "Notes", icon: "Count", full: "Latest note" },
  { key: "links", name: "Linked tasks", icon: "Count", full: "Linked task names" },
  { key: "attachments", name: "Files & links", icon: "Count", full: "File names" },
  { key: "time", name: "Time tracked", icon: "Total", full: "Total / estimate" },
];

export const SECTIONS: { key: CardSection; name: string }[] = [
  { key: "assignees", name: "Assigned to" },
  { key: "labels", name: "Labels" },
  { key: "fields", name: "Custom fields" },
  { key: "description", name: "Description" },
  { key: "checklist", name: "Checklist" },
  { key: "links", name: "Linked tasks" },
  { key: "files", name: "Files & links" },
  { key: "notes", name: "Notes" },
  { key: "activity", name: "Activity" },
  { key: "progress", name: "Progress" },
  { key: "priority", name: "Priority" },
  { key: "startDate", name: "Start date" },
  { key: "dueDate", name: "Due date" },
  { key: "reminder", name: "Reminder" },
  { key: "repeat", name: "Repeat" },
  { key: "time", name: "Time & focus" },
  { key: "cover", name: "Cover" },
  { key: "moveBoard", name: "Move to board" },
];

const FIELD_TYPES: { id: FieldType; name: string }[] = [
  { id: "text", name: "Text" },
  { id: "number", name: "Number" },
  { id: "select", name: "Dropdown" },
  { id: "checkbox", name: "Checkbox" },
  { id: "date", name: "Date" },
  { id: "url", name: "Link" },
];

const BG_COLORS = ["#1e293b", "#0f172a", "#164e63", "#14532d", "#4c1d95", "#7c2d12", "#831843", "#334155"];

/** CSS background for a board, or undefined for the default. */
export function boardBackground(b: Board): string | undefined {
  const bg = b.background;
  if (bg.type === "color" || bg.type === "gradient") return bg.value;
  if (bg.type === "image") return `center / cover no-repeat url("${storedSrc(bg.value)}")`;
  return undefined;
}

export function BoardCustomize({ board }: { board: Board }) {
  const updateBoard = useStore((s) => s.updateBoard);
  const close = () => useStore.getState().setOverlay({ customizeBoardId: null });
  const set = (patch: Partial<Board>) => updateBoard(board.id, patch);
  const setDisplay = (patch: Partial<BoardDisplay>) => set({ display: { ...board.display, ...patch } });
  const fileRef = useRef<HTMLInputElement>(null);
  const bg = board.background;

  // Images dragged onto the Background section (handled by the app-wide drop handler).
  useEffect(
    () =>
      registerDropZone("board-background", ({ files, paths }) => {
        if (files[0]) return void useImage(files[0]);
        const path = paths[0];
        if (!path) return;
        if (!isImage(path)) return useStore.getState().toast("That isn't an image.");
        storeFromPath(path).then(
          (r) => set({ background: { type: "image", value: r.rel } }),
          (err) => useStore.getState().toast(`Couldn't use that image: ${err}`),
        );
      }),
  );

  const useImage = async (f: File) => {
    if (!isImage(f.name, f.type)) return useStore.getState().toast("That isn't an image.");
    try {
      set({ background: { type: "image", value: await storeFile(f) } });
    } catch (err) {
      useStore.getState().toast(`Couldn't use that image: ${err}`);
    }
  };

  return (
    <Modal onClose={close} width={680} className="customize">
      <header className="customize-head">
        <h2>Customize “{board.title}”</h2>
        <button className="icon-btn" onClick={close}>
          <X size={18} />
        </button>
      </header>
      <div className="customize-body">
        <section>
          <h4>Icon</h4>
          <div className="emoji-grid">
            <button className={!board.icon ? "sel" : ""} onClick={() => set({ icon: null })} title="No icon">
              <X size={14} />
            </button>
            {BOARD_EMOJIS.map((e) => (
              <button key={e} className={board.icon === e ? "sel" : ""} onClick={() => set({ icon: e })}>
                {e}
              </button>
            ))}
            <input
              className="emoji-input"
              placeholder="Any emoji"
              maxLength={4}
              onChange={(e) => e.target.value.trim() && set({ icon: e.target.value.trim() })}
            />
          </div>
        </section>

        <section>
          <h4>Board color</h4>
          <p className="muted small">Used for the column tops, sidebar dot and charts.</p>
          <ColorPicker value={board.color} onChange={(color) => set({ color: color ?? PALETTE[6] })} />
        </section>

        <section data-file-drop="board-background">
          <h4>Background</h4>
          <p className="muted small">Pick one, upload an image, or drop an image here.</p>
          <div className="bg-grid">
            <button className={`bg-swatch none ${bg.type === "none" ? "sel" : ""}`} onClick={() => set({ background: { type: "none" } })}>
              Default
            </button>
            {GRADIENTS.map((g) => (
              <button
                key={g}
                className={`bg-swatch ${bg.type === "gradient" && bg.value === g ? "sel" : ""}`}
                style={{ background: g }}
                onClick={() => set({ background: { type: "gradient", value: g } })}
              />
            ))}
            {BG_COLORS.map((c) => (
              <button
                key={c}
                className={`bg-swatch ${bg.type === "color" && bg.value === c ? "sel" : ""}`}
                style={{ background: c }}
                onClick={() => set({ background: { type: "color", value: c } })}
              />
            ))}
            <label className="bg-swatch custom" title="Pick any color">
              <input
                type="color"
                value={bg.type === "color" ? bg.value : "#1e293b"}
                onChange={(e) => set({ background: { type: "color", value: e.target.value } })}
              />
            </label>
            <button
              className={`bg-swatch upload ${bg.type === "image" ? "sel" : ""}`}
              style={bg.type === "image" ? { background: boardBackground(board) } : undefined}
              onClick={() => fileRef.current?.click()}
              title="Upload an image"
            >
              {bg.type !== "image" && <ImagePlus size={18} />}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) void useImage(f);
              }}
            />
          </div>
        </section>

        <section>
          <h4>Layout</h4>
          <div className="field-row">
            <label>Column width</label>
            <div className="seg">
              {(["narrow", "normal", "wide"] as const).map((w) => (
                <button key={w} className={board.display.columnWidth === w ? "active" : ""} onClick={() => setDisplay({ columnWidth: w })}>
                  {w[0].toUpperCase() + w.slice(1)}
                </button>
              ))}
            </div>
          </div>
          <div className="field-row">
            <label>Labels on cards</label>
            <div className="seg">
              <button className={board.display.labelStyle === "text" ? "active" : ""} onClick={() => setDisplay({ labelStyle: "text" })}>
                Named pills
              </button>
              <button className={board.display.labelStyle === "bar" ? "active" : ""} onClick={() => setDisplay({ labelStyle: "bar" })}>
                Color bars
              </button>
            </div>
          </div>
          <label className="check-row">
            <input type="checkbox" checked={board.display.compact} onChange={(e) => setDisplay({ compact: e.target.checked })} />
            Compact cards (tighter spacing, smaller text)
          </label>
        </section>

        <section>
          <h4>Show on cards</h4>
          <p className="muted small">What each card on the board shows. “Icon” is compact; “Details” shows the actual information.</p>
          <div className="badge-modes">
            {BADGES.map((b) => (
              <div key={b.key} className="badge-mode-row">
                <span className="grow">
                  {b.name}
                  <small className="muted">
                    {board.display.badges[b.key] === "full" ? b.full : board.display.badges[b.key] === "icon" ? b.icon : "Hidden"}
                  </small>
                </span>
                <div className="seg">
                  {(["off", "icon", "full"] as BadgeMode[]).map((m) => (
                    <button
                      key={m}
                      className={board.display.badges[b.key] === m ? "active" : ""}
                      onClick={() => setDisplay({ badges: { ...board.display.badges, [b.key]: m } })}
                    >
                      {m === "off" ? "Hidden" : m === "icon" ? "Icon" : "Details"}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>

        <FieldsEditor board={board} />

        <section>
          <h4>Card details window</h4>
          <p className="muted small">Hide parts of the card window you don't use on this board. Nothing is deleted — tick it again to bring it back.</p>
          <div className="badge-grid">
            {SECTIONS.map((sct) => (
              <label key={sct.key} className="check-row">
                <input
                  type="checkbox"
                  checked={!board.hiddenSections.includes(sct.key)}
                  onChange={(e) =>
                    set({
                      hiddenSections: e.target.checked
                        ? board.hiddenSections.filter((x) => x !== sct.key)
                        : [...board.hiddenSections, sct.key],
                    })
                  }
                />
                {sct.name}
              </label>
            ))}
          </div>
        </section>

        <section>
          <h4>Card aging</h4>
          <label className="check-row">
            <input type="checkbox" checked={board.display.aging} onChange={(e) => setDisplay({ aging: e.target.checked })} />
            Fade cards nobody has touched in a while
          </label>
          <p className="muted small">
            Unfinished cards slowly fade after 1, 2 and 4 weeks without any change, so stale work stands out. Editing,
            moving or commenting on a card makes it fresh again.
          </p>
        </section>
      </div>
    </Modal>
  );
}

function FieldsEditor({ board }: { board: Board }) {
  const updateBoard = useStore((s) => s.updateBoard);
  const setFields = (fields: FieldDef[]) => updateBoard(board.id, { fields });
  const patch = (id: string, p: Partial<FieldDef>) => setFields(board.fields.map((f) => (f.id === id ? { ...f, ...p } : f)));
  const move = (i: number, d: -1 | 1) => {
    const arr = [...board.fields];
    [arr[i], arr[i + d]] = [arr[i + d], arr[i]];
    setFields(arr);
  };
  return (
    <section>
      <h4>Custom fields</h4>
      <p className="muted small">Extra information every card on this board can have — e.g. Client, Cost, Version, Approved.</p>
      <div className="fields-editor">
        {board.fields.map((f, i) => (
          <div key={f.id} className="field-def">
            <div className="row gap-sm">
              <input className="grow" value={f.name} placeholder="Field name" onChange={(e) => patch(f.id, { name: e.target.value })} />
              <select value={f.type} onChange={(e) => patch(f.id, { type: e.target.value as FieldType })}>
                {FIELD_TYPES.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
              <label className="check-row small" title="Show this field on cards in the board">
                <input type="checkbox" checked={f.showOnCard} onChange={(e) => patch(f.id, { showOnCard: e.target.checked })} />
                On card
              </label>
              <button className="icon-btn tiny" disabled={i === 0} onClick={() => move(i, -1)} title="Move up">
                <ArrowUp size={13} />
              </button>
              <button className="icon-btn tiny" disabled={i === board.fields.length - 1} onClick={() => move(i, 1)} title="Move down">
                <ArrowDown size={13} />
              </button>
              <button
                className="icon-btn tiny danger"
                title="Delete field"
                onClick={async () => {
                  if (await ask(`Delete the field "${f.name}"? Values on cards are kept hidden, and Ctrl+Z brings it back.`, { okText: "Delete", danger: true }))
                    setFields(board.fields.filter((x) => x.id !== f.id));
                }}
              >
                <Trash2 size={13} />
              </button>
            </div>
            {f.type === "select" && (
              <div className="field-options">
                {f.options.map((o) => (
                  <span key={o.id} className="field-option" style={{ borderColor: o.color }}>
                    <input
                      type="color"
                      value={o.color}
                      onChange={(e) => patch(f.id, { options: f.options.map((x) => (x.id === o.id ? { ...x, color: e.target.value } : x)) })}
                    />
                    <input
                      value={o.label}
                      onChange={(e) => patch(f.id, { options: f.options.map((x) => (x.id === o.id ? { ...x, label: e.target.value } : x)) })}
                    />
                    <button className="icon-btn tiny" onClick={() => patch(f.id, { options: f.options.filter((x) => x.id !== o.id) })}>
                      <X size={11} />
                    </button>
                  </span>
                ))}
                <button
                  className="btn sm ghost"
                  onClick={() =>
                    patch(f.id, {
                      options: [...f.options, { id: uid(), label: `Option ${f.options.length + 1}`, color: PALETTE[f.options.length % PALETTE.length] }],
                    })
                  }
                >
                  <Plus size={12} /> Option
                </button>
              </div>
            )}
          </div>
        ))}
        <button
          className="btn sm"
          onClick={() => setFields([...board.fields, { id: uid(), name: "New field", type: "text", options: [], showOnCard: true }])}
        >
          <Plus size={13} /> Add field
        </button>
      </div>
    </section>
  );
}
