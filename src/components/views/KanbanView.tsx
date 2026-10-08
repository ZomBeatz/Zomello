import { useMemo, useState } from "react";
import {
  closestCenter,
  closestCorners,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  type UniqueIdentifier,
} from "@dnd-kit/core";
import {
  arrayMove,
  horizontalListSortingStrategy,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  Archive,
  ChevronsLeftRight,
  Gauge,
  MoreHorizontal,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import type { Board, Card, GroupBy, ID, List } from "../../types";
import { useStore } from "../../store";
import { buildGroups, type Group } from "../../utils";
import { CardTile } from "../CardTile";
import { ask, InlineEdit, MenuItem, Popover } from "../ui";

const COL_PREFIX = "col:";
const DRAGGABLE: GroupBy[] = ["bucket", "progress", "priority", "assignee", "due"];

export function KanbanView({
  board,
  lists,
  cards,
  groupBy,
}: {
  board: Board;
  lists: List[];
  cards: Card[];
  groupBy: GroupBy;
}) {
  const people = useStore((s) => s.data.settings.people);
  const allCards = useStore((s) => s.data.cards);
  const applyCardOrder = useStore((s) => s.applyCardOrder);
  const reorderLists = useStore((s) => s.reorderLists);

  const groups = useMemo(() => buildGroups(groupBy, board, lists, cards, people), [groupBy, board, lists, cards, people]);
  const listNames = useMemo(() => Object.fromEntries(lists.map((l) => [l.id, l.title])), [lists]);

  // While dragging, a local copy of column contents lets cards hop between columns live.
  const [dragCols, setDragCols] = useState<Record<string, ID[]> | null>(null);
  const [activeId, setActiveId] = useState<UniqueIdentifier | null>(null);
  const columns = useMemo(
    () => dragCols ?? Object.fromEntries(groups.map((g) => [g.id, g.cards.map((c) => c.id)])),
    [dragCols, groups],
  );
  const canDrag = DRAGGABLE.includes(groupBy);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const findContainer = (id: UniqueIdentifier, cols = columns): string | undefined => {
    const s = String(id);
    if (s in cols) return s;
    return Object.keys(cols).find((k) => cols[k].includes(s));
  };

  const collision: CollisionDetection = (args) => {
    const type = args.active.data.current?.type;
    const droppableContainers = args.droppableContainers.filter((c) =>
      type === "column" ? c.data.current?.type === "column" : c.data.current?.type !== "column",
    );
    return (type === "column" ? closestCenter : closestCorners)({ ...args, droppableContainers });
  };

  const onDragStart = ({ active }: DragStartEvent) => {
    setActiveId(active.id);
    if (active.data.current?.type === "card") setDragCols(columns);
  };

  const onDragOver = ({ active, over }: DragOverEvent) => {
    if (!over || active.data.current?.type !== "card" || !dragCols) return;
    const from = findContainer(active.id, dragCols);
    const to = findContainer(over.id, dragCols);
    if (!from || !to || from === to) return;
    if (!groups.find((g) => g.id === to)?.patch) return;
    setDragCols((prev) => {
      if (!prev) return prev;
      const id = String(active.id);
      const toArr = prev[to].filter((x) => x !== id);
      const overIdx = toArr.indexOf(String(over.id));
      toArr.splice(overIdx >= 0 ? overIdx : toArr.length, 0, id);
      return { ...prev, [from]: prev[from].filter((x) => x !== id), [to]: toArr };
    });
  };

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    const cols = dragCols;
    setActiveId(null);
    setDragCols(null);
    if (!over) return;

    if (active.data.current?.type === "column") {
      const ids = lists.map((l) => l.id);
      const from = ids.indexOf(String(active.id).slice(COL_PREFIX.length));
      const to = ids.indexOf(String(over.id).slice(COL_PREFIX.length));
      if (from >= 0 && to >= 0 && from !== to) reorderLists(arrayMove(ids, from, to));
      return;
    }
    if (!cols) return;
    const id = String(active.id);
    const to = findContainer(over.id, cols);
    const group = groups.find((g) => g.id === to);
    if (!to || !group?.patch) return;
    let arr = cols[to];
    const oldIdx = arr.indexOf(id);
    const overIdx = arr.indexOf(String(over.id));
    if (oldIdx >= 0 && overIdx >= 0 && oldIdx !== overIdx) arr = arrayMove(arr, oldIdx, overIdx);
    const card = allCards[id];
    const startGroup = groups.find((g) => g.cards.some((c) => c.id === id));
    const patch = startGroup?.id === to ? {} : group.patch(card);
    applyCardOrder(arr, id, patch);
  };

  const activeCard = activeId && !String(activeId).startsWith(COL_PREFIX) ? allCards[String(activeId)] : null;
  const activeList =
    activeId && String(activeId).startsWith(COL_PREFIX) ? groups.find((g) => `${COL_PREFIX}${g.id}` === activeId) : null;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collision}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      onDragCancel={() => {
        setActiveId(null);
        setDragCols(null);
      }}
    >
      <div className="kanban">
        <SortableContext
          items={groupBy === "bucket" ? groups.map((g) => `${COL_PREFIX}${g.id}`) : []}
          strategy={horizontalListSortingStrategy}
        >
          {groups.map((g) => (
            <Column
              key={g.id}
              group={g}
              board={board}
              lists={lists}
              ids={columns[g.id] ?? []}
              cardsById={allCards}
              groupBy={groupBy}
              listNames={listNames}
              canDrag={canDrag}
            />
          ))}
        </SortableContext>
        {groupBy === "bucket" && <AddList boardId={board.id} />}
      </div>
      <DragOverlay dropAnimation={null}>
        {activeCard ? (
          <div className="drag-overlay">
            <CardTile card={activeCard} board={board} dragging />
          </div>
        ) : activeList ? (
          <div className="column drag-overlay">
            <div className="column-header">
              <span className="column-title">{activeList.title}</span>
            </div>
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

function Column({
  group,
  board,
  lists,
  ids,
  cardsById,
  groupBy,
  listNames,
  canDrag,
}: {
  group: Group;
  board: Board;
  lists: List[];
  ids: ID[];
  cardsById: Record<ID, Card>;
  groupBy: GroupBy;
  listNames: Record<ID, string>;
  canDrag: boolean;
}) {
  const updateList = useStore((s) => s.updateList);
  const deleteList = useStore((s) => s.deleteList);
  const list = group.list;
  const sortable = useSortable({
    id: `${COL_PREFIX}${group.id}`,
    data: { type: "column" },
    disabled: groupBy !== "bucket",
  });
  const { setNodeRef: setDropRef } = useDroppable({ id: group.id, data: { type: "container" } });

  const over = list?.wipLimit != null && ids.length > list.wipLimit;
  const style = {
    transform: CSS.Translate.toString(sortable.transform),
    transition: sortable.transition,
    opacity: sortable.isDragging ? 0.4 : 1,
  };

  if (list?.collapsed)
    return (
      <div ref={sortable.setNodeRef} style={style} className="column collapsed" {...sortable.attributes}>
        <button className="collapsed-inner" onClick={() => updateList(list.id, { collapsed: false })} title="Expand">
          <span className="count">{ids.length}</span>
          <span className="vertical">{list.title}</span>
        </button>
      </div>
    );

  return (
    <div ref={sortable.setNodeRef} style={style} className={`column ${over ? "over-limit" : ""}`}>
      <div className="column-header" {...sortable.attributes} {...sortable.listeners}>
        {group.color && <span className="dot" style={{ background: group.color }} />}
        {list ? (
          <InlineEdit className="column-title" value={list.title} onSave={(title) => updateList(list.id, { title })} />
        ) : (
          <span className="column-title">{group.title}</span>
        )}
        <span className={`count ${over ? "danger" : ""}`}>
          {ids.length}
          {list?.wipLimit != null && ` / ${list.wipLimit}`}
        </span>
        {list && (
          <Popover
            align="right"
            trigger={(_, toggle) => (
              <button className="icon-btn" onClick={toggle} onPointerDown={(e) => e.stopPropagation()}>
                <MoreHorizontal size={16} />
              </button>
            )}
          >
            {(close) => (
              <div className="menu">
                <MenuItem icon={<ChevronsLeftRight size={14} />} onClick={() => (updateList(list.id, { collapsed: true }), close())}>
                  Collapse
                </MenuItem>
                <label className="menu-item">
                  <Gauge size={14} />
                  <span>WIP limit</span>
                  <input
                    type="number"
                    min={0}
                    className="wip-input"
                    placeholder="none"
                    defaultValue={list.wipLimit ?? ""}
                    onChange={(e) => {
                      const n = parseInt(e.target.value, 10);
                      updateList(list.id, { wipLimit: Number.isFinite(n) && n > 0 ? n : null });
                    }}
                  />
                </label>
                <MenuItem icon={<Archive size={14} />} onClick={() => (updateList(list.id, { archived: true }), close())}>
                  Archive bucket
                </MenuItem>
                <MenuItem
                  danger
                  icon={<Trash2 size={14} />}
                  onClick={async () => {
                    close();
                    if (await ask(`Delete "${list.title}" and all its cards? This can't be undone.`, { okText: "Delete", danger: true }))
                      deleteList(list.id);
                  }}
                >
                  Delete bucket
                </MenuItem>
              </div>
            )}
          </Popover>
        )}
      </div>
      <div ref={setDropRef} className="column-body">
        <SortableContext items={ids} strategy={verticalListSortingStrategy}>
          {ids.map((id) =>
            cardsById[id] ? (
              <SortableCard
                key={id}
                card={cardsById[id]}
                board={board}
                disabled={!canDrag}
                bucketName={groupBy !== "bucket" ? listNames[cardsById[id].listId] : undefined}
              />
            ) : null,
          )}
        </SortableContext>
      </div>
      {group.patch && lists.length > 0 && <AddCard group={group} lists={lists} />}
    </div>
  );
}

function SortableCard({ card, board, disabled, bucketName }: { card: Card; board: Board; disabled: boolean; bucketName?: string }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: card.id,
    data: { type: "card" },
    disabled,
  });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition, opacity: isDragging ? 0.35 : 1 }}
      {...attributes}
      {...listeners}
      tabIndex={-1}
    >
      <CardTile card={card} board={board} bucketName={bucketName} />
    </div>
  );
}

function AddCard({ group, lists }: { group: Group; lists: List[] }) {
  const createCard = useStore((s) => s.createCard);
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const submit = () => {
    const t = title.trim();
    if (!t) return;
    createCard(group.list?.id ?? lists[0].id, t, group.patch!(null));
    setTitle("");
  };
  if (!open)
    return (
      <button className="add-card-btn" onClick={() => setOpen(true)}>
        <Plus size={15} /> Add card
      </button>
    );
  return (
    <div className="add-card-form">
      <textarea
        autoFocus
        rows={2}
        placeholder="Card title… (Enter to add, Esc to close)"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            submit();
          }
          if (e.key === "Escape") setOpen(false);
        }}
        onBlur={() => !title.trim() && setOpen(false)}
      />
      <div className="row gap">
        <button className="btn primary sm" onMouseDown={(e) => e.preventDefault()} onClick={submit}>
          Add card
        </button>
        <button className="icon-btn" onClick={() => setOpen(false)}>
          <X size={16} />
        </button>
      </div>
    </div>
  );
}

function AddList({ boardId }: { boardId: ID }) {
  const createList = useStore((s) => s.createList);
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  if (!open)
    return (
      <button className="add-list-btn" onClick={() => setOpen(true)}>
        <Plus size={16} /> Add bucket
      </button>
    );
  const submit = () => {
    if (title.trim()) createList(boardId, title.trim());
    setTitle("");
  };
  return (
    <div className="column add-list-form">
      <input
        autoFocus
        placeholder="Bucket name"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") submit();
          if (e.key === "Escape") setOpen(false);
        }}
        onBlur={() => !title.trim() && setOpen(false)}
      />
      <div className="row gap">
        <button className="btn primary sm" onMouseDown={(e) => e.preventDefault()} onClick={submit}>
          Add
        </button>
        <button className="icon-btn" onClick={() => setOpen(false)}>
          <X size={16} />
        </button>
      </div>
    </div>
  );
}
