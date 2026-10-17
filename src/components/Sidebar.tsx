import { useMemo, useRef, useState } from "react";
import { useDragSensors, useIsPhone } from "../mobile";
import {
  Archive, ChevronDown, ChevronRight, ChevronsLeft, ChevronsRight, CircleHelp, LogOut, Shield, UserCog, Home, Hourglass, Pause, Play, Plus, Search, Settings, Star, UserCheck, Users, X, Zap, ExternalLink, Server as ServerIcon,
} from "lucide-react";
import { runningTimer, useStore } from "../store";
import type { Board, ID, Route } from "../types";
import { closestCenter, DndContext, type DragEndEvent } from "@dnd-kit/core";
import { arrayMove, SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { restrictToVerticalAxis } from "@dnd-kit/modifiers";
import { CSS } from "@dnd-kit/utilities";
import { openContextMenu } from "./ContextMenu";
import { boardMenu, categoryMenu } from "./boardMenu";
import { isBoardWindow, openBoardWindow } from "../windows";
import { boardCategories, byOrder, formatDuration, parseDuration } from "../utils";
import { Popover } from "./ui";
import { LogoMark, Wordmark } from "./Logo";
import { useNow } from "./useNow";
import { logoClicked } from "../easterEgg";
import { SpinCat } from "./SpinCat";
import { isServer, logout, me } from "../server";
import { NO_SERVERS, openServer } from "../servers";
import { isRemote } from "../remote";
import { Avatar } from "./ui";

export function Sidebar() {
  const boards = useStore((s) => s.data.boards);
  const route = useStore((s) => s.route);
  const savedCollapsed = useStore((s) => s.data.settings.sidebarCollapsed);
  // Board windows start with a slim sidebar (their own toggle, not the saved setting).
  const [winCollapsed, setWinCollapsed] = useState(true);
  // On a phone the sidebar is a slide-out drawer, always shown in full.
  const phone = useIsPhone();
  const collapsed = phone ? false : isBoardWindow ? winCollapsed : savedCollapsed;
  const { navigate, createBoard, setOverlay, updateSettings } = useStore.getState();
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");

  const live = useMemo(() => Object.values(boards).filter((b) => !b.archived).sort(byOrder), [boards]);
  const starred = live.filter((b) => b.starred);
  // Optional categories group the boards; with none, it's one plain list as before.
  const categories = useMemo(() => boardCategories(live), [live]);
  const loose = categories.length && !collapsed ? live.filter((b) => !b.category) : live;
  const collapsedCats = useStore((s) => s.data.settings.collapsedCategories);
  const activeId = route.page === "board" ? route.boardId : null;

  const [renaming, setRenaming] = useState<ID | null>(null);
  const [dancing, setDancing] = useState(false);
  const style = useStore((s) => s.data.settings.style);
  const homeTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const burst = useRef<{ from: Route | null; last: number }>({ from: null, last: 0 });

  const NavItem = ({ icon, label, onClick, on, kbd }: { icon: React.ReactNode; label: string; onClick: () => void; on?: boolean; kbd?: string }) => (
    <button className={`nav-item ${on ? "active" : ""}`} onClick={onClick} title={collapsed ? label : undefined}>
      {icon}
      <span className="label">{label}</span>
      {kbd && <kbd className="label">{kbd}</kbd>}
    </button>
  );

  return (
    <aside className={`sidebar ${collapsed ? "collapsed" : ""}`}>
      <div className="brand">
        <button
          className="logo-btn"
          aria-label="Zomello: go to Home"
          title="Home"
          onClick={() => {
            // Remember where this burst of clicks started.
            const now = Date.now();
            if (now - burst.current.last > 1500) burst.current.from = useStore.getState().route;
            burst.current.last = now;
            clearTimeout(homeTimer.current);
            if (logoClicked()) {
              // The clicks were for the Easter egg: stay on (or go back to) the page they started on.
              setDancing(true);
              setTimeout(() => setDancing(false), 3200);
              const from = burst.current.from;
              if (from && useStore.getState().route.page !== from.page) navigate(from);
              burst.current.last = 0;
              return;
            }
            // A single click goes Home, once the clicking stops.
            homeTimer.current = setTimeout(() => {
              if (useStore.getState().route.page !== "home") navigate({ page: "home" });
            }, 450);
          }}
        >
          <LogoMark size={collapsed ? 40 : 46} animate={dancing} />
          <Wordmark />
        </button>
        <button
          className="icon-btn tiny collapse-btn"
          title={collapsed ? "Expand sidebar ([)" : "Collapse sidebar ([)"}
          onClick={() => (isBoardWindow ? setWinCollapsed(!collapsed) : updateSettings({ sidebarCollapsed: !collapsed }))}
        >
          {collapsed ? <ChevronsRight size={15} /> : <ChevronsLeft size={15} />}
        </button>
      </div>
      <button className="nav-item quick-add-btn" onClick={() => setOverlay({ quickAddOpen: true })} title="Quick add (N)">
        <Zap size={16} />
        <span className="label">Quick add</span>
        <kbd className="label">N</kbd>
      </button>
      <NavItem icon={<Search size={16} />} label="Search" kbd="Ctrl K" onClick={() => setOverlay({ searchOpen: true })} />
      <NavItem icon={<Home size={16} />} label="Home" on={route.page === "home"} onClick={() => navigate({ page: "home" })} />
      <NavItem icon={<UserCheck size={16} />} label="My Tasks" on={route.page === "mytasks"} onClick={() => navigate({ page: "mytasks" })} />

      {starred.length > 0 && (
        <>
          <div className="nav-heading">
            <Star size={12} /> <span className="label">Starred</span>
          </div>
          <BoardList list={starred} all={live} activeId={activeId} collapsed={collapsed} renaming={renaming} setRenaming={setRenaming} />
        </>
      )}

      <div className="nav-heading">
        <span className="label">Boards</span>
        <button className="icon-btn tiny" title="New board" onClick={() => setAdding(true)}>
          <Plus size={14} />
        </button>
      </div>
      <div className="nav-boards">
        <BoardList list={loose} all={live} activeId={activeId} collapsed={collapsed} renaming={renaming} setRenaming={setRenaming} />
        {adding && (
          <input
            autoFocus
            className="nav-input"
            placeholder="Board name"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && title.trim()) {
                navigate({ page: "board", boardId: createBoard(title.trim()) });
                setTitle("");
                setAdding(false);
              }
              if (e.key === "Escape") {
                e.currentTarget.value = "";
                setTitle("");
                setAdding(false);
              }
            }}
            // Clicking away creates the board if a name was typed.
            onBlur={(e) => {
              if (e.currentTarget.value.trim() && title.trim()) navigate({ page: "board", boardId: createBoard(title.trim()) });
              setTitle("");
              setAdding(false);
            }}
          />
        )}
        {!collapsed &&
          categories.map((cat) => {
            const inCat = live.filter((b) => b.category === cat);
            const shut = collapsedCats.includes(cat);
            return (
              <div key={cat} className="nav-category">
                <button
                  className="nav-category-head"
                  onClick={() => useStore.getState().toggleCategoryCollapsed(cat)}
                  onContextMenu={(e) => openContextMenu(e, () => categoryMenu(cat))}
                  title="Click to fold; right-click to rename or remove"
                  aria-expanded={!shut}
                >
                  {shut ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
                  <span className="grow ellipsis">{cat}</span>
                  <span className="count">{inCat.length}</span>
                </button>
                {!shut && (
                  <BoardList list={inCat} all={live} activeId={activeId} collapsed={collapsed} renaming={renaming} setRenaming={setRenaming} />
                )}
              </div>
            );
          })}
      </div>

      {!isServer && !isRemote && <ServerNav collapsed={collapsed} />}

      <div className="grow" />
      {style === "partycat" && (
        <div className="spin-cat-spot">
          <SpinCat size={collapsed ? 44 : 64} />
        </div>
      )}
      <FocusWidget collapsed={collapsed} />
      <RunningTimer collapsed={collapsed} />
      <NavItem icon={<Archive size={16} />} label="Archive" on={route.page === "archive"} onClick={() => navigate({ page: "archive" })} />
      {isServer && me?.isAdmin && (
        <NavItem icon={<Shield size={16} />} label="Admin" on={route.page === "admin"} onClick={() => navigate({ page: "admin" })} />
      )}
      <NavItem icon={<Settings size={16} />} label="Settings" on={route.page === "settings"} onClick={() => navigate({ page: "settings" })} />
      <NavItem icon={<CircleHelp size={16} />} label="Help" kbd="?" onClick={() => setOverlay({ helpOpen: true })} />
      {isServer && me && <AccountButton collapsed={collapsed} />}
    </aside>
  );
}

/** Zomello Servers added in Settings: one click opens a server's window. */
function ServerNav({ collapsed }: { collapsed: boolean }) {
  const servers = useStore((s) => s.data.settings.servers ?? NO_SERVERS);
  if (!servers.length) return null;
  return (
    <>
      <div className="nav-heading">
        <span className="label">Servers</span>
        <button className="icon-btn tiny" title="Add or manage servers" onClick={() => useStore.getState().navigate({ page: "settings" })}>
          <Plus size={14} />
        </button>
      </div>
      {servers.map((s) => (
        <button
          key={s.id}
          className="nav-item"
          title={collapsed ? s.name : `Open ${s.url}`}
          onClick={() => void openServer(s)}
          onContextMenu={(e) =>
            openContextMenu(e, () => [
              { label: "Open", icon: <ExternalLink size={14} />, onClick: () => void openServer(s) },
              {
                label: "Remove from this list",
                icon: <X size={14} />,
                onClick: () =>
                  useStore.getState().updateSettings({ servers: (useStore.getState().data.settings.servers ?? []).filter((x) => x.id !== s.id) }),
              },
            ])
          }
        >
          <ServerIcon size={16} />
          <span className="ellipsis label">{s.name}</span>
        </button>
      ))}
    </>
  );
}

function RunningTimer({ collapsed }: { collapsed: boolean }) {
  const cards = useStore((s) => s.data.cards);
  const run = runningTimer(cards);
  const now = useNow(1000);
  if (!run) return null;
  const { card } = run;
  const total = card.time.reduce((s, t) => s + ((t.end ?? now) - t.start), 0);
  return (
    <div className="running-timer" title={`Timer running: ${card.title}`}>
      <span className="pulse" />
      {!collapsed && (
        <button className="grow ellipsis link-plain" onClick={() => useStore.getState().openCard(card.id)}>
          {card.title}
        </button>
      )}
      <span className="timer-text">{formatDuration(total, true)}</span>
      <button className="icon-btn tiny" title="Pause timer (time so far is kept)" onClick={() => useStore.getState().stopTimer()}>
        <Pause size={13} />
      </button>
    </div>
  );
}

/** Countdown timer: start one from here (or from a card), then pause / extend / cancel. */
function FocusWidget({ collapsed }: { collapsed: boolean }) {
  const focus = useStore((s) => s.focus);
  const defaultMin = useStore((s) => s.data.settings.focusMinutes);
  const now = useNow(1000);
  const { startFocus, pauseFocus, resumeFocus, extendFocus, endFocus, openCard } = useStore.getState();
  const [custom, setCustom] = useState("");
  const [label, setLabel] = useState("");

  if (!focus)
    return (
      <Popover
        trigger={(_, t) => (
          <button className="nav-item" onClick={t} title={collapsed ? "Focus timer" : undefined}>
            <Hourglass size={16} />
            <span className="label">Focus timer</span>
          </button>
        )}
      >
        {(close) => (
          <div className="menu focus-menu">
            <span className="menu-heading">Start a countdown</span>
            <input placeholder="What are you focusing on? (optional)" value={label} onChange={(e) => setLabel(e.target.value)} />
            <div className="focus-presets">
              {[5, 10, 15, 25, 30, 45, 60].map((m) => (
                <button
                  key={m}
                  className={`chip-btn ${m === defaultMin ? "default" : ""}`}
                  onClick={() => {
                    startFocus(m, null, label.trim() || "Focus");
                    setLabel("");
                    close();
                  }}
                >
                  {m}m
                </button>
              ))}
            </div>
            <form
              className="row gap-sm"
              onSubmit={(e) => {
                e.preventDefault();
                const m = parseDuration(custom);
                if (!m) return;
                startFocus(m, null, label.trim() || "Focus");
                setCustom("");
                setLabel("");
                close();
              }}
            >
              <input className="grow" placeholder="Custom: 20, 1h, 1:15…" value={custom} onChange={(e) => setCustom(e.target.value)} />
              <button className="btn sm primary" type="submit">
                Start
              </button>
            </form>
            <p className="muted small">Tip: start one from a card to also track the time on it.</p>
          </div>
        )}
      </Popover>
    );

  const left = focus.endsAt ? Math.max(0, focus.endsAt - now) : focus.remainingMs;
  const pct = 100 - (left / focus.durationMs) * 100;
  return (
    <div className={`focus-widget ${focus.endsAt ? "" : "paused"}`} title={focus.label}>
      <div className="focus-bar" style={{ width: `${pct}%` }} />
      <div className="focus-main">
        <Hourglass size={14} />
        {!collapsed && (
          <button className="grow ellipsis link-plain" onClick={() => focus.cardId && openCard(focus.cardId)} disabled={!focus.cardId}>
            {focus.label}
          </button>
        )}
        <span className="timer-text">{formatDuration(left, true).replace(/^0:/, "")}</span>
      </div>
      {!collapsed && (
        <div className="focus-actions">
          {focus.endsAt ? (
            <button className="btn sm ghost" onClick={pauseFocus}>
              <Pause size={12} /> Pause
            </button>
          ) : (
            <button className="btn sm ghost" onClick={resumeFocus}>
              <Play size={12} /> Resume
            </button>
          )}
          <button className="btn sm ghost" onClick={() => extendFocus(5)}>
            +5m
          </button>
          <button className="btn sm ghost" title="Cancel the countdown" onClick={() => endFocus(false)}>
            <X size={12} />
          </button>
        </div>
      )}
    </div>
  );
}

/** A board in the sidebar: drag to reorder, right-click for board actions, inline rename. */
function BoardLink({
  board,
  active,
  collapsed,
  renaming,
  onRename,
  onRenamed,
}: {
  board: Board;
  active: boolean;
  collapsed: boolean;
  renaming: boolean;
  onRename: () => void;
  onRenamed: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: board.id, disabled: renaming });
  const st = useStore.getState();
  const style = { transform: CSS.Translate.toString(transform), transition, opacity: isDragging ? 0.5 : 1 };
  const icon = board.icon ? <span className="nav-emoji">{board.icon}</span> : <span className="board-dot" style={{ background: board.color }} />;

  if (renaming)
    return (
      <div ref={setNodeRef} style={style} className="nav-item renaming">
        {icon}
        <input
          autoFocus
          className="nav-input"
          defaultValue={board.title}
          onFocus={(e) => e.target.select()}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") {
              e.currentTarget.value = board.title;
              e.currentTarget.blur();
            }
          }}
          onBlur={(e) => {
            const t = e.target.value.trim();
            if (t && t !== board.title) st.updateBoard(board.id, { title: t });
            onRenamed();
          }}
        />
      </div>
    );

  const menu = () => boardMenu(board, { onRename });

  return (
    <button
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={`nav-item ${active ? "active" : ""}`}
      onClick={() => st.navigate({ page: "board", boardId: board.id })}
      onDoubleClick={onRename}
      // Middle-click: open in its own window (and stop the browser's autoscroll).
      onMouseDown={(e) => e.button === 1 && e.preventDefault()}
      onAuxClick={(e) => {
        if (e.button !== 1) return;
        e.preventDefault();
        void openBoardWindow(board.id, board.title);
      }}
      onContextMenu={(e) => openContextMenu(e, menu)}
      title={collapsed ? board.title : "Drag to reorder · double-click to rename · middle-click for a new window · right-click for more"}
    >
      {icon}
      <span className="ellipsis label">{board.title}</span>
      {!collapsed && (board.members?.length ?? 0) > 1 && <SharedMark board={board} />}
    </button>
  );
}

/** Shared boards get a small people icon; hovering says whose board it is. */
function SharedMark({ board }: { board: Board }) {
  const owner = board.members?.find((m) => m.role === "owner");
  const mine = owner?.userId === me?.id;
  return (
    <span
      className="shared-icon"
      aria-label="Shared"
      title={mine ? `Shared with ${board.members!.length - 1} ${board.members!.length === 2 ? "person" : "people"}` : `${owner?.displayName ?? "Someone"}'s board`}
    >
      <Users size={12} />
    </span>
  );
}

/** A draggable list of boards. `list` may be a subset (Starred) of `all`; the full order is updated either way. */
function BoardList({
  list,
  all,
  activeId,
  collapsed,
  renaming,
  setRenaming,
}: {
  list: Board[];
  all: Board[];
  activeId: ID | null;
  collapsed: boolean;
  renaming: ID | null;
  setRenaming: (id: ID | null) => void;
}) {
  const sensors = useDragSensors(5);
  const onDragEnd = ({ active: a, over }: DragEndEvent) => {
    if (!over || a.id === over.id) return;
    const ids = list.map((b) => b.id);
    const moved = arrayMove(ids, ids.indexOf(String(a.id)), ids.indexOf(String(over.id)));
    // Put the reordered subset back into the slots it occupies in the full order.
    const order = all.map((b) => b.id);
    const slots = order.map((id, i) => (ids.includes(id) ? i : -1)).filter((i) => i >= 0);
    slots.forEach((slot, k) => (order[slot] = moved[k]));
    useStore.getState().reorderBoards(order);
  };
  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd} modifiers={[restrictToVerticalAxis]}>
      <SortableContext items={list.map((b) => b.id)} strategy={verticalListSortingStrategy}>
        {list.map((b) => (
          <BoardLink
            key={b.id}
            board={b}
            active={activeId === b.id}
            collapsed={collapsed}
            renaming={renaming === b.id}
            onRename={() => setRenaming(b.id)}
            onRenamed={() => setRenaming(null)}
          />
        ))}
      </SortableContext>
    </DndContext>
  );
}

/** Zomello Server: who's signed in, with account settings and sign-out. */
function AccountButton({ collapsed }: { collapsed: boolean }) {
  const name = useStore((s) => s.data.settings.me);
  return (
    <Popover
      trigger={(_, t) => (
        <button className="nav-item account-btn" onClick={t} title={collapsed ? name : "Your account"}>
          <Avatar name={name} size={20} />
          <span className="label ellipsis">{name}</span>
        </button>
      )}
    >
      {(close) => (
        <div className="menu">
          <span className="menu-heading">Signed in as @{me?.username}</span>
          <button
            className="menu-item"
            onClick={() => {
              close();
              useStore.getState().navigate({ page: "settings" });
              setTimeout(() => document.getElementById("set-account")?.scrollIntoView({ behavior: "smooth" }), 100);
            }}
          >
            <UserCog size={14} /> <span>Your account</span>
          </button>
          <button
            className="menu-item"
            onClick={async () => {
              close();
              await logout().catch(() => {});
              location.hash = "";
              location.reload();
            }}
          >
            <LogOut size={14} /> <span>Sign out</span>
          </button>
        </div>
      )}
    </Popover>
  );
}
