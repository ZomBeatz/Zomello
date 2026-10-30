import { useEffect, useMemo, useState } from "react";
import { exportBoard } from "../boardFile";
import { isMobileApp } from "../storage";
import { archiveBoard, deleteBoard as deleteBoardAction } from "../actions";
import { isServer, leaveBoard, ownsBoard } from "../server";
import {
  Archive,
  BarChart3,
  Bookmark,
  CalendarDays,
  Copy,
  Filter as FilterIcon,
  GitFork,
  GanttChart,
  Kanban,
  MoreHorizontal,
  AppWindow,
  Bot,
  ClipboardCopy,
  LayoutTemplate,
  Palette,
  Plus,
  Rows3,
  Search,
  Star,
  Tag,
  Trash2,
  Users,
  LogOut,
  ArrowRightLeft,
  CircleDot,
  Flag,
  Sun,
  X, FileDown, ClipboardPaste } from "lucide-react";
import type { Board, Card, DueFilter, Filter, GroupBy, ID, ViewMode } from "../types";
import { useBoardUi, useStore } from "../store";
import { addDays, format, nextMonday, parseISO } from "date-fns";
import { byOrder, emptyFilter, filterIsActive, matchesFilter, PALETTE, PRIORITIES, PROGRESS, relatedSet, toISO, uid } from "../utils";
import { ask, Avatar, ColorPicker, InlineEdit, MenuItem, Popover } from "./ui";
import { KanbanView } from "./views/KanbanView";
import { BucketPicker, LabelPicker } from "./pickers";
import { ListView } from "./views/ListView";
import { CalendarView } from "./views/CalendarView";
import { TimelineView } from "./views/TimelineView";
import { ChartsView } from "./views/ChartsView";
import { copyText } from "./Markdown";
import { workOrder } from "../ai";
import { parsePastedCards } from "../cardClipboard";
import { isBoardWindow, openBoardWindow } from "../windows";
import { boardBackground } from "./BoardCustomize";

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

  // Pasting copied cards anywhere on the board (not into a text box) offers to add them.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t?.closest("input, textarea, select, [contenteditable='true']")) return;
      const st = useStore.getState();
      if (st.openCardId || st.pasteCards) return;
      const text = e.clipboardData?.getData("text/plain") ?? "";
      try {
        if (!parsePastedCards(text).length) return;
      } catch {
        return;
      }
      e.preventDefault();
      st.setOverlay({ pasteCards: { boardId, text } });
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, [boardId]);

  const lists = useMemo(
    () => Object.values(allLists).filter((l) => l.boardId === boardId && !l.archived).sort(byOrder),
    [allLists, boardId],
  );
  const cards = useMemo(() => {
    const live = new Set(lists.map((l) => l.id));
    const related = ui.filter.relatedTo ? relatedSet(ui.filter.relatedTo, allCards, ui.filter.relatedDeep) : null;
    return Object.values(allCards).filter(
      (c) =>
        c.boardId === boardId && !c.archived && live.has(c.listId) && matchesFilter(c, ui.filter) && (!related || related.has(c.id)),
    );
  }, [allCards, lists, boardId, ui.filter]);

  if (!board) return null;

  return (
    <div
      className={`board-page ${board.background.type !== "none" ? "has-bg" : ""} cols-${board.display.columnWidth}`}
      style={{ "--board": board.color, "--board-bg": boardBackground(board) } as React.CSSProperties}
    >
      <BoardHeader board={board} view={ui.view} />
      <Toolbar board={board} ui={ui} people={people} count={cards.length} />
      <div className="board-stage">
      {board.background.type !== "none" && (
        <div
          className="board-bg"
          aria-hidden="true"
          style={{
            filter: board.backgroundFx.blur ? `blur(${board.backgroundFx.blur}px)` : undefined,
            // Blurring softens the edges; scale up slightly so they stay off-screen.
            transform: board.backgroundFx.blur ? `scale(${1 + board.backgroundFx.blur / 200})` : undefined,
            "--dim": board.backgroundFx.dim / 100,
          } as React.CSSProperties}
        />
      )}
      <div
        className="board-content"
        onClick={(e) => {
          // A click on empty board space ends picking cards.
          const t = e.target as Element;
          if (useStore.getState().selected.length && !t.closest(".card-tile, button, a, input, select, textarea, label, [contenteditable], .popover, .ctx-menu, .modal"))
            useStore.getState().clearSelected();
        }}
      >
        {ui.view === "board" && <KanbanView board={board} lists={lists} cards={cards} groupBy={ui.groupBy} />}
        {ui.view === "list" && <ListView board={board} lists={lists} cards={cards} />}
        {ui.view === "calendar" && <CalendarView board={board} lists={lists} cards={cards} />}
        {ui.view === "timeline" && <TimelineView lists={lists} cards={cards} />}
        {ui.view === "charts" && <ChartsView lists={lists} cards={cards} people={people} />}
      </div>
      </div>
      <SelectionBar boardId={boardId} />
    </div>
  );
}

function BoardHeader({ board, view }: { board: Board; view: ViewMode }) {
  const { updateBoard, duplicateBoard, navigate, setBoardUi } = useStore.getState();
  return (
    <header className="board-header">
      {board.icon ? <span className="board-icon">{board.icon}</span> : <span className="board-swatch" style={{ background: board.color }} />}
      <span className="board-title-wrap" title={board.title}>
        <InlineEdit className="board-title" value={board.title} onSave={(title) => updateBoard(board.id, { title })} />
      </span>
      <button
        className={`icon-btn ${board.starred ? "starred" : ""}`}
        title={board.starred ? "Unstar" : "Star"}
        onClick={() => updateBoard(board.id, { starred: !board.starred })}
      >
        <Star size={17} fill={board.starred ? "currentColor" : "none"} />
      </button>
      <nav className="view-tabs" aria-label="Board views">
        {VIEWS.map((v, i) => (
          <button
            key={v.id}
            className={view === v.id ? "active" : ""}
            onClick={() => setBoardUi(board.id, { view: v.id })}
            title={`${v.name} (${i + 1})`}
            aria-label={v.name}
            aria-pressed={view === v.id}
          >
            {v.icon}
            <span className="tab-label">{v.name}</span>
          </button>
        ))}
      </nav>
      <div className="grow" />
      <LabelManager board={board} />
      <button className="btn ghost sm" title="Customize (B)" aria-label="Customize" onClick={() => useStore.getState().setOverlay({ customizeBoardId: board.id })}>
        <Palette size={14} /> <span className="btn-label">Customize</span>
      </button>
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
            <MenuItem
              icon={<Palette size={14} />}
              onClick={() => {
                close();
                useStore.getState().setOverlay({ customizeBoardId: board.id });
              }}
            >
              Customize board…
            </MenuItem>
            {isServer && (
              <MenuItem
                icon={<Users size={14} />}
                onClick={() => {
                  close();
                  useStore.getState().setOverlay({ shareBoardId: board.id });
                }}
              >
                {ownsBoard(board) ? "Share…" : "People on this board…"}
              </MenuItem>
            )}
            <MenuItem icon={<Copy size={14} />} onClick={() => (close(), navigate({ page: "board", boardId: duplicateBoard(board.id) }))}>
              Duplicate board
            </MenuItem>
            {!isBoardWindow && !isMobileApp && (
              <MenuItem
                icon={<AppWindow size={14} />}
                onClick={() => {
                  close();
                  void openBoardWindow(board.id, board.title);
                }}
              >
                Open in new window
              </MenuItem>
            )}
            <MenuItem
              icon={<Bot size={14} />}
              onClick={() => {
                close();
                useStore.getState().setOverlay({ aiDialog: { tab: "ask", mode: "cards", boardId: board.id } });
              }}
            >
              AI tools (prompts & export)…
            </MenuItem>
            <MenuItem
              icon={<ClipboardCopy size={14} />}
              onClick={() => {
                close();
                const all = Object.values(useStore.getState().data.cards).filter((c) => c.boardId === board.id);
                copyText(workOrder(board.id, all, `${board.title}: open items`));
              }}
            >
              Copy work order (all open cards)
            </MenuItem>
            <MenuItem
              icon={<ClipboardPaste size={14} />}
              onClick={() => {
                close();
                useStore.getState().setOverlay({ pasteCards: { boardId: board.id } });
              }}
            >
              Paste cards…
            </MenuItem>
            <MenuItem
              icon={<LayoutTemplate size={14} />}
              onClick={() => {
                close();
                navigate({
                  page: "board",
                  boardId: duplicateBoard(board.id, { title: `New ${board.title}`, withCards: false }),
                });
              }}
            >
              New board with this layout
            </MenuItem>
            <MenuItem
              icon={<FileDown size={14} />}
              onClick={() => {
                close();
                void exportBoard(board.id);
              }}
            >
              Save as board file…
            </MenuItem>
            {ownsBoard(board) ? (
              <>
                <MenuItem
                  icon={<Archive size={14} />}
                  onClick={() => {
                    close();
                    archiveBoard(board);
                  }}
                >
                  Archive board
                </MenuItem>
                <MenuItem
                  danger
                  icon={<Trash2 size={14} />}
                  onClick={() => {
                    close();
                    void deleteBoardAction(board);
                  }}
                >
                  Delete board
                </MenuItem>
              </>
            ) : (
              <MenuItem
                danger
                icon={<LogOut size={14} />}
                onClick={() => {
                  close();
                  void leaveBoard(board.id).then(() => useStore.getState().toast(`You left “${board.title}”`));
                }}
              >
                Leave board
              </MenuItem>
            )}
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
        <button className="btn ghost sm" onClick={toggle} title="Labels" aria-label="Labels">
          <Tag size={14} /> <span className="btn-label">Labels</span>
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
  const relatedTitle = useStore((s) => (f.relatedTo ? s.data.cards[f.relatedTo]?.title : undefined));
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
          placeholder="Filter cards…" spellCheck={false}
          value={f.text}
          onChange={(e) => setFilter(board.id, { text: e.target.value })}
        />
        {f.text && (
          <button className="icon-btn tiny" title="Clear" aria-label="Clear" onClick={() => setFilter(board.id, { text: "" })}>
            <X size={13} />
          </button>
        )}
      </div>

      <Popover
        trigger={(_, t) => (
          <button className={`btn sm ${nActive ? "accent" : "ghost"}`} onClick={t}>
            <FilterIcon size={14} /> <span className="btn-label">Filter</span>{nActive ? ` (${nActive})` : ""}
          </button>
        )}
      >
        {(close) => (
          <div className="menu filter-menu">
            {(saved.length > 0 || active) && (
              <>
                <span className="menu-heading">Saved filters</span>
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
                    <button className="icon-btn tiny" title="Delete this saved filter" onClick={() => deleteSavedFilter(s.id)}>
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
                      placeholder="Save this filter as…"
                      value={saveName}
                      onChange={(e) => setSaveName(e.target.value)}
                    />
                    <button className="btn sm" type="submit" disabled={!saveName.trim()}>
                      Save
                    </button>
                  </form>
                )}
              </>
            )}
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

      {f.relatedTo && (
        <span className="related-chip" title="Showing only this card and the cards related to it">
          <GitFork size={13} />
          <span className="ellipsis">Related to “{relatedTitle ?? "deleted card"}”</span>
          <label className="check-row small" title="Follow the relations all the way (sub-tasks of sub-tasks, etc.)">
            <input type="checkbox" checked={f.relatedDeep} onChange={(e) => setFilter(board.id, { relatedDeep: e.target.checked })} />
            Whole chain
          </label>
          <button className="icon-btn tiny" title="Stop filtering by related tasks" onClick={() => setFilter(board.id, { relatedTo: null, relatedDeep: false })}>
            <X size={12} />
          </button>
        </span>
      )}
      {active && (
        <button className="btn ghost sm" onClick={() => setBoardUi(board.id, { filter: emptyFilter() })}>
          <X size={14} /> Clear
        </button>
      )}
      {active && <span className="muted small">{count} {count === 1 ? "match" : "matches"}</span>}

      <div className="grow" />
      {ui.view === "board" && (
        <label className="group-by">
          <span className="gb-label">Group by</span>
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

/** Shown while cards are picked (Ctrl+click, or Select on a card's menu): changes for all of them at once. */
function SelectionBar({ boardId }: { boardId: ID }) {
  const selected = useStore((s) => s.selected);
  const cards = useStore((s) => s.data.cards);
  const board = useStore((s) => s.data.boards[boardId]);
  const { setOverlay, clearSelected, updateCard, toast } = useStore.getState();
  const picked = selected.map((id) => cards[id]).filter(Boolean);
  if (!picked.length || !board) return null;
  const n = picked.length;
  const plural = `${n} card${n === 1 ? "" : "s"}`;
  const each = (patch: (c: Card) => Partial<Card> | null, done: string) => {
    let changed = 0;
    for (const c of picked) {
      const p = patch(c);
      if (p) (updateCard(c.id, p), changed++);
    }
    toast(changed ? `${done} ${changed} card${changed === 1 ? "" : "s"}` : "Nothing to change", { undo: changed > 0 });
  };
  // Labels (and people) on every picked card show as ticked; ticking adds to all, unticking removes from all.
  const shared = board.labels.filter((l) => picked.every((c) => c.labelIds.includes(l.id))).map((l) => l.id);
  const people = useStore.getState().data.settings.people;
  const today = new Date();
  const due = (d: Date | null) => each(() => ({ dueDate: d ? toISO(d) : null }), d ? `Due ${format(d, "EEE MMM d")}:` : "Removed the due date from");
  // Pushes every date on a card back (start, due), keeping how long it runs; cards with no dates stay as they are.
  const later = (days: number) =>
    each(
      (c) =>
        c.dueDate || c.startDate
          ? {
              dueDate: c.dueDate && toISO(addDays(parseISO(c.dueDate), days)),
              startDate: c.startDate && toISO(addDays(parseISO(c.startDate), days)),
            }
          : null,
      `Moved ${days === 1 ? "a day" : "a week"} later:`,
    );
  return (
    <div className="selection-bar" role="toolbar" aria-label="Selected cards">
      <span className="sel-count">{n} selected</span>
      <Popover trigger={(_, t) => <button className="btn sm" onClick={t}><CircleDot size={14} /> Progress</button>}>
        {(close) => (
          <div className="menu">
            {PROGRESS.map((p) => (
              <MenuItem key={p.id} icon={<span className="dot" style={{ background: p.color }} />} onClick={() => (each(() => ({ progress: p.id }), `Set to ${p.name}:`), close())}>
                {p.name}
              </MenuItem>
            ))}
          </div>
        )}
      </Popover>
      <Popover trigger={(_, t) => <button className="btn sm" onClick={t}><Flag size={14} /> Priority</button>}>
        {(close) => (
          <div className="menu">
            {PRIORITIES.map((p) => (
              <MenuItem key={p.id} icon={<span className="dot" style={{ background: p.color }} />} onClick={() => (each(() => ({ priority: p.id }), `Set to ${p.name}:`), close())}>
                {p.name}
              </MenuItem>
            ))}
          </div>
        )}
      </Popover>
      <Popover trigger={(_, t) => <button className="btn sm" onClick={t}><Tag size={14} /> Labels</button>}>
        {() => (
          <LabelPicker
            board={board}
            selected={shared}
            onToggle={(id, on) =>
              each(
                (c) => (on ? (c.labelIds.includes(id) ? null : { labelIds: [...c.labelIds, id] }) : c.labelIds.includes(id) ? { labelIds: c.labelIds.filter((x) => x !== id) } : null),
                on ? "Labeled" : "Unlabeled",
              )
            }
          />
        )}
      </Popover>
      <Popover trigger={(_, t) => <button className="btn sm" onClick={t}><CalendarDays size={14} /> Dates</button>}>
        {(close) => (
          <div className="menu">
            <MenuItem onClick={() => (due(today), close())}>Due today</MenuItem>
            <MenuItem onClick={() => (due(addDays(today, 1)), close())}>Due tomorrow</MenuItem>
            <MenuItem onClick={() => (due(nextMonday(today)), close())}>Due next Monday</MenuItem>
            <label className="menu-item">
              <span>Due on</span>
              <input type="date" className="sel-date" onChange={(e) => e.target.value && (due(parseISO(e.target.value)), close())} />
            </label>
            <div className="menu-sep" />
            <MenuItem onClick={() => (later(1), close())}>A day later</MenuItem>
            <MenuItem onClick={() => (later(7), close())}>A week later</MenuItem>
            <div className="menu-sep" />
            <MenuItem onClick={() => (due(null), close())}>Remove due date</MenuItem>
          </div>
        )}
      </Popover>
      {people.length > 0 && (
        <Popover trigger={(_, t) => <button className="btn sm" onClick={t}><Users size={14} /> People</button>}>
          {() => (
            <div className="menu">
              {people.map((p) => {
                const all = picked.every((c) => c.assignees.includes(p));
                return (
                  <label key={p} className="menu-item">
                    <input
                      type="checkbox"
                      checked={all}
                      onChange={() =>
                        each(
                          (c) => (all ? { assignees: c.assignees.filter((x) => x !== p) } : c.assignees.includes(p) ? null : { assignees: [...c.assignees, p] }),
                          all ? `Unassigned ${p} from` : `Assigned ${p} to`,
                        )
                      }
                    />
                    <Avatar name={p} size={18} />
                    <span>{p}</span>
                  </label>
                );
              })}
            </div>
          )}
        </Popover>
      )}
      <Popover trigger={(_, t) => <button className="btn sm" onClick={t}><ArrowRightLeft size={14} /> Move</button>}>
        {(close) => (
          <BucketPicker
            defaultBoardId={boardId}
            defaultListId={picked[0].listId}
            action={`Move ${plural}`}
            onPick={(listId) => {
              const st = useStore.getState();
              const to = st.data.lists[listId];
              for (const c of picked) {
                if (to.boardId === c.boardId) st.moveCardToList(c.id, listId);
                else st.moveCardToBoard(c.id, to.boardId, listId);
              }
              toast(`Moved ${plural} to ${to.title}`, { undo: true });
              close();
              clearSelected();
            }}
          />
        )}
      </Popover>
      <button
        className="btn sm"
        onClick={() => {
          each(() => ({ archived: true }), "Archived");
          clearSelected();
        }}
      >
        <Archive size={14} /> Archive
      </button>
      <button
        className="btn sm danger"
        onClick={async () => {
          if (!(await ask(`Delete ${plural}? You can undo this right after.`, { okText: "Delete", danger: true }))) return;
          for (const c of picked) useStore.getState().deleteCard(c.id);
          toast(`Deleted ${plural}`, { undo: true });
          clearSelected();
        }}
      >
        <Trash2 size={14} /> Delete
      </button>
      <Popover align="right" trigger={(_, t) => <button className="icon-btn" title="More" aria-label="More" onClick={t}><MoreHorizontal size={15} /></button>}>
        {(close) => (
          <div className="menu">
            <MenuItem icon={<Sun size={14} />} onClick={() => (each(() => ({ myDay: toISO(today) }), "Added to My Day:"), close())}>
              Add to My Day
            </MenuItem>
            <MenuItem
              icon={<Copy size={14} />}
              onClick={() => {
                const st = useStore.getState();
                const copies = picked.map((c) => st.duplicateCard(c.id));
                toast(`Duplicated ${plural}`, { undo: true });
                close();
                // The copies are picked now, so they can be moved or changed straight away.
                clearSelected();
                st.selectCards(copies);
              }}
            >
              Duplicate
            </MenuItem>
            <div className="menu-sep" />
            <MenuItem icon={<ClipboardCopy size={14} />} onClick={() => (copyText(workOrder(boardId, picked, `${n} selected cards`)), close())}>
              Copy work order
            </MenuItem>
            <MenuItem icon={<Bot size={14} />} onClick={() => (setOverlay({ aiDialog: { tab: "export", boardId, cardIds: selected } }), close())}>
              Hand to AI…
            </MenuItem>
          </div>
        )}
      </Popover>
      <button className="icon-btn" title="Clear selection (Esc)" aria-label="Clear selection" onClick={clearSelected}>
        <X size={15} />
      </button>
      <span className="muted small sel-hint">Click cards to add or remove, Shift+click for a range. Esc or a click on empty space clears.</span>
    </div>
  );
}
