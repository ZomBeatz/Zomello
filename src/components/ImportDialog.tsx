import { useRef, useState } from "react";
import { AlertTriangle, FileUp, X } from "lucide-react";
import { useStore } from "../store";
import { importStats, parseImportFile, type ImportedBoard } from "../importers";
import { Modal } from "./ui";
import { readDrop } from "../attachments";
import { fileFromPath, inTauri } from "../storage";

export function ImportDialog() {
  const close = () => useStore.getState().setOverlay({ importOpen: false });
  const [board, setBoard] = useState<ImportedBoard | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [title, setTitle] = useState("");
  const [addPeople, setAddPeople] = useState(true);
  const [over, setOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const people = useStore((s) => s.data.settings.people);

  const load = async (f: File) => {
    setBusy(true);
    setError("");
    try {
      const b = await parseImportFile(f);
      setBoard(b);
      setTitle(b.title);
    } catch (e) {
      setBoard(null);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const doImport = () => {
    if (!board) return;
    const st = useStore.getState();
    const id = st.importBoard({ ...board, title: title.trim() || board.title }, { addPeople });
    close();
    st.navigate({ page: "board", boardId: id });
    st.toast(`Imported “${title}” from ${board.source}`, { undo: true });
  };

  const stats = board && importStats(board);
  const newPeople = board ? board.people.filter((p) => !people.includes(p)) : [];

  return (
    <Modal onClose={close} width={600} className="import-dialog">
      <header className="customize-head">
        <h2>Import a board</h2>
        <button className="icon-btn" onClick={close}>
          <X size={18} />
        </button>
      </header>
      <div className="customize-body">
        <div
          data-file-drop
          className={`import-drop ${over ? "drop-target" : ""}`}
          onClick={() => fileRef.current?.click()}
          onDragOver={(e) => {
            if (!e.dataTransfer.types.includes("Files") && !e.dataTransfer.types.includes("text/uri-list")) return;
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setOver(false);
            const d = readDrop(e.dataTransfer);
            if (d.files[0]) void load(d.files[0]);
            else if (d.paths[0] && inTauri) void fileFromPath(d.paths[0]).then(load, (err) => setError(String(err)));
          }}
        >
          <FileUp size={28} />
          <b>{busy ? "Reading…" : "Choose or drop an export file"}</b>
          <span className="muted small">Trello .json · Planner .xlsx or .csv</span>
          <input
            ref={fileRef}
            type="file"
            accept=".json,.xlsx,.csv,application/json,text/csv"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) void load(f);
            }}
          />
        </div>

        {error && (
          <p className="danger-text small">
            <AlertTriangle size={13} /> {error}
          </p>
        )}

        {board && stats && (
          <div className="import-preview">
            <label className="field">
              <span className="cf-name">Board name</span>
              <input value={title} onChange={(e) => setTitle(e.target.value)} />
            </label>
            <p>
              From <b>{board.source}</b>: {stats.lists} buckets, {stats.cards} cards, {stats.labels} labels
              {stats.people ? `, ${stats.people} people` : ""}.
            </p>
            <ul className="import-lists">
              {board.lists.map((l, i) => (
                <li key={i}>
                  <span className="grow">{l.name}</span>
                  <span className="muted small">{l.cards.length} cards{l.archived ? " · archived" : ""}</span>
                </li>
              ))}
            </ul>
            {newPeople.length > 0 && (
              <label className="check-row">
                <input type="checkbox" checked={addPeople} onChange={(e) => setAddPeople(e.target.checked)} />
                Add {newPeople.length} {newPeople.length === 1 ? "person" : "people"} to Zomello ({newPeople.slice(0, 4).join(", ")}
                {newPeople.length > 4 ? "…" : ""})
              </label>
            )}
            {board.warnings.map((w) => (
              <p key={w} className="muted small">
                <AlertTriangle size={12} /> {w}
              </p>
            ))}
            <div className="row end gap">
              <button className="btn" onClick={() => setBoard(null)}>
                Pick another file
              </button>
              <button className="btn primary" onClick={doImport}>
                Import as a new board
              </button>
            </div>
          </div>
        )}

        <details className="import-help">
          <summary>How do I export from Trello or Planner?</summary>
          <p>
            <b>Trello:</b> open the board → <i>⋯ Menu</i> → <i>Print, export, and share</i> → <i>Export as JSON</i>, then save the page
            as a .json file.
          </p>
          <p>
            <b>Microsoft Planner:</b> open the plan → <i>⋯</i> next to the plan name → <i>Export plan to Excel</i>. Use the .xlsx file as
            is (or save it as .csv).
          </p>
          <p className="muted small">Imports always create a new board, so nothing you already have is changed. Ctrl+Z undoes an import.</p>
        </details>
      </div>
    </Modal>
  );
}
