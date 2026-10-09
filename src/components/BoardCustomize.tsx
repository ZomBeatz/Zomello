import { useRef } from "react";
import { ImagePlus, X } from "lucide-react";
import type { BadgeKey, Board, BoardDisplay } from "../types";
import { useStore } from "../store";
import { BOARD_EMOJIS, GRADIENTS, PALETTE } from "../utils";
import { storedSrc, storeFile } from "../storage";
import { ColorPicker, Modal } from "./ui";

const BADGES: { key: BadgeKey; name: string }[] = [
  { key: "dates", name: "Dates" },
  { key: "priority", name: "Priority" },
  { key: "checklist", name: "Checklist progress" },
  { key: "assignees", name: "Assignees" },
  { key: "description", name: "Description & notes" },
  { key: "links", name: "Linked tasks" },
  { key: "time", name: "Time tracked" },
  { key: "attachments", name: "Attachments" },
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

  return (
    <Modal onClose={close} width={620} className="customize">
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

        <section>
          <h4>Background</h4>
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
              onChange={async (e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (!f) return;
                try {
                  set({ background: { type: "image", value: await storeFile(f) } });
                } catch (err) {
                  useStore.getState().toast(`Couldn't use that image: ${err}`);
                }
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
          <div className="badge-grid">
            {BADGES.map((b) => (
              <label key={b.key} className="check-row">
                <input
                  type="checkbox"
                  checked={board.display.badges[b.key]}
                  onChange={(e) => setDisplay({ badges: { ...board.display.badges, [b.key]: e.target.checked } })}
                />
                {b.name}
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
