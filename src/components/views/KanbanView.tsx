import { useMemo, useRef, useState } from "react";
import { archiveList, deleteList as deleteListAction } from "../../actions";
import { useDragSensors, useIsPhone } from "../../mobile";
import {
  closestCenter,
  closestCorners,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  useDroppable,
  useSensor,
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
  ChevronDown,
  ChevronRight,
  ArrowDownUp,
  Check,
  ChevronsLeftRight,
  CircleCheck,
  SlidersHorizontal,
  Sparkles,
  ClipboardCopy,
  Bot,
  Gauge,
  LayoutTemplate,
  MoreHorizontal,
  Plus,
  Trash2,
  X,
  ClipboardPaste,
} from "lucide-react";
import type { BadgeKey, BadgeMode, Board, Card, GroupBy, ID, List, Progress } from "../../types";
import { useStore } from "../../store";
import { useWhen, withWhen } from "../WhenChip";
import { buildGroups, SORT_MODES, sortCards, type Group } from "../../utils";
import { CardTile } from "../CardTile";
import { InlineEdit, MenuItem, Modal, Popover } from "../ui";
import { BADGES } from "../BoardCustomize";
import { copyText } from "../Markdown";
import { workOrder } from "../../ai";

const COL_PREFIX = "col:";

/**
 * Phone dragging: hold a card near the left or right edge and the board moves over one bucket
 * (again every ~0.6 s while you keep holding), instead of racing to the end.
 */
function useEdgePaging(enabled: boolean) {
  const st = useRef({ x: -1, since: 0, timer: 0 as unknown as ReturnType<typeof setInterval> });
  return useMemo(
    () => ({
      start() {
        if (!enabled) return;
        document.body.classList.add("dragging-card");
        st.current.x = -1;
        st.current.since = 0;
        clearInterval(st.current.timer);
        st.current.timer = setInterval(() => {
          const { x } = st.current;
          const w = window.innerWidth;
          const dir = x < 0 ? 0 : x < w * 0.14 ? -1 : x > w * 0.86 ? 1 : 0;
          if (!dir) return void (st.current.since = 0);
          const now = Date.now();
          if (!st.current.since) return void (st.current.since = now);
          if (now - st.current.since < 450) return;
          st.current.since = now + 150; // the next page waits a little longer
          const board = document.querySelector<HTMLElement>(".board-content");
          const col = document.querySelector<HTMLElement>(".kanban .column");
          if (board && col) board.scrollBy({ left: dir * (col.offsetWidth + 10), behavior: "smooth" });
        }, 100);
      },
      move(x: number) {
        st.current.x = x;
      },
      stop() {
        clearInterval(st.current.timer);
        document.body.classList.remove("dragging-card");
      },
    }),
    [enabled],
  );
}

/**
 * Keyboard dragging (for people not using a mouse): focus a card or bucket header, press Shift+Space to
 * pick it up, arrow keys to move, Space to drop, Esc to cancel. Unlike the library default (plain Space,
 * from anywhere inside), this only starts on the focused card/header itself — so typing a space in a
 * title box, or pressing Space on a focused card, does nothing unexpected.
 */
class DeliberateKeyboardSensor extends KeyboardSensor {
  static activators: typeof KeyboardSensor.activators = [
    {
      eventName: "onKeyDown",
      handler: (event, { onActivation }) => {
        const e = (event as React.KeyboardEvent).nativeEvent;
        if (e.code !== "Space" || !e.shiftKey || e.ctrlKey || e.altKey || e.metaKey) return false;
        const { target, currentTarget } = event as React.KeyboardEvent;
        const t = target as HTMLElement;
        // Never from text boxes / buttons; only from the draggable itself or the card directly inside it.
        if (t.closest("input, textarea, select, button, [contenteditable]")) return false;
        if (t !== currentTarget && t.parentElement !== currentTarget) return false;
        event.preventDefault();
        onActivation?.({ event: e });
        return true;
      },
    },
  ];
}
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

  const groups = useMemo(
    () =>
      buildGroups(groupBy, board, lists, cards, people).map((g) =>
        g.list && g.list.sort !== "custom" ? { ...g, cards: sortCards(g.cards, g.list.sort, g.list.sortDesc) } : g,
      ),
    [groupBy, board, lists, cards, people],
  );
  const listNames = useMemo(() => Object.fromEntries(lists.map((l) => [l.id, l.title])), [lists]);

  // Like Planner/Teams: completed cards are tucked into a collapsible section under each column
  // (except when grouping by progress, where "Completed" is its own column).
  // A bucket that completes its cards (e.g. "Done") shows them instead.
  const hideCompleted = groupBy !== "progress";
  const tucks = (g: Group) => hideCompleted && g.list?.autoProgress !== "completed";
  const isActive = (c: Card, g: Group) => !tucks(g) || c.progress !== "completed";
  const completedByGroup = useMemo(
    () =>
      Object.fromEntries(
        groups.map((g) => [
          g.id,
          tucks(g)
            ? g.cards.filter((c) => c.progress === "completed").sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0))
            : [],
        ]),
      ),
    [groups, hideCompleted],
  );

  // While dragging, a local copy of column contents lets cards hop between columns live.
  const [dragCols, setDragCols] = useState<Record<string, ID[]> | null>(null);
  const [activeId, setActiveId] = useState<UniqueIdentifier | null>(null);
  const columns = useMemo(
    () => dragCols ?? Object.fromEntries(groups.map((g) => [g.id, g.cards.filter((c) => isActive(c, g)).map((c) => c.id)])),
    [dragCols, groups, hideCompleted],
  );
  const canDrag = DRAGGABLE.includes(groupBy);

  const sensors = useDragSensors(6, useSensor(DeliberateKeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const phone = useIsPhone();
  const edge = useEdgePaging(phone);

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
    if (active.data.current?.type === "card") edge.start();
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
    edge.stop();
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
    const sameGroup = groups.find((g) => g.cards.some((c) => c.id === id))?.id === to;
    const st = useStore.getState();
    if (groupBy !== "bucket") {
      // Other groupings only change the field they group by; bucket order is left alone.
      if (!sameGroup) st.updateCard(id, group.patch(card));
      return;
    }
    const list = group.list!;
    if (list.sort !== "custom") {
      // A sorted bucket decides positions itself, so a drop never rewrites anyone's custom order.
      if (sameGroup) st.toast(`“${list.title}” is sorted by ${SORT_MODES.find((m) => m.id === list.sort)!.name}. Switch it to Custom order to arrange cards by hand.`, { key: "sort-hint" });
      else st.moveCardToList(id, list.id);
      return;
    }
    applyCardOrder(arr, id, sameGroup ? {} : group.patch(card));
  };

  const activeCard = activeId && !String(activeId).startsWith(COL_PREFIX) ? allCards[String(activeId)] : null;
  const activeList =
    activeId && String(activeId).startsWith(COL_PREFIX) ? groups.find((g) => `${COL_PREFIX}${g.id}` === activeId) : null;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collision}
      onDragStart={onDragStart}
      onDragMove={({ active }) => {
        const r = active.rect.current.translated;
        if (r) edge.move(r.left + r.width / 2);
      }}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      // Phones: no sideways auto-scroll (it flings to the far end); holding at an edge pages one bucket.
      autoScroll={phone ? { threshold: { x: 0, y: 0.15 } } : true}
      onDragCancel={() => {
        edge.stop();
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
              completed={completedByGroup[g.id] ?? []}
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
  completed,
}: {
  group: Group;
  board: Board;
  lists: List[];
  ids: ID[];
  cardsById: Record<ID, Card>;
  groupBy: GroupBy;
  listNames: Record<ID, string>;
  canDrag: boolean;
  completed: Card[];
}) {
  const updateList = useStore((s) => s.updateList);
  const list = group.list;
  const [displayOpen, setDisplayOpen] = useState(false);
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
        {list && list.sort !== "custom" && (
          <SortMenu list={list} lists={lists}>
            {(t) => (
              <button
                className="sort-chip"
                onClick={t}
                onPointerDown={(e) => e.stopPropagation()}
                title={`Sorted by ${SORT_MODES.find((m) => m.id === list.sort)!.name}${list.sortDesc ? " (reversed)" : ""}`}
              >
                <ArrowDownUp size={12} />
                {SORT_MODES.find((m) => m.id === list.sort)!.name.split(" ")[0]}
              </button>
            )}
          </SortMenu>
        )}
        <span className={`count ${over ? "danger" : ""}`}>
          {ids.length}
          {list?.wipLimit != null && ` / ${list.wipLimit}`}
        </span>
        {list && list.sort === "custom" && (
          <SortMenu list={list} lists={lists}>
            {(t) => (
              <button className="icon-btn tiny sort-btn" title="Sort cards" onClick={t} onPointerDown={(e) => e.stopPropagation()}>
                <ArrowDownUp size={14} />
              </button>
            )}
          </SortMenu>
        )}
        {list && (
          <Popover
            align="right"
            trigger={(_, toggle) => (
              <button className="icon-btn" title="Bucket menu" aria-label="Bucket menu" onClick={toggle} onPointerDown={(e) => e.stopPropagation()}>
                <MoreHorizontal size={16} />
              </button>
            )}
          >
            {(close) => (
              <div className="menu">
                <MenuItem icon={<ChevronsLeftRight size={14} />} onClick={() => (updateList(list.id, { collapsed: true }), close())}>
                  Collapse
                </MenuItem>
                <MenuItem
                  icon={<Sparkles size={14} />}
                  onClick={() => {
                    close();
                    useStore.getState().setOverlay({ aiDialog: { tab: "ask", mode: "cards", boardId: board.id, listId: list.id } });
                  }}
                >
                  Ask AI for cards here…
                </MenuItem>
                <MenuItem
                  icon={<Bot size={14} />}
                  onClick={() => {
                    close();
                    useStore.getState().setOverlay({ aiDialog: { tab: "export", boardId: board.id, listId: list.id } });
                  }}
                >
                  Export bucket for AI…
                </MenuItem>
                <MenuItem
                  icon={<ClipboardCopy size={14} />}
                  onClick={() => {
                    close();
                    const cs = Object.values(useStore.getState().data.cards).filter((c) => c.listId === list.id);
                    copyText(workOrder(board.id, cs, `Bucket: ${list.title}`));
                  }}
                >
                  Copy work order
                </MenuItem>
                <MenuItem
                  icon={<ClipboardPaste size={14} />}
                  onClick={() => {
                    close();
                    useStore.getState().setOverlay({ pasteCards: { boardId: board.id, listId: list.id } });
                  }}
                >
                  Paste cards here…
                </MenuItem>
                <label className="menu-item">
                  <CircleCheck size={14} />
                  <span>Cards moved here become</span>
                  <select
                    className="auto-progress"
                    value={list.autoProgress ?? ""}
                    onChange={(e) => updateList(list.id, { autoProgress: (e.target.value || null) as Progress | null })}
                  >
                    <option value="">(unchanged)</option>
                    <option value="notStarted">Not started</option>
                    <option value="inProgress">In progress</option>
                    <option value="waiting">Waiting</option>
                    <option value="onHold">On hold</option>
                    <option value="completed">Completed</option>
                  </select>
                </label>
                <MenuItem icon={<SlidersHorizontal size={14} />} onClick={() => (setDisplayOpen(true), close())}>
                  Card display{list.badges && Object.keys(list.badges).length ? " (custom)" : ""}…
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
                <MenuItem icon={<Archive size={14} />} onClick={() => (archiveList(list), close())}>
                  Archive bucket
                </MenuItem>
                <MenuItem
                  danger
                  icon={<Trash2 size={14} />}
                  onClick={() => {
                    close();
                    void deleteListAction(list);
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
      {displayOpen && list && <BucketDisplayDialog list={list} board={board} onClose={() => setDisplayOpen(false)} />}
      {completed.length > 0 && (
        <CompletedSection
          boardId={board.id}
          groupId={group.id}
          cards={completed}
          board={board}
          bucketName={(c) => (groupBy !== "bucket" ? listNames[c.listId] : undefined)}
        />
      )}
    </div>
  );
}

/** Stable empty value: a fresh [] in a selector re-renders forever. */
const NONE_EXPANDED: string[] = [];

function SortMenu({ list, lists, children }: { list: List; lists: List[]; children: (toggle: () => void) => React.ReactNode }) {
  const updateList = useStore((s) => s.updateList);
  return (
    <Popover align="right" trigger={(_, t) => children(t)}>
      {(close) => (
        <div className="menu sort-menu">
          <span className="menu-heading">Sort cards in “{list.title}”</span>
          {SORT_MODES.map((m) => (
            <button
              key={m.id}
              className="menu-item"
              onClick={() => {
                updateList(list.id, { sort: m.id, sortDesc: false });
                close();
              }}
            >
              <span className="ctx-icon">{list.sort === m.id && <Check size={14} />}</span>
              <span className="grow">
                {m.name}
                <small className="muted"> · {m.hint}</small>
              </span>
            </button>
          ))}
          {list.sort !== "custom" && (
            <label className="menu-item">
              <input type="checkbox" checked={list.sortDesc} onChange={(e) => updateList(list.id, { sortDesc: e.target.checked })} />
              <span>Reverse order</span>
            </label>
          )}
          <div className="ctx-sep" />
          <button
            className="menu-item"
            onClick={() => {
              for (const l of lists) if (l.id !== list.id) updateList(l.id, { sort: list.sort, sortDesc: list.sortDesc });
              close();
            }}
          >
            <span className="ctx-icon" />
            <span>Use this sort for every bucket on the board</span>
          </button>
          <p className="muted small sort-note">
            Sorting only changes how cards are shown. Your custom order is kept and comes back when you pick Custom order.
          </p>
        </div>
      )}
    </Popover>
  );
}

function CompletedSection({
  boardId,
  groupId,
  cards,
  board,
  bucketName,
}: {
  boardId: ID;
  groupId: string;
  cards: Card[];
  board: Board;
  bucketName: (c: Card) => string | undefined;
}) {
  const expanded = useStore((s) => s.data.ui[boardId]?.showCompleted ?? NONE_EXPANDED);
  const setBoardUi = useStore((s) => s.setBoardUi);
  const open = expanded.includes(groupId);
  return (
    <div className="completed-section">
      <button
        className="completed-toggle"
        onClick={() => setBoardUi(boardId, { showCompleted: open ? expanded.filter((x) => x !== groupId) : [...expanded, groupId] })}
      >
        {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
        {open ? "Hide completed" : "Show completed"}
        <span className="count">{cards.length}</span>
      </button>
      {open && (
        <div className="completed-cards">
          {cards.map((c) => (
            <CardTile key={c.id} card={c} board={board} bucketName={bucketName(c)} />
          ))}
        </div>
      )}
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
  const { when, chip } = useWhen(title);
  const submit = () => {
    if (!title.trim()) return;
    const w = withWhen(title, when);
    createCard(group.list?.id ?? lists[0].id, w.title, { ...group.patch!(null), ...w.extra });
    setTitle("");
  };
  const templates = useStore((s) => s.data.templates);
  if (!open)
    return (
      <div className="add-card-row">
        <button className="add-card-btn" onClick={() => setOpen(true)}>
          <Plus size={15} /> Add card
        </button>
        {templates.length > 0 && (
          <Popover
            align="right"
            trigger={(_, t) => (
              <button className="icon-btn" title="New card from template" onClick={t}>
                <LayoutTemplate size={15} />
              </button>
            )}
          >
            {(close) => (
              <div className="menu">
                <span className="menu-heading">New from template</span>
                {templates.map((t) => (
                  <MenuItem
                    key={t.id}
                    icon={<LayoutTemplate size={14} />}
                    onClick={() => {
                      close();
                      const id = useStore.getState().createFromTemplate(t.id, group.list?.id ?? lists[0].id, group.patch!(null));
                      useStore.getState().openCard(id);
                    }}
                  >
                    {t.name}
                  </MenuItem>
                ))}
              </div>
            )}
          </Popover>
        )}
      </div>
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
          if (e.key === "Escape") {
            e.currentTarget.value = ""; // so the blur that follows doesn't save
            setTitle("");
            setOpen(false);
          }
        }}
        // Clicking away keeps what was typed (Esc or × cancels).
        onBlur={(e) => {
          if (e.currentTarget.value.trim()) submit();
          setOpen(false);
        }}
      />
      {chip}
      <div className="row gap">
        <button className="btn primary sm" onMouseDown={(e) => e.preventDefault()} onClick={submit}>
          Add card
        </button>
        <button
          className="icon-btn"
          title="Cancel"
          onMouseDown={(e) => {
            e.preventDefault();
            setTitle("");
            setOpen(false);
          }}
        >
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
          if (e.key === "Escape") {
            e.currentTarget.value = ""; // so the blur that follows doesn't save
            setTitle("");
            setOpen(false);
          }
        }}
        // Clicking away keeps what was typed (Esc or × cancels).
        onBlur={(e) => {
          if (e.currentTarget.value.trim()) submit();
          setOpen(false);
        }}
      />
      <div className="row gap">
        <button className="btn primary sm" onMouseDown={(e) => e.preventDefault()} onClick={submit}>
          Add
        </button>
        <button
          className="icon-btn"
          title="Cancel"
          onMouseDown={(e) => {
            e.preventDefault();
            setTitle("");
            setOpen(false);
          }}
        >
          <X size={16} />
        </button>
      </div>
    </div>
  );
}

/** Per-bucket overrides of the board's "Show on cards" settings. */
function BucketDisplayDialog({ list, board, onClose }: { list: List; board: Board; onClose: () => void }) {
  const updateList = useStore((s) => s.updateList);
  const set = (key: BadgeKey, mode: BadgeMode | null) => {
    const next = { ...(list.badges ?? {}) };
    if (mode === null) delete next[key];
    else next[key] = mode;
    updateList(list.id, { badges: Object.keys(next).length ? next : undefined });
  };
  const label = (m: BadgeMode) => (m === "off" ? "Hidden" : m === "icon" ? "Icon" : "Details");
  return (
    <Modal onClose={onClose} width={560} className="customize">
      <header className="customize-head">
        <h2>Card display in “{list.title}”</h2>
        <button className="icon-btn" title="Close" aria-label="Close" onClick={onClose}>
          <X size={18} />
        </button>
      </header>
      <div className="customize-body">
        <p className="muted small">
          Overrides the board's settings for cards in this bucket only. “Board” follows the board (currently shown in brackets).
        </p>
        <div className="badge-modes">
          {BADGES.map((b) => {
            const own = list.badges?.[b.key];
            return (
              <div key={b.key} className="badge-mode-row">
                <span className="grow">{b.name}</span>
                <div className="seg">
                  <button className={!own ? "active" : ""} onClick={() => set(b.key, null)}>
                    Board ({label(board.display.badges[b.key])})
                  </button>
                  {(["off", "icon", "full"] as BadgeMode[]).map((m) => (
                    <button key={m} className={own === m ? "active" : ""} onClick={() => set(b.key, m)}>
                      {label(m)}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
        <div className="badge-mode-row">
          <span className="grow">Ticked checklist items</span>
          <div className="seg">
            <button className={list.hideChecked === undefined ? "active" : ""} onClick={() => updateList(list.id, { hideChecked: undefined })}>
              Board ({board.display.hideChecked ? "Hidden" : "Shown"})
            </button>
            <button className={list.hideChecked === false ? "active" : ""} onClick={() => updateList(list.id, { hideChecked: false })}>
              Shown
            </button>
            <button className={list.hideChecked === true ? "active" : ""} onClick={() => updateList(list.id, { hideChecked: true })}>
              Hidden
            </button>
          </div>
        </div>
        {list.badges && (
          <button className="btn sm ghost" onClick={() => updateList(list.id, { badges: undefined })}>
            Use the board's settings for everything
          </button>
        )}
      </div>
    </Modal>
  );
}
