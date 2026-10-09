import { useMemo, useState } from "react";
import {
  Archive, ChevronsLeft, ChevronsRight, Home, Keyboard, Plus, Search, Settings, Square, Star, UserCheck, Zap,
} from "lucide-react";
import { runningTimer, useStore } from "../store";
import { byOrder, formatDuration } from "../utils";
import { LogoMark, Wordmark } from "./Logo";
import { useNow } from "./useNow";

export function Sidebar() {
  const boards = useStore((s) => s.data.boards);
  const route = useStore((s) => s.route);
  const collapsed = useStore((s) => s.data.settings.sidebarCollapsed);
  const { navigate, createBoard, setOverlay, updateSettings } = useStore.getState();
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");

  const live = useMemo(() => Object.values(boards).filter((b) => !b.archived).sort(byOrder), [boards]);
  const starred = live.filter((b) => b.starred);
  const active = (id: string) => route.page === "board" && route.boardId === id;

  const BoardLink = ({ id, title, color, icon }: { id: string; title: string; color: string; icon: string | null }) => (
    <button
      className={`nav-item ${active(id) ? "active" : ""}`}
      onClick={() => navigate({ page: "board", boardId: id })}
      title={collapsed ? title : undefined}
    >
      {icon ? <span className="nav-emoji">{icon}</span> : <span className="board-dot" style={{ background: color }} />}
      <span className="ellipsis label">{title}</span>
    </button>
  );

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
        <LogoMark size={30} />
        <Wordmark />
        <button
          className="icon-btn tiny collapse-btn"
          title={collapsed ? "Expand sidebar ([)" : "Collapse sidebar ([)"}
          onClick={() => updateSettings({ sidebarCollapsed: !collapsed })}
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
          {starred.map((b) => (
            <BoardLink key={b.id} id={b.id} title={b.title} color={b.color} icon={b.icon} />
          ))}
        </>
      )}

      <div className="nav-heading">
        <span className="label">Boards</span>
        <button className="icon-btn tiny" title="New board" onClick={() => setAdding(true)}>
          <Plus size={14} />
        </button>
      </div>
      <div className="nav-boards">
        {live.map((b) => (
          <BoardLink key={b.id} id={b.id} title={b.title} color={b.color} icon={b.icon} />
        ))}
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
              if (e.key === "Escape") setAdding(false);
            }}
            onBlur={() => setAdding(false)}
          />
        )}
      </div>

      <div className="grow" />
      <RunningTimer collapsed={collapsed} />
      <NavItem icon={<Archive size={16} />} label="Archive" on={route.page === "archive"} onClick={() => navigate({ page: "archive" })} />
      <NavItem icon={<Settings size={16} />} label="Settings" on={route.page === "settings"} onClick={() => navigate({ page: "settings" })} />
      <NavItem icon={<Keyboard size={16} />} label="Shortcuts" kbd="?" onClick={() => setOverlay({ helpOpen: true })} />
    </aside>
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
      <button className="icon-btn tiny" title="Stop timer" onClick={() => useStore.getState().stopTimer()}>
        <Square size={12} fill="currentColor" />
      </button>
    </div>
  );
}
