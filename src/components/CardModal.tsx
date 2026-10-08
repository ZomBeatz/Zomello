import { useMemo, useState } from "react";
import {
  AlignLeft,
  Archive,
  ArchiveRestore,
  CheckSquare,
  Copy,
  ExternalLink,
  Link2,
  MessageSquare,
  MoveRight,
  Plus,
  Tag,
  Trash2,
  X,
} from "lucide-react";
import type { Card, ID, Priority, Progress } from "../types";
import { useStore } from "../store";
import { byOrder, checklistStats, PRIORITIES, PROGRESS, timeAgo, uid } from "../utils";
import { openExternal } from "../storage";
import { ask, AutoTextarea, Avatar, ColorPicker, InlineEdit, Modal, Popover } from "./ui";

export function CardModal({ cardId }: { cardId: ID }) {
  const card = useStore((s) => s.data.cards[cardId]);
  const close = () => useStore.getState().openCard(null);
  if (!card) return null;
  return (
    <Modal onClose={close} width={920} className="card-modal">
      <CardDetail key={card.id} card={card} onClose={close} />
    </Modal>
  );
}

function CardDetail({ card, onClose }: { card: Card; onClose: () => void }) {
  const board = useStore((s) => s.data.boards[card.boardId]);
  const allLists = useStore((s) => s.data.lists);
  const allBoards = useStore((s) => s.data.boards);
  const people = useStore((s) => s.data.settings.people);
  const { updateCard, deleteCard, duplicateCard, moveCardToBoard, openCard, updateBoard } = useStore.getState();
  const lists = useMemo(
    () => Object.values(allLists).filter((l) => l.boardId === card.boardId && !l.archived).sort(byOrder),
    [allLists, card.boardId],
  );
  const set = (patch: Partial<Card>) => updateCard(card.id, patch);
  const [desc, setDesc] = useState(card.description);
  const [newItem, setNewItem] = useState("");
  const [comment, setComment] = useState("");
  const [link, setLink] = useState({ name: "", url: "" });
  const cl = checklistStats(card);

  const toggleIn = <T,>(arr: T[], v: T) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);

  return (
    <div className="card-detail">
      {card.cover && <div className="detail-cover" style={{ background: card.cover }} />}
      <button className="icon-btn close" onClick={onClose} title="Close (Esc)">
        <X size={18} />
      </button>
      {card.archived && (
        <div className="archived-banner">
          <Archive size={14} /> This card is archived.
          <button className="btn sm" onClick={() => set({ archived: false })}>
            <ArchiveRestore size={14} /> Restore
          </button>
        </div>
      )}
      <header className="detail-head">
        <InlineEdit className="detail-title" value={card.title} onSave={(title) => set({ title })} multiline />
        <span className="muted small">
          in <b>{board.title}</b> · created {timeAgo(card.createdAt)} · updated {timeAgo(card.updatedAt)}
        </span>
      </header>

      <div className="detail-grid">
        <div className="detail-main">
          {/* Labels */}
          <section>
            <h4>
              <Tag size={15} /> Labels
            </h4>
            <div className="row wrap gap-sm">
              {board.labels.map((l) => {
                const on = card.labelIds.includes(l.id);
                return (
                  <button
                    key={l.id}
                    className={`label-toggle ${on ? "on" : ""}`}
                    style={{ "--c": l.color } as React.CSSProperties}
                    onClick={() => set({ labelIds: toggleIn(card.labelIds, l.id) })}
                  >
                    {l.name || "Unnamed"}
                  </button>
                );
              })}
              <button
                className="label-toggle add"
                onClick={() => {
                  const id = uid();
                  updateBoard(board.id, { labels: [...board.labels, { id, name: "New label", color: "#64748b" }] });
                  set({ labelIds: [...card.labelIds, id] });
                }}
              >
                <Plus size={13} /> Label
              </button>
            </div>
          </section>

          {/* Description */}
          <section>
            <h4>
              <AlignLeft size={15} /> Description
            </h4>
            <AutoTextarea
              className="desc"
              placeholder="Add a more detailed description…"
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              onBlur={() => desc !== card.description && set({ description: desc })}
            />
          </section>

          {/* Checklist */}
          <section>
            <h4>
              <CheckSquare size={15} /> Checklist
              {cl.total > 0 && (
                <span className="muted small">
                  {cl.done}/{cl.total}
                </span>
              )}
            </h4>
            {cl.total > 0 && (
              <div className="progress-bar">
                <span style={{ width: `${(cl.done / cl.total) * 100}%` }} />
              </div>
            )}
            <ul className="checklist">
              {card.checklist.map((item) => (
                <li key={item.id} className={item.done ? "done" : ""}>
                  <input
                    type="checkbox"
                    checked={item.done}
                    onChange={() =>
                      set({ checklist: card.checklist.map((i) => (i.id === item.id ? { ...i, done: !i.done } : i)) })
                    }
                  />
                  <InlineEdit
                    value={item.text}
                    onSave={(text) => set({ checklist: card.checklist.map((i) => (i.id === item.id ? { ...i, text } : i)) })}
                  />
                  <button
                    className="icon-btn tiny"
                    title="Convert to card"
                    onClick={() => {
                      useStore.getState().createCard(card.listId, item.text);
                      set({ checklist: card.checklist.filter((i) => i.id !== item.id) });
                    }}
                  >
                    <MoveRight size={13} />
                  </button>
                  <button
                    className="icon-btn tiny"
                    title="Delete item"
                    onClick={() => set({ checklist: card.checklist.filter((i) => i.id !== item.id) })}
                  >
                    <X size={13} />
                  </button>
                </li>
              ))}
            </ul>
            <input
              className="add-input"
              placeholder="Add an item… (Enter)"
              value={newItem}
              onChange={(e) => setNewItem(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && newItem.trim()) {
                  set({ checklist: [...card.checklist, { id: uid(), text: newItem.trim(), done: false }] });
                  setNewItem("");
                }
              }}
            />
          </section>

          {/* Links / attachments */}
          <section>
            <h4>
              <Link2 size={15} /> Links & files
            </h4>
            <ul className="attachments">
              {card.attachments.map((a) => (
                <li key={a.id}>
                  <button className="link" onClick={() => openExternal(a.url)} title={a.url}>
                    <ExternalLink size={13} /> {a.name}
                  </button>
                  <span className="muted small ellipsis">{a.url}</span>
                  <button
                    className="icon-btn tiny"
                    onClick={() => set({ attachments: card.attachments.filter((x) => x.id !== a.id) })}
                  >
                    <X size={13} />
                  </button>
                </li>
              ))}
            </ul>
            <form
              className="row gap-sm"
              onSubmit={(e) => {
                e.preventDefault();
                const url = link.url.trim();
                if (!url) return;
                const name = link.name.trim() || url.split(/[\\/]/).filter(Boolean).pop() || url;
                set({ attachments: [...card.attachments, { id: uid(), name, url, addedAt: Date.now() }] });
                setLink({ name: "", url: "" });
              }}
            >
              <input
                className="add-input grow"
                placeholder="https://… or /path/to/file"
                value={link.url}
                onChange={(e) => setLink({ ...link, url: e.target.value })}
              />
              <input
                className="add-input"
                style={{ width: 150 }}
                placeholder="Name (optional)"
                value={link.name}
                onChange={(e) => setLink({ ...link, name: e.target.value })}
              />
              <button className="btn sm" type="submit">
                Add
              </button>
            </form>
          </section>

          {/* Notes / comments */}
          <section>
            <h4>
              <MessageSquare size={15} /> Notes
            </h4>
            <AutoTextarea
              className="desc"
              placeholder="Write a note… (Ctrl+Enter to save)"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && comment.trim()) {
                  set({ comments: [{ id: uid(), text: comment.trim(), createdAt: Date.now() }, ...card.comments] });
                  setComment("");
                }
              }}
            />
            {comment.trim() && (
              <button
                className="btn primary sm"
                onClick={() => {
                  set({ comments: [{ id: uid(), text: comment.trim(), createdAt: Date.now() }, ...card.comments] });
                  setComment("");
                }}
              >
                Save note
              </button>
            )}
            <ul className="comments">
              {card.comments.map((c) => (
                <li key={c.id}>
                  <div className="row between">
                    <span className="muted small">{timeAgo(c.createdAt)}</span>
                    <button
                      className="icon-btn tiny"
                      onClick={() => set({ comments: card.comments.filter((x) => x.id !== c.id) })}
                    >
                      <X size={13} />
                    </button>
                  </div>
                  <p>{c.text}</p>
                </li>
              ))}
            </ul>
          </section>
        </div>

        <aside className="detail-side">
          <Field label="Bucket">
            <select value={card.listId} onChange={(e) => set({ listId: e.target.value })}>
              {lists.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.title}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Progress">
            <select value={card.progress} onChange={(e) => set({ progress: e.target.value as Progress })}>
              {PROGRESS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Priority">
            <select value={card.priority} onChange={(e) => set({ priority: e.target.value as Priority })}>
              {PRIORITIES.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Start date">
            <DateInput value={card.startDate} onChange={(startDate) => set({ startDate })} />
          </Field>
          <Field label="Due date">
            <DateInput value={card.dueDate} onChange={(dueDate) => set({ dueDate })} />
          </Field>
          <Field label="Assigned to">
            <div className="row wrap gap-sm">
              {card.assignees.map((a) => (
                <span key={a} className="chip">
                  <Avatar name={a} size={18} /> {a}
                  <button className="icon-btn tiny" onClick={() => set({ assignees: card.assignees.filter((x) => x !== a) })}>
                    <X size={12} />
                  </button>
                </span>
              ))}
              <Popover
                trigger={(_, toggle) => (
                  <button className="chip add" onClick={toggle}>
                    <Plus size={13} /> Assign
                  </button>
                )}
              >
                {(closePop) => (
                  <div className="menu">
                    {people.length === 0 && <p className="muted small pad">Add people in Settings.</p>}
                    {people.map((p) => (
                      <label key={p} className="menu-item">
                        <input
                          type="checkbox"
                          checked={card.assignees.includes(p)}
                          onChange={() => set({ assignees: toggleIn(card.assignees, p) })}
                        />
                        <Avatar name={p} size={18} />
                        <span>{p}</span>
                      </label>
                    ))}
                    <button className="menu-item muted" onClick={closePop}>
                      Done
                    </button>
                  </div>
                )}
              </Popover>
            </div>
          </Field>
          <Field label="Cover color">
            <ColorPicker value={card.cover} onChange={(cover) => set({ cover })} allowNone />
          </Field>
          <Field label="Move to board">
            <select
              value={card.boardId}
              onChange={(e) => {
                const target = e.target.value;
                const firstList = Object.values(allLists)
                  .filter((l) => l.boardId === target && !l.archived)
                  .sort(byOrder)[0];
                if (firstList) moveCardToBoard(card.id, target, firstList.id);
              }}
            >
              {Object.values(allBoards)
                .filter((b) => !b.archived)
                .sort(byOrder)
                .map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.title}
                  </option>
                ))}
            </select>
          </Field>

          <div className="side-actions">
            <button className="btn" onClick={() => openCard(duplicateCard(card.id))}>
              <Copy size={14} /> Duplicate
            </button>
            {card.archived ? (
              <button className="btn" onClick={() => set({ archived: false })}>
                <ArchiveRestore size={14} /> Restore
              </button>
            ) : (
              <button
                className="btn"
                onClick={() => {
                  set({ archived: true });
                  onClose();
                }}
              >
                <Archive size={14} /> Archive
              </button>
            )}
            <button
              className="btn danger"
              onClick={async () => {
                if (await ask(`Delete "${card.title}" permanently?`, { okText: "Delete", danger: true })) deleteCard(card.id);
              }}
            >
              <Trash2 size={14} /> Delete
            </button>
          </div>
        </aside>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="field">
      <label>{label}</label>
      {children}
    </div>
  );
}

function DateInput({ value, onChange }: { value: string | null; onChange: (v: string | null) => void }) {
  return (
    <div className="row gap-sm">
      <input type="date" value={value ?? ""} onChange={(e) => onChange(e.target.value || null)} />
      {value && (
        <button className="icon-btn tiny" title="Clear" onClick={() => onChange(null)}>
          <X size={13} />
        </button>
      )}
    </div>
  );
}
