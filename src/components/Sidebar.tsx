import { useMemo, useState } from "react";
import { Archive, Home, LayoutDashboard, Plus, Search, Settings, Star } from "lucide-react";
import { useStore } from "../store";
import { byOrder } from "../utils";

export function Sidebar() {
  const boards = useStore((s) => s.data.boards);
  const route = useStore((s) => s.route);
  const { navigate, createBoard, setSearchOpen } = useStore.getState();
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");

  const live = useMemo(() => Object.values(boards).filter((b) => !b.archived).sort(byOrder), [boards]);
  const starred = live.filter((b) => b.starred);
  const active = (id: string) => route.page === "board" && route.boardId === id;

  const BoardLink = ({ id, title, color }: { id: string; title: string; color: string }) => (
    <button className={`nav-item ${active(id) ? "active" : ""}`} onClick={() => navigate({ page: "board", boardId: id })}>
      <span className="board-dot" style={{ background: color }} />
      <span className="ellipsis">{title}</span>
    </button>
  );

  return (
    <aside className="sidebar">
      <div className="brand">
        <LayoutDashboard size={20} />
        <span>Planwise</span>
      </div>
      <button className="nav-item search-trigger" onClick={() => setSearchOpen(true)}>
        <Search size={16} />
        <span>Search</span>
        <kbd>Ctrl K</kbd>
      </button>
      <button className={`nav-item ${route.page === "home" ? "active" : ""}`} onClick={() => navigate({ page: "home" })}>
        <Home size={16} />
        <span>Home</span>
      </button>

      {starred.length > 0 && (
        <>
          <div className="nav-heading">
            <Star size={12} /> Starred
          </div>
          {starred.map((b) => (
            <BoardLink key={b.id} id={b.id} title={b.title} color={b.color} />
          ))}
        </>
      )}

      <div className="nav-heading">
        Boards
        <button className="icon-btn tiny" title="New board" onClick={() => setAdding(true)}>
          <Plus size={14} />
        </button>
      </div>
      <div className="nav-boards">
        {live.map((b) => (
          <BoardLink key={b.id} id={b.id} title={b.title} color={b.color} />
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
      <button className={`nav-item ${route.page === "archive" ? "active" : ""}`} onClick={() => navigate({ page: "archive" })}>
        <Archive size={16} />
        <span>Archive</span>
      </button>
      <button className={`nav-item ${route.page === "settings" ? "active" : ""}`} onClick={() => navigate({ page: "settings" })}>
        <Settings size={16} />
        <span>Settings</span>
      </button>
    </aside>
  );
}
