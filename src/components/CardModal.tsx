import { useMemo, useState } from "react";
import {
  AlignLeft,
  Archive,
  Ban,
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
  Unlink,
  X,
} from "lucide-react";
import type { Card, ID, LinkType, Priority, Progress, Recurrence, RecurrenceFreq } from "../types";
import { useStore } from "../store";
import { byOrder, checklistStats, describeRecurrence, LINK_TYPES, PRIORITIES, PROGRESS, timeAgo, todayISO, uid, WEEKDAYS } from "../utils";
import { openExternal } from "../storage";
import { ask, AutoTextarea, Avatar, ColorPicker, InlineEdit, Modal, Popover, ProgressIcon } from "./ui";
import { BucketPicker, CardPicker, LabelPicker } from "./pickers";

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
  const allCards = useStore((s) => s.data.cards);
  const {
    updateCard, deleteCard, duplicateCard, moveCardToBoard, openCard,
    linkCards, unlinkCards, linkChecklistItem, spinOffChecklistItem, toggleChecklistItem,
  } = useStore.getState();
  const [newLinkType, setNewLinkType] = useState<LinkType>("relates");
  /** Cards that have this card as a linked checklist item. */
  const parents = useMemo(
    () => Object.values(allCards).filter((c) => c.checklist.some((i) => i.cardId === card.id)),
    [allCards, card.id],
  );
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
          {card.links.some((l) => l.type === "blockedBy" && allCards[l.cardId]?.progress !== "completed") && (
            <div className="blocked-banner">
              <Ban size={14} /> Blocked — waiting on linked tasks to be completed.
            </div>
          )}

          {/* Labels */}
          <section>
            <h4>
              <Tag size={15} /> Labels
            </h4>
            <div className="row wrap gap-sm">
              {board.labels
                .filter((l) => card.labelIds.includes(l.id))
                .map((l) => (
                  <span key={l.id} className="label-pill lg" style={{ background: l.color }}>
                    {l.name || "Unnamed"}
                    <button title="Remove label" onClick={() => set({ labelIds: card.labelIds.filter((x) => x !== l.id) })}>
                      <X size={11} />
                    </button>
                  </span>
                ))}
              <Popover
                trigger={(_, toggle) => (
                  <button className="label-toggle add" onClick={toggle}>
                    <Plus size={13} /> {card.labelIds.length ? "" : "Add label"}
                  </button>
                )}
              >
                {() => (
                  <LabelPicker
                    board={board}
                    selected={card.labelIds}
                    onToggle={(id, on) => {
                      const cur = useStore.getState().data.cards[card.id].labelIds;
                      set({ labelIds: on ? [...new Set([...cur, id])] : cur.filter((x) => x !== id) });
                    }}
                  />
                )}
              </Popover>
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
              {card.checklist.map((item) => {
                const linked = item.cardId ? allCards[item.cardId] : null;
                const checked = linked ? linked.progress === "completed" : item.done;
                return (
                  <li key={item.id} className={checked ? "done" : ""}>
                    <input type="checkbox" checked={checked} onChange={() => toggleChecklistItem(card.id, item.id)} />
                    {linked ? (
                      <button className="linked-item grow" onClick={() => openCard(linked.id)} title="Open linked task">
                        <Link2 size={13} />
                        <span className="ellipsis">{linked.title}</span>
                        <span className="muted small ellipsis">
                          {allBoards[linked.boardId]?.title} › {allLists[linked.listId]?.title}
                        </span>
                      </button>
                    ) : (
                      <InlineEdit
                        value={item.text}
                        onSave={(text) => set({ checklist: card.checklist.map((i) => (i.id === item.id ? { ...i, text } : i)) })}
                      />
                    )}
                    {linked ? (
                      <button
                        className="icon-btn tiny"
                        title="Unlink (keeps the task)"
                        onClick={() => linkChecklistItem(card.id, item.id, null)}
                      >
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
                                defaultBoardId={card.boardId}
                                action="Create task"
                                onPick={(listId) => {
                                  spinOffChecklistItem(card.id, item.id, listId);
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
                      onClick={() => set({ checklist: card.checklist.filter((i) => i.id !== item.id) })}
                    >
                      <X size={13} />
                    </button>
                  </li>
                );
              })}
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

          {/* Linked tasks */}
          <section>
            <h4>
              <Link2 size={15} /> Linked tasks
            </h4>
            <ul className="linked-list">
              {card.links.map((l) => {
                const c = allCards[l.cardId];
                if (!c) return null;
                return (
                  <li key={l.cardId}>
                    <select
                      className="link-type"
                      value={l.type}
                      onChange={(e) => linkCards(card.id, c.id, e.target.value as LinkType)}
                    >
                      {LINK_TYPES.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                    </select>
                    <ProgressIcon progress={c.progress} size={14} />
                    <button className="linked-item grow" onClick={() => openCard(c.id)}>
                      <span className="ellipsis">{c.title}</span>
                      <span className="muted small ellipsis">
                        <span className="board-dot inline" style={{ background: allBoards[c.boardId]?.color }} />
                        {allBoards[c.boardId]?.title} › {allLists[c.listId]?.title}
                      </span>
                    </button>
                    <button className="icon-btn tiny" title="Remove link" onClick={() => unlinkCards(card.id, c.id)}>
                      <X size={13} />
                    </button>
                  </li>
                );
              })}
              {parents.map((p) => (
                <li key={`parent-${p.id}`}>
                  <span className="link-type static">Checklist item in</span>
                  <ProgressIcon progress={p.progress} size={14} />
                  <button className="linked-item grow" onClick={() => openCard(p.id)}>
                    <span className="ellipsis">{p.title}</span>
                    <span className="muted small ellipsis">
                      {allBoards[p.boardId]?.title} › {allLists[p.listId]?.title}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            <Popover
              trigger={(_, t) => (
                <button className="btn sm ghost" onClick={t}>
                  <Plus size={14} /> Link a task
                </button>
              )}
            >
              {(close) => (
                <div>
                  <div className="seg link-type-seg">
                    {LINK_TYPES.map((t) => (
                      <button key={t.id} className={newLinkType === t.id ? "active" : ""} onClick={() => setNewLinkType(t.id)}>
                        {t.name}
                      </button>
                    ))}
                  </div>
                  <CardPicker
                    exclude={[card.id, ...card.links.map((l) => l.cardId)]}
                    onPick={(id) => {
                      linkCards(card.id, id, newLinkType);
                      close();
                    }}
                  />
                </div>
              )}
            </Popover>
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
          <Field label="Repeat">
            <RecurrenceEditor card={card} onChange={(recurrence) => set({ recurrence, ...(recurrence && !card.dueDate ? { dueDate: todayISO() } : {}) })} />
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

const FREQS: { id: RecurrenceFreq; unit: string }[] = [
  { id: "daily", unit: "day" },
  { id: "weekly", unit: "week" },
  { id: "monthly", unit: "month" },
  { id: "yearly", unit: "year" },
];

function RecurrenceEditor({ card, onChange }: { card: Card; onChange: (r: Recurrence | null) => void }) {
  const r = card.recurrence;
  const update = (patch: Partial<Recurrence>) => r && onChange({ ...r, ...patch });
  return (
    <div className="recurrence">
      <select
        value={r?.freq ?? ""}
        onChange={(e) =>
          onChange(e.target.value ? { freq: e.target.value as RecurrenceFreq, interval: r?.interval ?? 1, weekdays: [], until: r?.until ?? null } : null)
        }
      >
        <option value="">Does not repeat</option>
        <option value="daily">Daily</option>
        <option value="weekly">Weekly</option>
        <option value="monthly">Monthly</option>
        <option value="yearly">Yearly</option>
      </select>
      {r && (
        <>
          <div className="row gap-sm">
            <span className="small muted">Every</span>
            <input
              type="number"
              min={1}
              className="interval"
              value={r.interval}
              onChange={(e) => update({ interval: Math.max(1, parseInt(e.target.value, 10) || 1) })}
            />
            <span className="small muted">
              {FREQS.find((f) => f.id === r.freq)!.unit}
              {r.interval > 1 ? "s" : ""}
            </span>
          </div>
          {r.freq === "weekly" && (
            <div className="weekdays">
              {WEEKDAYS.map((d, i) => (
                <button
                  key={d}
                  className={r.weekdays.includes(i) ? "on" : ""}
                  onClick={() => update({ weekdays: r.weekdays.includes(i) ? r.weekdays.filter((x) => x !== i) : [...r.weekdays, i] })}
                >
                  {d[0]}
                </button>
              ))}
            </div>
          )}
          <div className="row gap-sm">
            <span className="small muted">Until</span>
            <input type="date" value={r.until ?? ""} onChange={(e) => update({ until: e.target.value || null })} />
          </div>
          <span className="small muted">{describeRecurrence(r)}. Completing it creates the next one.</span>
        </>
      )}
    </div>
  );
}
