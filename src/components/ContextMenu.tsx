import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { archiveCard, deleteCard } from "../actions";
import { createPortal } from "react-dom";
import { addDays, addHours, format, nextMonday, setHours, setMinutes } from "date-fns";
import {
  Archive,
  ArrowRightLeft,
  Bell,
  BookmarkPlus,
  Bot,
  Hourglass,
  Pause,
  Play,
  Calendar,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleDashed,
  Copy,
  ExternalLink,
  Flag,
  GitFork,
  Kanban,
  Link2,
  Repeat,
  Tag,
  Trash2,
  UserPlus,
} from "lucide-react";
import type { ID } from "../types";
import { useStore } from "../store";
import { byOrder, describeRecurrence, PRIORITIES, PROGRESS, RECURRENCE_PRESETS, relatedSet, toISO } from "../utils";
import { Avatar } from "./ui";
import { CardPicker, LabelPicker } from "./pickers";

export interface MenuEntry {
  label?: ReactNode;
  icon?: ReactNode;
  onClick?: () => void;
  checked?: boolean;
  danger?: boolean;
  separator?: boolean;
  /** Nested items, or arbitrary content (e.g. a picker) shown in a flyout. */
  submenu?: MenuEntry[] | ((close: () => void) => ReactNode);
  /** Keep the menu open after clicking (for toggles). */
  keepOpen?: boolean;
}

// ---- Host: one context menu at a time, opened from anywhere ----
let show: ((m: { x: number; y: number; build: () => MenuEntry[] } | null) => void) | null = null;

export function openContextMenu(e: React.MouseEvent, build: () => MenuEntry[]) {
  e.preventDefault();
  e.stopPropagation();
  show?.({ x: e.clientX, y: e.clientY, build });
}

export function openCardMenu(e: React.MouseEvent, cardId: ID) {
  openContextMenu(e, () => cardMenu(cardId));
}

export function ContextMenuHost() {
  const [menu, setMenu] = useState<{ x: number; y: number; build: () => MenuEntry[] } | null>(null);
  // Re-render on store changes so checkmarks stay current while the menu is open.
  useStore((s) => s.data);
  useEffect(() => {
    show = setMenu;
    return () => {
      show = null;
    };
  }, []);
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onDown = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest(".ctx-menu")) close();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    document.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    window.addEventListener("blur", close);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("blur", close);
      window.removeEventListener("resize", close);
    };
  }, [menu]);
  if (!menu) return null;
  const items = menu.build();
  if (!items.length) return null;
  return createPortal(<MenuPanel items={items} x={menu.x} y={menu.y} onClose={() => setMenu(null)} />, document.body);
}

function MenuPanel({
  items,
  x,
  y,
  onClose,
  flipFrom,
}: {
  items: MenuEntry[] | ((close: () => void) => ReactNode);
  x: number;
  y: number;
  onClose: () => void;
  /** Parent panel's left edge — a submenu flips to the left of it if needed. */
  flipFrom?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y, ready: false });
  const [openSub, setOpenSub] = useState<number | null>(null);
  const [subPos, setSubPos] = useState({ x: 0, y: 0, parentLeft: 0 });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { offsetWidth: w, offsetHeight: h } = el;
    let left = x;
    if (left + w > window.innerWidth - 8) left = flipFrom !== undefined ? flipFrom - w + 4 : window.innerWidth - w - 8;
    const top = Math.max(8, Math.min(y, window.innerHeight - h - 8));
    setPos({ left: Math.max(8, left), top, ready: true });
  }, [x, y, flipFrom]);

  return (
    <div
      ref={ref}
      className="ctx-menu"
      style={{ left: pos.left, top: pos.top, visibility: pos.ready ? "visible" : "hidden" }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {typeof items === "function"
        ? items(onClose)
        : items.map((it, i) =>
            it.separator ? (
              <div key={i} className="ctx-sep" />
            ) : (
              <button
                key={i}
                className={`ctx-item ${it.danger ? "danger" : ""} ${openSub === i ? "open" : ""}`}
                onMouseEnter={(e) => {
                  if (it.submenu) {
                    const r = e.currentTarget.getBoundingClientRect();
                    setSubPos({ x: r.right - 2, y: r.top - 5, parentLeft: pos.left });
                    setOpenSub(i);
                  } else setOpenSub(null);
                }}
                onClick={() => {
                  if (it.submenu) return;
                  it.onClick?.();
                  if (!it.keepOpen) onClose();
                }}
              >
                <span className="ctx-icon">{it.checked !== undefined ? it.checked && <Check size={14} /> : it.icon}</span>
                <span className="grow">{it.label}</span>
                {it.submenu && <ChevronRight size={14} className="muted" />}
              </button>
            ),
          )}
      {openSub !== null && typeof items !== "function" && items[openSub]?.submenu && (
        <MenuPanel
          key={openSub}
          items={items[openSub].submenu!}
          x={subPos.x}
          y={subPos.y}
          flipFrom={subPos.parentLeft}
          onClose={onClose}
        />
      )}
    </div>
  );
}

// ---- The card menu ----
function cardMenu(cardId: ID): MenuEntry[] {
  const st = useStore.getState();
  const { data } = st;
  const card = data.cards[cardId];
  if (!card) return [];
  const set = (patch: Parameters<typeof st.updateCard>[1]) => useStore.getState().updateCard(cardId, patch);
  const done = card.progress === "completed";
  const lists = Object.values(data.lists)
    .filter((l) => l.boardId === card.boardId && !l.archived)
    .sort(byOrder);
  const boards = Object.values(data.boards)
    .filter((b) => !b.archived && b.id !== card.boardId)
    .sort(byOrder);
  const today = new Date();
  const running = card.time.some((t) => t.end === null);
  const hasRelations = relatedSet(cardId, data.cards, false).size > 1;
  const at = (d: Date) => format(d, "yyyy-MM-dd'T'HH:mm");
  const tomorrow9 = setMinutes(setHours(addDays(today, 1), 9), 0);

  return [
    { label: "Open", icon: <ExternalLink size={14} />, onClick: () => st.openCard(cardId) },
    {
      label: done ? "Mark incomplete" : "Mark complete",
      icon: done ? <CircleDashed size={14} /> : <CheckCircle2 size={14} />,
      onClick: () => set({ progress: done ? "notStarted" : "completed" }),
    },
    { separator: true },
    {
      label: "Progress",
      icon: <CircleDashed size={14} />,
      submenu: PROGRESS.map((p) => ({ label: p.name, checked: card.progress === p.id, onClick: () => set({ progress: p.id }) })),
    },
    {
      label: "Priority",
      icon: <Flag size={14} />,
      submenu: PRIORITIES.map((p) => ({
        label: (
          <span className="row gap-sm">
            <span className="dot" style={{ background: p.color }} />
            {p.name}
          </span>
        ),
        checked: card.priority === p.id,
        onClick: () => set({ priority: p.id }),
      })),
    },
    {
      label: "Labels",
      icon: <Tag size={14} />,
      submenu: () => <LiveLabelPicker cardId={cardId} />,
    },
    {
      label: "Assign",
      icon: <UserPlus size={14} />,
      submenu: data.settings.people.length
        ? data.settings.people.map((p) => ({
            label: (
              <span className="row gap-sm">
                <Avatar name={p} size={18} />
                {p}
              </span>
            ),
            checked: card.assignees.includes(p),
            keepOpen: true,
            onClick: () => {
              const cur = useStore.getState().data.cards[cardId].assignees;
              set({ assignees: cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p] });
            },
          }))
        : [{ label: <span className="muted">Add people in Settings</span> }],
    },
    {
      label: "Due date",
      icon: <Calendar size={14} />,
      submenu: [
        { label: "Today", onClick: () => set({ dueDate: toISO(today) }) },
        { label: "Tomorrow", onClick: () => set({ dueDate: toISO(addDays(today, 1)) }) },
        { label: "Next week (Mon)", onClick: () => set({ dueDate: toISO(nextMonday(today)) }) },
        { label: "In 2 weeks", onClick: () => set({ dueDate: toISO(addDays(today, 14)) }) },
        ...(card.dueDate ? [{ separator: true }, { label: "Remove due date", onClick: () => set({ dueDate: null }) }] : []),
      ],
    },
    {
      label: "Repeat",
      icon: <Repeat size={14} />,
      submenu: [
        ...RECURRENCE_PRESETS.map((p) => ({
          label: p.name,
          checked: p.rule ? !!card.recurrence && describeRecurrence(card.recurrence) === describeRecurrence(p.rule) : !card.recurrence,
          onClick: () => set({ recurrence: p.rule, ...(p.rule && !card.dueDate ? { dueDate: toISO(today) } : {}) }),
        })),
        { separator: true },
        { label: "Custom…", onClick: () => st.openCard(cardId) },
      ],
    },
    {
      label: "Remind me",
      icon: <Bell size={14} />,
      submenu: [
        { label: "In 1 hour", onClick: () => set({ reminder: at(addHours(today, 1)) }) },
        { label: "In 3 hours", onClick: () => set({ reminder: at(addHours(today, 3)) }) },
        { label: "Tomorrow 9:00", onClick: () => set({ reminder: at(tomorrow9) }) },
        { label: "Next Monday 9:00", onClick: () => set({ reminder: at(setMinutes(setHours(nextMonday(today), 9), 0)) }) },
        ...(card.reminder ? [{ separator: true }, { label: "Remove reminder", onClick: () => set({ reminder: null }) }] : []),
      ],
    },
    {
      label: running ? "Pause timer" : "Start timer",
      icon: running ? <Pause size={14} /> : <Play size={14} />,
      onClick: () => (running ? st.stopTimer() : st.startTimer(cardId)),
    },
    {
      label: "Focus countdown",
      icon: <Hourglass size={14} />,
      submenu: [10, 15, 25, 30, 45, 60].map((m) => ({ label: `${m} minutes`, onClick: () => st.startFocus(m, cardId) })),
    },
    { separator: true },
    {
      label: "Move to bucket",
      icon: <ArrowRightLeft size={14} />,
      submenu: lists.map((l) => ({
        label: l.title,
        checked: card.listId === l.id,
        onClick: () => set({ listId: l.id }),
      })),
    },
    {
      label: "Move to board",
      icon: <Kanban size={14} />,
      submenu: boards.length
        ? boards.map((b) => {
            const bl = Object.values(data.lists)
              .filter((l) => l.boardId === b.id && !l.archived)
              .sort(byOrder);
            return {
              label: (
                <span className="row gap-sm">
                  <span className="board-dot" style={{ background: b.color }} />
                  {b.title}
                </span>
              ),
              submenu: bl.length
                ? bl.map((l) => ({ label: l.title, onClick: () => useStore.getState().moveCardToBoard(cardId, b.id, l.id) }))
                : [{ label: <span className="muted">No buckets</span> }],
            };
          })
        : [{ label: <span className="muted">No other boards</span> }],
    },
    {
      label: "Link to task…",
      icon: <Link2 size={14} />,
      submenu: (close) => (
        <CardPicker
          exclude={[cardId, ...card.links.map((l) => l.cardId)]}
          onPick={(id) => {
            useStore.getState().linkCards(cardId, id, "relates");
            close();
          }}
        />
      ),
    },
    ...(hasRelations
      ? [
          {
            label: "Show related tasks",
            icon: <GitFork size={14} />,
            onClick: () => {
              st.navigate({ page: "board", boardId: card.boardId });
              st.setFilter(card.boardId, { relatedTo: cardId, relatedDeep: false });
            },
          },
        ]
      : []),
    {
      label: "Hand to AI…",
      icon: <Bot size={14} />,
      onClick: () => st.setOverlay({ aiDialog: { tab: "export", boardId: card.boardId, cardIds: [cardId] } }),
    },
    { label: "Duplicate", icon: <Copy size={14} />, onClick: () => st.duplicateCard(cardId) },
    {
      label: "Save as template",
      icon: <BookmarkPlus size={14} />,
      onClick: () => {
        st.saveTemplate(cardId, card.title);
        st.toast(`Saved template "${card.title}" (rename it in Settings)`);
      },
    },
    {
      label: "Archive",
      icon: <Archive size={14} />,
      onClick: () => archiveCard(card),
    },
    {
      label: "Delete",
      icon: <Trash2 size={14} />,
      danger: true,
      onClick: () => void deleteCard(card),
    },
  ];
}

function LiveLabelPicker({ cardId }: { cardId: ID }) {
  const card = useStore((s) => s.data.cards[cardId]);
  const board = useStore((s) => (card ? s.data.boards[card.boardId] : undefined));
  if (!card || !board) return null;
  return (
    <LabelPicker
      board={board}
      selected={card.labelIds}
      onToggle={(id, on) => {
        const cur = useStore.getState().data.cards[cardId].labelIds;
        useStore.getState().updateCard(cardId, { labelIds: on ? [...new Set([...cur, id])] : cur.filter((x) => x !== id) });
      }}
    />
  );
}
