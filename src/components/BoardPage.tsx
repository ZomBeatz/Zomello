import { useMemo, useState } from "react";
import {
  Archive,
  BarChart3,
  Bookmark,
  CalendarDays,
  Copy,
  Filter as FilterIcon,
  GanttChart,
  Kanban,
  MoreHorizontal,
  Palette,
  Plus,
  Rows3,
  Search,
  Star,
  Tag,
  Trash2,
  X,
} from "lucide-react";
import type { Board, DueFilter, Filter, GroupBy, ID, ViewMode } from "../types";
import { useBoardUi, useStore } from "../store";
import { byOrder, emptyFilter, filterIsActive, matchesFilter, PALETTE, PRIORITIES, PROGRESS, uid } from "../utils";
import { ask, Avatar, ColorPicker, InlineEdit, MenuItem, Popover } from "./ui";
import { KanbanView } from "./views/KanbanView";
import { ListView } from "./views/ListView";
import { CalendarView } from "./views/CalendarView";
import { TimelineView } from "./views/TimelineView";
import { ChartsView } from "./views/ChartsView";

const VIEWS: { id: ViewMode; name: string; icon: React.ReactNode }[] = [
  { id: "board", name: "Board", icon: <Kanban size={15} /> },
  { id: "list", name: "List", icon: <Rows3 size={15} /> },
  { id: "calendar", name: "Calendar", icon: <CalendarDays size={15} /> },
  { id: "timeline", name: "Timeline", icon: <GanttChart size={15} /> },
  { id: "charts", name: "Charts", icon: <BarChart3 size={15} /> },
];
const GROUPS: { id: GroupBy; name: string }[] = [
  { id: "bucket", name: "Bucket" },
  { id: "progress", name: "Progress" },
  { id: "priority", name: "Priority" },
  { id: "assignee", name: "Assigned to" },
  { id: "label", name: "Label" },
  { id: "due", name: "Due date" },
];

export function BoardPage({ boardId }: { boardId: ID }) {
  const board = useStore((s) => s.data.boards[boardId]);
  const allLists = useStore((s) => s.data.lists);
  const allCards = useStore((s) => s.data.cards);
  const people = useStore((s) => s.data.settings.people);
  const ui = useBoardUi(boardId);

  const lists = useMemo(
    () => Object.values(allLists).filter((l) => l.boardId === boardId && !l.archived).sort(byOrder),
    [allLists, boardId],
  );
  const cards = useMemo(() => {
    const live = new Set(lists.map((l) => l.id));
    return Object.values(allCards).filter(
      (c) => c.boardId === boardId && !c.archived && live.has(c.listId) && matchesFilter(c, ui.filter),
    );
  }, [allCards, lists, boardId, ui.filter]);

  if (!board) return null;

  return (
    <div className="board-page" style={{ "--board": board.color } as React.CSSProperties}>
      <BoardHeader board={board} view={ui.view} />
      <Toolbar board={board} ui={ui} people={people} count={cards.length} />
      <div className="board-content">
        {ui.view === "board" && <KanbanView board={board} lists={lists} cards={cards} groupBy={ui.groupBy} />}
        {ui.view === "list" && <ListView board={board} lists={lists} cards={cards} />}
        {ui.view === "calendar" && <CalendarView board={board} lists={lists} cards={cards} />}
        {ui.view === "timeline" && <TimelineView lists={lists} cards={cards} />}
        {ui.view === "charts" && <ChartsView lists={lists} cards={cards} people={people} />}
      </div>
    </div>
  );
}

function BoardHeader({ board, view }: { board: Board; view: ViewMode }) {
  const { updateBoard, deleteBoard, duplicateBoard, navigate, setBoardUi } = useStore.getState();
  return (
    <header className="board-header">
      <span className="board-swatch" style={{ background: board.color }} />
      <InlineEdit className="board-title" value={board.title} onSave={(title) => updateBoard(board.id, { title })} />
      <button
        className={`icon-btn ${board.starred ? "starred" : ""}`}
        title={board.starred ? "Unstar" : "Star"}
        onClick={() => updateBoard(board.id, { starred: !board.starred })}
      >
        <Star size={17} fill={board.starred ? "currentColor" : "none"} />
      </button>
      <nav className="view-tabs">
        {VIEWS.map((v) => (
          <button key={v.id} className={view === v.id ? "active" : ""} onClick={() => setBoardUi(board.id, { view: v.id })}>
            {v.icon}
            {v.name}
          </button>
        ))}
      </nav>
      <div className="grow" />
      <LabelManager board={board} />
      <Popover
        align="right"
        trigger={(_, toggle) => (
          <button className="icon-btn" onClick={toggle} title="Board menu">
            <MoreHorizontal size={18} />
          </button>
        )}
      >
        {(close) => (
          <div className="menu" style={{ width: 250 }}>
            <div className="menu-section">
              <span className="menu-heading">
                <Palette size={13} /> Board color
              </span>
              <ColorPicker value={board.color} onChange={(color) => updateBoard(board.id, { color: color ?? PALETTE[6] })} />
            </div>
            <MenuItem icon={<Copy size={14} />} onClick={() => (close(), navigate({ page: "board", boardId: duplicateBoard(board.id) }))}>
              Duplicate board
            </MenuItem>
            <MenuItem
              icon={<Archive size={14} />}
              onClick={() => {
                close();
                updateBoard(board.id, { archived: true });
                navigate({ page: "home" });
              }}
            >
              Archive board
            </MenuItem>
            <MenuItem
              danger
              icon={<Trash2 size={14} />}
              onClick={async () => {
                close();
                if (await ask(`Delete board "${board.title}" and everything in it? This can't be undone.`, { okText: "Delete board", danger: true }))
                  deleteBoard(board.id);
              }}
            >
              Delete board
            </MenuItem>
          </div>
        )}
      </Popover>
    </header>
  );
}

function LabelManager({ board }: { board: Board }) {
  const updateBoard = useStore((s) => s.updateBoard);
  const setLabels = (labels: Board["labels"]) => updateBoard(board.id, { labels });
  return (
    <Popover
      align="right"
      trigger={(_, toggle) => (
        <button className="btn ghost sm" onClick={toggle}>
          <Tag size={14} /> Labels
        </button>
      )}
    >
      {() => (
        <div className="menu label-manager">
          <span className="menu-heading">Board labels</span>
          {board.labels.map((l) => (
            <div key={l.id} className="label-edit-row">
              <Popover
                trigger={(_, toggle) => <button className="swatch" style={{ background: l.color }} onClick={toggle} />}
              >
                {(close) => (
                  <div className="menu">
                    <ColorPicker
                      value={l.color}
                      onChange={(color) => {
                        setLabels(board.labels.map((x) => (x.id === l.id ? { ...x, color: color! } : x)));
                        close();
                      }}
                    />
                  </div>
                )}
              </Popover>
              <input
                value={l.name}
                onChange={(e) => setLabels(board.labels.map((x) => (x.id === l.id ? { ...x, name: e.target.value } : x)))}
              />
              <button
                className="icon-btn tiny"
                title="Delete label"
                onClick={() => {
                  setLabels(board.labels.filter((x) => x.id !== l.id));
                  // Strip it from cards too.
                  const { data, updateCard } = useStore.getState();
                  Object.values(data.cards)
                    .filter((c) => c.boardId === board.id && c.labelIds.includes(l.id))
                    .forEach((c) => updateCard(c.id, { labelIds: c.labelIds.filter((x) => x !== l.id) }));
                }}
              >
                <X size={13} />
              </button>
            </div>
          ))}
          <button
            className="menu-item"
            onClick={() =>
              setLabels([...board.labels, { id: uid(), name: "", color: PALETTE[board.labels.length % PALETTE.length] }])
            }
          >
            <Plus size={14} /> <span>Add label</span>
          </button>
        </div>
      )}
    </Popover>
  );
}

function Toolbar({
  board,
  ui,
  people,
  count,
}: {
  board: Board;
  ui: ReturnType<typeof useBoardUi>;
  people: string[];
  count: number;
}) {
  const { setFilter, setBoardUi, saveFilter, deleteSavedFilter } = useStore.getState();
  const saved = useStore((s) => s.data.savedFilters).filter((f) => f.boardId === board.id);
  const f = ui.filter;
  const active = filterIsActive(f);
  const nActive =
    f.labelIds.length + f.priorities.length + f.progress.length + f.assignees.length + (f.due !== "any" ? 1 : 0);
  const [saveName, setSaveName] = useState("");

  const toggle = <K extends keyof Filter>(key: K, v: Filter[K] extends (infer T)[] ? T : never) => {
    const arr = f[key] as unknown[];
    setFilter(board.id, { [key]: arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v] } as Partial<Filter>);
  };

  return (
    <div className="toolbar">
      <div className="search-box">
        <Search size={15} />
        <input
          placeholder="Filter cards…"
          value={f.text}
          onChange={(e) => setFilter(board.id, { text: e.target.value })}
        />
        {f.text && (
          <button className="icon-btn tiny" onClick={() => setFilter(board.id, { text: "" })}>
            <X size={13} />
          </button>
        )}
      </div>

      <Popover
        trigger={(_, t) => (
          <button className={`btn sm ${nActive ? "accent" : "ghost"}`} onClick={t}>
            <FilterIcon size={14} /> Filter{nActive ? ` (${nActive})` : ""}
          </button>
        )}
      >
        {() => (
          <div className="menu filter-menu">
            <span className="menu-heading">Due</span>
            <div className="seg wrap">
              {(
                [
                  ["any", "Any"],
                  ["overdue", "Late"],
                  ["today", "Today"],
                  ["week", "Next 7 days"],
                  ["none", "No date"],
                ] as [DueFilter, string][]
              ).map(([id, name]) => (
                <button key={id} className={f.due === id ? "active" : ""} onClick={() => setFilter(board.id, { due: id })}>
                  {name}
                </button>
              ))}
            </div>
            <span className="menu-heading">Progress</span>
            {PROGRESS.map((p) => (
              <label key={p.id} className="menu-item">
                <input type="checkbox" checked={f.progress.includes(p.id)} onChange={() => toggle("progress", p.id)} />
                <span className="dot" style={{ background: p.color }} />
                <span>{p.name}</span>
              </label>
            ))}
            <span className="menu-heading">Priority</span>
            {PRIORITIES.map((p) => (
              <label key={p.id} className="menu-item">
                <input type="checkbox" checked={f.priorities.includes(p.id)} onChange={() => toggle("priorities", p.id)} />
                <span className="dot" style={{ background: p.color }} />
                <span>{p.name}</span>
              </label>
            ))}
            <span className="menu-heading">Labels</span>
            {board.labels.map((l) => (
              <label key={l.id} className="menu-item">
                <input type="checkbox" checked={f.labelIds.includes(l.id)} onChange={() => toggle("labelIds", l.id)} />
                <span className="label-pill" style={{ background: l.color }}>
                  {l.name || "Unnamed"}
                </span>
              </label>
            ))}
            <span className="menu-heading">Assigned to</span>
            <label className="menu-item">
              <input type="checkbox" checked={f.assignees.includes("")} onChange={() => toggle("assignees", "")} />
              <span>Unassigned</span>
            </label>
            {people.map((p) => (
              <label key={p} className="menu-item">
                <input type="checkbox" checked={f.assignees.includes(p)} onChange={() => toggle("assignees", p)} />
                <Avatar name={p} size={18} />
                <span>{p}</span>
              </label>
            ))}
          </div>
        )}
      </Popover>

      <Popover
        trigger={(_, t) => (
          <button className="btn ghost sm" onClick={t}>
            <Bookmark size={14} /> Saved
          </button>
        )}
      >
        {(close) => (
          <div className="menu" style={{ width: 260 }}>
            <span className="menu-heading">Saved filters</span>
            {saved.length === 0 && <p className="muted small pad">None yet.</p>}
            {saved.map((s) => (
              <div key={s.id} className="row">
                <button
                  className="menu-item grow"
                  onClick={() => {
                    setBoardUi(board.id, { filter: { ...emptyFilter(), ...s.filter } });
                    close();
                  }}
                >
                  <Bookmark size={14} /> <span>{s.name}</span>
                </button>
                <button className="icon-btn tiny" onClick={() => deleteSavedFilter(s.id)}>
                  <X size={13} />
                </button>
              </div>
            ))}
            {active && (
              <form
                className="row gap-sm pad-sm"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!saveName.trim()) return;
                  saveFilter(board.id, saveName.trim(), f);
                  setSaveName("");
                }}
              >
                <input
                  className="grow"
                  placeholder="Save current filter as…"
                  value={saveName}
                  onChange={(e) => setSaveName(e.target.value)}
                />
                <button className="btn sm" type="submit">
                  Save
                </button>
              </form>
            )}
          </div>
        )}
      </Popover>

      {active && (
        <button className="btn ghost sm" onClick={() => setBoardUi(board.id, { filter: emptyFilter() })}>
          <X size={14} /> Clear
        </button>
      )}
      {active && <span className="muted small">{count} match</span>}

      <div className="grow" />
      {ui.view === "board" && (
        <label className="group-by">
          Group by
          <select value={ui.groupBy} onChange={(e) => setBoardUi(board.id, { groupBy: e.target.value as GroupBy })}>
            {GROUPS.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  );
}
