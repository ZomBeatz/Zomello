import { useMemo, useState } from "react";
import { Zap } from "lucide-react";
import type { ID, Priority } from "../types";
import { useStore } from "../store";
import { byOrder, PRIORITIES } from "../utils";
import { Modal } from "./ui";

/** Create a task on any board from anywhere (N / Ctrl+N). */
export function QuickAdd() {
  const data = useStore((s) => s.data);
  const route = useStore((s) => s.route);
  const { setOverlay, createCard, createFromTemplate, openCard } = useStore.getState();
  const boards = useMemo(() => Object.values(data.boards).filter((b) => !b.archived).sort(byOrder), [data.boards]);
  const [boardId, setBoardId] = useState<ID>(route.page === "board" ? route.boardId : boards[0]?.id ?? "");
  const lists = Object.values(data.lists)
    .filter((l) => l.boardId === boardId && !l.archived)
    .sort(byOrder);
  const [listId, setListId] = useState<ID>("");
  const effectiveList = lists.some((l) => l.id === listId) ? listId : lists[0]?.id;
  const [title, setTitle] = useState("");
  const [due, setDue] = useState("");
  const [priority, setPriority] = useState<Priority>("medium");
  const [mine, setMine] = useState(true);
  const [template, setTemplate] = useState("");
  const close = () => setOverlay({ quickAddOpen: false });

  const submit = (openAfter: boolean) => {
    if (!effectiveList || (!title.trim() && !template)) return;
    const extra = {
      ...(title.trim() ? { title: title.trim() } : {}),
      dueDate: due || null,
      priority,
      ...(mine && data.settings.me ? { assignees: [data.settings.me] } : {}),
    };
    const id = template
      ? createFromTemplate(template, effectiveList, extra)
      : createCard(effectiveList, title.trim(), extra);
    useStore.getState().toast(`Added "${useStore.getState().data.cards[id].title}" to ${data.boards[boardId].title}`, { undo: true });
    close();
    if (openAfter) openCard(id);
  };

  return (
    <Modal onClose={close} width={520} className="quick-add">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit(false);
        }}
      >
        <div className="quick-title">
          <Zap size={18} />
          <input autoFocus placeholder="What needs doing?" value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div className="quick-grid">
          <label>
            Board
            <select value={boardId} onChange={(e) => setBoardId(e.target.value)}>
              {boards.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.icon ? `${b.icon} ` : ""}
                  {b.title}
                </option>
              ))}
            </select>
          </label>
          <label>
            Bucket
            <select value={effectiveList} onChange={(e) => setListId(e.target.value)}>
              {lists.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.title}
                </option>
              ))}
            </select>
          </label>
          <label>
            Due
            <input type="date" value={due} onChange={(e) => setDue(e.target.value)} />
          </label>
          <label>
            Priority
            <select value={priority} onChange={(e) => setPriority(e.target.value as Priority)}>
              {PRIORITIES.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          {data.templates.length > 0 && (
            <label className="span2">
              Template
              <select value={template} onChange={(e) => setTemplate(e.target.value)}>
                <option value="">None</option>
                {data.templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
        <div className="row gap quick-foot">
          {data.settings.me && (
            <label className="check-row">
              <input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} /> Assign to {data.settings.me}
            </label>
          )}
          <span className="grow" />
          <button type="button" className="btn" onClick={() => submit(true)}>
            Add & open
          </button>
          <button type="submit" className="btn primary">
            Add task
          </button>
        </div>
      </form>
    </Modal>
  );
}
