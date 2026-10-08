import { useState } from "react";
import { ArchiveRestore, Trash2 } from "lucide-react";
import { useStore } from "../store";
import { timeAgo } from "../utils";
import { ask, Empty } from "./ui";

type Tab = "cards" | "lists" | "boards";

export function ArchivePage() {
  const data = useStore((s) => s.data);
  const { updateBoard, deleteBoard, updateList, deleteList, updateCard, deleteCard, openCard } = useStore.getState();
  const [tab, setTab] = useState<Tab>("cards");

  const boards = Object.values(data.boards).filter((b) => b.archived);
  const lists = Object.values(data.lists).filter((l) => l.archived && data.boards[l.boardId]);
  const cards = Object.values(data.cards)
    .filter((c) => c.archived && data.boards[c.boardId])
    .sort((a, b) => b.updatedAt - a.updatedAt);

  const confirmDelete = (what: string) => ask(`Permanently delete ${what}? This can't be undone.`, { okText: "Delete", danger: true });

  return (
    <div className="page">
      <h1>Archive</h1>
      <div className="seg">
        {(
          [
            ["cards", `Cards (${cards.length})`],
            ["lists", `Buckets (${lists.length})`],
            ["boards", `Boards (${boards.length})`],
          ] as [Tab, string][]
        ).map(([id, name]) => (
          <button key={id} className={tab === id ? "active" : ""} onClick={() => setTab(id)}>
            {name}
          </button>
        ))}
      </div>

      <ul className="archive-list">
        {tab === "cards" &&
          cards.map((c) => (
            <li key={c.id}>
              <button className="link grow ellipsis" onClick={() => openCard(c.id)}>
                {c.title}
              </button>
              <span className="muted small">
                {data.boards[c.boardId].title} › {data.lists[c.listId]?.title} · {timeAgo(c.updatedAt)}
              </span>
              <button className="btn sm" onClick={() => updateCard(c.id, { archived: false })}>
                <ArchiveRestore size={14} /> Restore
              </button>
              <button className="icon-btn danger" onClick={async () => (await confirmDelete(`"${c.title}"`)) && deleteCard(c.id)}>
                <Trash2 size={15} />
              </button>
            </li>
          ))}
        {tab === "lists" &&
          lists.map((l) => (
            <li key={l.id}>
              <span className="grow ellipsis">{l.title}</span>
              <span className="muted small">
                {data.boards[l.boardId].title} · {Object.values(data.cards).filter((c) => c.listId === l.id).length} cards
              </span>
              <button className="btn sm" onClick={() => updateList(l.id, { archived: false })}>
                <ArchiveRestore size={14} /> Restore
              </button>
              <button
                className="icon-btn danger"
                onClick={async () => (await confirmDelete(`bucket "${l.title}" and its cards`)) && deleteList(l.id)}
              >
                <Trash2 size={15} />
              </button>
            </li>
          ))}
        {tab === "boards" &&
          boards.map((b) => (
            <li key={b.id}>
              <span className="board-dot" style={{ background: b.color }} />
              <span className="grow ellipsis">{b.title}</span>
              <button className="btn sm" onClick={() => updateBoard(b.id, { archived: false })}>
                <ArchiveRestore size={14} /> Restore
              </button>
              <button
                className="icon-btn danger"
                onClick={async () => (await confirmDelete(`board "${b.title}" and everything in it`)) && deleteBoard(b.id)}
              >
                <Trash2 size={15} />
              </button>
            </li>
          ))}
      </ul>
      {((tab === "cards" && !cards.length) || (tab === "lists" && !lists.length) || (tab === "boards" && !boards.length)) && (
        <Empty title="Nothing archived">Archived items show up here and can be restored any time.</Empty>
      )}
    </div>
  );
}
