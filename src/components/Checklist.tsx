import { useState } from "react";
import { useDragSensors } from "../mobile";
import { closestCenter, DndContext, type DragEndEvent } from "@dnd-kit/core";
import { arrayMove, SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { restrictToParentElement, restrictToVerticalAxis } from "@dnd-kit/modifiers";
import { CSS } from "@dnd-kit/utilities";
import { CheckSquare, GripVertical, Link2, MoveRight, Plus, Tag, Unlink, X } from "lucide-react";
import type { Card, ChecklistItem, ID } from "../types";
import { useStore } from "../store";
import { checklistStats, subtaskLoopReason, uid } from "../utils";
import { InlineEdit, Popover } from "./ui";
import { BucketPicker, CardPicker, LabelPicker } from "./pickers";

/** The checklist in the card window: drag to reorder, insert between items, labels per item. */
export function ChecklistSection({ card }: { card: Card }) {
  const updateCard = useStore((s) => s.updateCard);
  const cl = checklistStats(card);
  const [newItem, setNewItem] = useState("");
  /** Index an inline "insert here" box is open at (null = none). */
  const [insertAt, setInsertAt] = useState<number | null>(null);
  const sensors = useDragSensors(4);
  const setList = (checklist: ChecklistItem[]) => updateCard(card.id, { checklist });
  const allCards = useStore((s) => s.data.cards);
  const isChecked = (i: ChecklistItem) => (i.cardId && allCards[i.cardId] ? allCards[i.cardId].progress === "completed" : i.done);
  const isHidden = (i: ChecklistItem) => !!card.hideChecked && isChecked(i);

  const insert = (index: number, text: string) => {
    const list = [...useStore.getState().data.cards[card.id].checklist];
    list.splice(index, 0, { id: uid(), text, done: false });
    setList(list);
  };

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const ids = card.checklist.map((i) => i.id);
    setList(arrayMove(card.checklist, ids.indexOf(String(active.id)), ids.indexOf(String(over.id))));
  };

  return (
    <section>
      <h4>
        <CheckSquare size={15} /> Checklist
        {cl.total > 0 && (
          <span className="muted small">
            {cl.done}/{cl.total}
          </span>
        )}
        {cl.done > 0 && (
          <button
            className="btn ghost sm cl-hide-toggle"
            onClick={() => updateCard(card.id, { hideChecked: !card.hideChecked })}
            title={card.hideChecked ? "Show the ticked items again" : "Hide ticked items on this card"}
          >
            {card.hideChecked ? `Show checked (${cl.done})` : "Hide checked"}
          </button>
        )}
      </h4>
      {cl.total > 0 && (
        <div className="progress-bar">
          <span style={{ width: `${(cl.done / cl.total) * 100}%` }} />
        </div>
      )}
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd} modifiers={[restrictToVerticalAxis, restrictToParentElement]}>
        <SortableContext items={card.checklist.filter((i) => !isHidden(i)).map((i) => i.id)} strategy={verticalListSortingStrategy}>
          <ul className="checklist">
            {card.checklist.map((item, i) => (
              isHidden(item) ? null :
              <ChecklistRow
                key={item.id}
                card={card}
                item={item}
                before={
                  insertAt === i ? (
                    <InsertBox
                      onAdd={(text) => {
                        insert(i, text);
                        setInsertAt(i + 1); // keep adding below what was just added
                      }}
                      onClose={() => setInsertAt(null)}
                    />
                  ) : i > 0 ? (
                    <InsertGap onClick={() => setInsertAt(i)} />
                  ) : null
                }
              />
            ))}
            {insertAt === card.checklist.length && card.checklist.length > 0 && (
              <InsertBox
                onAdd={(text) => {
                  insert(card.checklist.length, text);
                  setInsertAt(card.checklist.length + 1);
                }}
                onClose={() => setInsertAt(null)}
              />
            )}
          </ul>
        </SortableContext>
      </DndContext>
      <input
        className="add-input"
        placeholder="Add an item… (Enter)"
        value={newItem}
        onChange={(e) => setNewItem(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && newItem.trim()) {
            insert(card.checklist.length, newItem.trim());
            setNewItem("");
          }
          if (e.key === "Escape") {
            e.currentTarget.value = "";
            setNewItem("");
          }
        }}
        onBlur={(e) => {
          if (!e.currentTarget.value.trim() || !newItem.trim()) return;
          insert(useStore.getState().data.cards[card.id].checklist.length, newItem.trim());
          setNewItem("");
        }}
      />
    </section>
  );
}

/** Thin hover strip between two items: click to insert a new item there. */
function InsertGap({ onClick }: { onClick: () => void }) {
  return (
    <li className="cl-gap" aria-hidden="true">
      <button tabIndex={-1} onClick={onClick} title="Insert an item here">
        <Plus size={11} />
      </button>
    </li>
  );
}

function InsertBox({ onAdd, onClose }: { onAdd: (text: string) => void; onClose: () => void }) {
  const [text, setText] = useState("");
  return (
    <li className="cl-insert">
      <Plus size={13} className="muted" />
      <input
        autoFocus
        placeholder="New item… (Enter to add, Esc to stop)"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && text.trim()) {
            onAdd(text.trim());
            setText("");
          }
          if (e.key === "Escape") {
            e.stopPropagation();
            e.currentTarget.value = "";
            setText("");
            onClose();
          }
        }}
        onBlur={(e) => {
          if (e.currentTarget.value.trim()) onAdd(e.currentTarget.value.trim());
          onClose();
        }}
      />
    </li>
  );
}

function ChecklistRow({ card, item, before }: { card: Card; item: ChecklistItem; before: React.ReactNode }) {
  const allCards = useStore((s) => s.data.cards);
  const boards = useStore((s) => s.data.boards);
  const lists = useStore((s) => s.data.lists);
  const { updateCard, openCard, toggleChecklistItem, linkChecklistItem, spinOffChecklistItem } = useStore.getState();
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: item.id });

  const linked = item.cardId ? allCards[item.cardId] : null;
  const lastSpin = useStore((s) => s.data.ui[card.boardId]?.lastSpinOffList);
  const spinList = (lastSpin && lists[lastSpin] && !lists[lastSpin].archived && lists[lastSpin]) || lists[card.listId];
  const spinTarget = { boardId: spinList?.boardId ?? card.boardId, listId: spinList?.id ?? card.listId };
  const checked = linked ? linked.progress === "completed" : item.done;
  // Linked items use (and edit) the linked task's labels; plain items have their own.
  const labelBoard = boards[linked ? linked.boardId : card.boardId];
  const labelIds = linked ? linked.labelIds : item.labelIds ?? [];
  const labels = labelBoard?.labels.filter((l) => labelIds.includes(l.id)) ?? [];
  const setItem = (patch: Partial<ChecklistItem>) =>
    updateCard(card.id, {
      checklist: useStore.getState().data.cards[card.id].checklist.map((i) => (i.id === item.id ? { ...i, ...patch } : i)),
    });
  const toggleLabel = (id: ID, on: boolean) => {
    if (linked) {
      const cur = useStore.getState().data.cards[linked.id].labelIds;
      updateCard(linked.id, { labelIds: on ? [...new Set([...cur, id])] : cur.filter((x) => x !== id) });
    } else {
      const cur = useStore.getState().data.cards[card.id].checklist.find((i) => i.id === item.id)?.labelIds ?? [];
      setItem({ labelIds: on ? [...new Set([...cur, id])] : cur.filter((x) => x !== id) });
    }
  };

  return (
    <>
      {before}
      <li
        ref={setNodeRef}
        style={{ transform: CSS.Translate.toString(transform), transition }}
        className={`${checked ? "done" : ""} ${isDragging ? "dragging" : ""}`}
      >
        <button ref={setActivatorNodeRef} className="cl-grip" title="Drag to reorder" {...attributes} {...listeners}>
          <GripVertical size={14} />
        </button>
        <input type="checkbox" checked={checked} onChange={() => toggleChecklistItem(card.id, item.id)} />
        {linked ? (
          <button className="linked-item grow" onClick={() => openCard(linked.id, { via: "checklist" })} title="Open linked task">
            <Link2 size={13} />
            <span className="ellipsis">{linked.title}</span>
            <span className="muted small ellipsis">
              {boards[linked.boardId]?.title} › {lists[linked.listId]?.title}
            </span>
          </button>
        ) : (
          <InlineEdit value={item.text} onSave={(text) => setItem({ text })} />
        )}
        {labels.length > 0 && (
          <span className="cl-labels">
            {labels.map((l) => (
              <span key={l.id} className="label-pill sm" style={{ background: l.color }} title={linked ? `${l.name} (on the linked task)` : l.name}>
                {l.name}
              </span>
            ))}
          </span>
        )}
        <span className="cl-actions">
          {labelBoard && (
            <Popover
              align="right"
              trigger={(_, t) => (
                <button className="icon-btn tiny" title={linked ? "Labels (of the linked task)" : "Labels"} onClick={t}>
                  <Tag size={13} />
                </button>
              )}
            >
              {() => <LabelPicker board={labelBoard} selected={labelIds} onToggle={toggleLabel} />}
            </Popover>
          )}
          {linked ? (
            <button className="icon-btn tiny" title="Unlink (keeps the task)" onClick={() => linkChecklistItem(card.id, item.id, null)}>
              <Unlink size={13} />
            </button>
          ) : (
            <>
              <Popover
                align="right"
                trigger={(_, t) => (
                  <button className="icon-btn tiny" title="Spin off into its own task" onClick={t}>
                    <MoveRight size={13} />
                  </button>
                )}
              >
                {(close) => (
                  <div className="menu">
                    <span className="menu-heading">Spin off “{item.text}” to…</span>
                    <BucketPicker
                      // Default: wherever the last spin-off from this board went, else this card's bucket.
                      defaultBoardId={spinTarget.boardId}
                      defaultListId={spinTarget.listId}
                      action="Create task"
                      onPick={(listId) => {
                        spinOffChecklistItem(card.id, item.id, listId);
                        useStore.getState().setBoardUi(card.boardId, { lastSpinOffList: listId });
                        close();
                      }}
                    />
                  </div>
                )}
              </Popover>
              <Popover
                align="right"
                trigger={(_, t) => (
                  <button className="icon-btn tiny" title="Link to an existing task" onClick={t}>
                    <Link2 size={13} />
                  </button>
                )}
              >
                {(close) => (
                  <CardPicker
                    exclude={[card.id]}
                    disabledReason={(id) => subtaskLoopReason(card.id, id, useStore.getState().data.cards)}
                    onPick={(id) => {
                      linkChecklistItem(card.id, item.id, id);
                      close();
                    }}
                  />
                )}
              </Popover>
            </>
          )}
          <button
            className="icon-btn tiny"
            title="Delete item"
            onClick={() =>
              updateCard(card.id, { checklist: useStore.getState().data.cards[card.id].checklist.filter((i) => i.id !== item.id) })
            }
          >
            <X size={13} />
          </button>
        </span>
      </li>
    </>
  );
}
