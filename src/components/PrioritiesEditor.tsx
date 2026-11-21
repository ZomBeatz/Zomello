import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { useStore } from "../store";
import type { Board, PriorityDef } from "../types";
import { defaultPriority, PRIORITIES, priorityList, uid } from "../utils";

/**
 * Customize > Priorities: a board's own priorities (name, icon, color, order), or the standard four.
 * Cards whose priority is removed get the board's usual one, so none are left with a priority it doesn't have.
 */
export function PrioritiesEditor({ board }: { board: Board }) {
  const own = !!board.priorities?.length;
  const list = priorityList(board);
  const save = (priorities: PriorityDef[] | undefined) => {
    const st = useStore.getState();
    st.updateBoard(board.id, { priorities });
    const keep = new Set(priorityList({ priorities }).map((p) => p.id));
    const fallback = defaultPriority({ priorities });
    for (const c of Object.values(st.data.cards)) if (c.boardId === board.id && !keep.has(c.priority)) st.updateCard(c.id, { priority: fallback });
  };
  const patch = (id: string, p: Partial<PriorityDef>) => save(list.map((x) => (x.id === id ? { ...x, ...p } : x)));
  const move = (i: number, d: -1 | 1) => {
    const arr = [...list];
    [arr[i], arr[i + d]] = [arr[i + d], arr[i]];
    save(arr);
  };
  return (
    <section>
      <h4>Priorities</h4>
      <p className="muted small">
        {own
          ? "This board's own priorities, most important first. The order is what sorting and Auto-assign go by."
          : "This board uses the standard four: Urgent, Important, Medium, Low. Customize them to rename, recolor, add icons or add your own."}
      </p>
      {own ? (
        <>
          <div className="fields-editor">
            {list.map((p, i) => (
              <div key={p.id} className="field-def priority-def">
                <div className="row gap-sm">
                  <input className="pri-icon" value={p.icon ?? ""} maxLength={3} placeholder="🔥" title="Icon (an emoji or a short mark)" onChange={(e) => patch(p.id, { icon: e.target.value || undefined })} />
                  <input className="grow" value={p.name} placeholder="Priority name" onChange={(e) => patch(p.id, { name: e.target.value })} />
                  <input type="color" value={p.color} title="Color" onChange={(e) => patch(p.id, { color: e.target.value })} />
                  <button className="icon-btn tiny" title="Move up" disabled={i === 0} onClick={() => move(i, -1)}>
                    <ArrowUp size={14} />
                  </button>
                  <button className="icon-btn tiny" title="Move down" disabled={i === list.length - 1} onClick={() => move(i, 1)}>
                    <ArrowDown size={14} />
                  </button>
                  <button className="icon-btn tiny" title="Remove" disabled={list.length <= 1} onClick={() => save(list.filter((x) => x.id !== p.id))}>
                    <Trash2 size={14} />
                  </button>
                </div>
                <div className="row gap wrap small">
                  <label className="check-row">
                    <input type="checkbox" checked={!!p.stripe} onChange={(e) => patch(p.id, { stripe: e.target.checked || undefined })} />
                    Color the card's edge
                  </label>
                  <label className="check-row" title="Auto-assign gives it to whoever has the least on, even when they're full">
                    <input type="checkbox" checked={!!p.overCapacity} onChange={(e) => patch(p.id, { overCapacity: e.target.checked || undefined })} />
                    Can go over capacity (Auto-assign)
                  </label>
                </div>
              </div>
            ))}
          </div>
          <div className="row gap">
            <button className="btn sm" onClick={() => save([...list, { id: uid(), name: "New priority", color: "#64748b" }])}>
              <Plus size={14} /> Add a priority
            </button>
            <button className="btn sm ghost" onClick={() => save(undefined)}>
              Use the standard four
            </button>
          </div>
        </>
      ) : (
        <button className="btn sm" onClick={() => save(PRIORITIES.map((p) => ({ ...p })))}>
          Customize priorities
        </button>
      )}
    </section>
  );
}
