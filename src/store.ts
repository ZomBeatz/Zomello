import { create } from "zustand";
import { addDays, differenceInCalendarDays } from "date-fns";
import { loadRaw, saveRaw } from "./storage";
import type { Activity, AppData, Board, BoardDisplay, BoardUi, Card, CardTemplate, Filter, ID, LinkType, List, Route, Settings } from "./types";
import { byOrder, emptyFilter, fromISO, inverseLink, nextRecurrenceDate, PALETTE, toISO, todayISO, uid } from "./utils";

const DEFAULT_LABELS = [
  { name: "Bug", color: "#ef4444" },
  { name: "Feature", color: "#22c55e" },
  { name: "Design", color: "#a855f7" },
  { name: "Research", color: "#0ea5e9" },
  { name: "Blocked", color: "#f97316" },
  { name: "Idea", color: "#eab308" },
];

export const defaultDisplay = (): BoardDisplay => ({
  columnWidth: "normal",
  compact: false,
  labelStyle: "text",
  badges: {
    dates: true,
    checklist: true,
    assignees: true,
    priority: true,
    description: true,
    links: true,
    time: true,
    attachments: true,
  },
  aging: false,
});

export const defaultSettings = (): Settings => ({
  theme: "system",
  me: "Me",
  people: ["Me"],
  accent: null,
  density: "normal",
  weekStartsOn: 1,
  defaultView: "board",
  sidebarCollapsed: false,
  reminders: { enabled: true, digest: true, digestTime: "09:00" },
  zoom: 1,
  a11y: {
    reduceMotion: false,
    highContrast: false,
    underlineLinks: false,
    readableSpacing: false,
    strongFocus: false,
    largerTargets: false,
  },
});

export const newBoard = (title: string, color: string, order: number): Board => ({
  id: uid(),
  title,
  description: "",
  color,
  icon: null,
  background: { type: "none" },
  display: defaultDisplay(),
  labels: DEFAULT_LABELS.map((l) => ({ id: uid(), ...l })),
  archived: false,
  starred: false,
  order,
  createdAt: Date.now(),
});

const newList = (boardId: ID, title: string, order: number): List => ({
  id: uid(),
  boardId,
  title,
  order,
  archived: false,
  wipLimit: null,
  collapsed: false,
});

const newCard = (boardId: ID, listId: ID, title: string, order: number, extra: Partial<Card> = {}): Card => ({
  id: uid(),
  boardId,
  listId,
  title,
  description: "",
  labelIds: [],
  priority: "medium",
  progress: "notStarted",
  startDate: null,
  dueDate: null,
  checklist: [],
  attachments: [],
  comments: [],
  assignees: [],
  links: [],
  recurrence: null,
  cover: null,
  coverImage: null,
  coverSize: "strip",
  activity: [],
  time: [],
  estimate: null,
  reminder: null,
  order,
  archived: false,
  createdAt: Date.now(),
  updatedAt: Date.now(),
  completedAt: null,
  ...extra,
});

function sampleData(): AppData {
  const board = newBoard("Getting started", PALETTE[6], 0);
  const lists = ["To do", "Doing", "Done"].map((t, i) => newList(board.id, t, i));
  const d = (n: number) => toISO(addDays(new Date(), n));
  const [, feature, design] = board.labels;
  const cards = [
    newCard(board.id, lists[0].id, "Click a card to open its details", 0, {
      description: "Cards have descriptions, checklists, labels, dates, priority, assignees, links and notes.",
      labelIds: [feature.id],
      checklist: [
        { id: uid(), text: "Open this card", done: true },
        { id: uid(), text: "Tick an item", done: false },
        { id: uid(), text: "Add a due date", done: false },
      ],
    }),
    newCard(board.id, lists[0].id, "Drag cards between buckets", 1, { dueDate: d(2), priority: "important" }),
    newCard(board.id, lists[0].id, "Try Group by: Progress / Priority / Due", 2, { labelIds: [design.id] }),
    newCard(board.id, lists[1].id, "Check the Calendar and Timeline views", 0, {
      progress: "inProgress",
      startDate: d(-2),
      dueDate: d(4),
    }),
    newCard(board.id, lists[1].id, "Press Ctrl+K to search everything", 1, { progress: "inProgress", dueDate: d(-1), priority: "urgent" }),
    newCard(board.id, lists[2].id, "Install Zomello", 0, { progress: "completed", completedAt: Date.now() }),
  ];
  return {
    version: 1,
    boards: { [board.id]: board },
    lists: Object.fromEntries(lists.map((l) => [l.id, l])),
    cards: Object.fromEntries(cards.map((c) => [c.id, c])),
    savedFilters: [],
    templates: [],
    ui: {},
    settings: defaultSettings(),
  };
}

/** Fill in any fields missing from older / hand-edited / imported files. */
export function normalize(raw: unknown): AppData {
  const d = (raw ?? {}) as Partial<AppData>;
  if (typeof d !== "object" || !d.boards || !d.lists || !d.cards) throw new Error("Not a Zomello data file");
  const boards: AppData["boards"] = {};
  for (const b of Object.values(d.boards)) {
    const display = { ...defaultDisplay(), ...b.display };
    display.badges = { ...defaultDisplay().badges, ...b.display?.badges };
    boards[b.id] = { ...newBoard("", PALETTE[6], 0), ...b, id: b.id, display };
  }
  const lists: AppData["lists"] = {};
  for (const l of Object.values(d.lists)) lists[l.id] = { ...newList(l.boardId, "", 0), ...l };
  const cards: AppData["cards"] = {};
  for (const c of Object.values(d.cards)) cards[c.id] = { ...newCard(c.boardId, c.listId, "", 0), ...c };
  const ui: AppData["ui"] = {};
  for (const [k, v] of Object.entries(d.ui ?? {})) ui[k] = { ...defaultUi(), ...v, filter: { ...emptyFilter(), ...v.filter } };
  return {
    version: 1,
    boards,
    lists,
    cards,
    savedFilters: d.savedFilters ?? [],
    templates: d.templates ?? [],
    ui,
    settings: {
      ...defaultSettings(),
      ...d.settings,
      reminders: { ...defaultSettings().reminders, ...d.settings?.reminders },
      a11y: { ...defaultSettings().a11y, ...d.settings?.a11y },
    },
  };
}

export const defaultUi = (view: BoardUi["view"] = "board"): BoardUi => ({
  view,
  groupBy: "bucket",
  filter: emptyFilter(),
  showCompleted: [],
});

export interface CardTrailStep {
  cardId: ID;
  /** How we left this card: through a checklist link, a linked task, or a "checklist item in" parent link. */
  via: "checklist" | "link" | "parent";
}

export interface Toast {
  id: ID;
  text: string;
  /** Show an Undo button that reverts the change. */
  undo?: boolean;
  key?: string;
}

interface State {
  data: AppData;
  loaded: boolean;
  loadError: string | null;
  saveError: string | null;
  route: Route;
  openCardId: ID | null;
  cardTrail: CardTrailStep[];
  /** Direction of the last card navigation, for the slide animation. */
  cardNavDir: "forward" | "back" | null;
  searchOpen: boolean;
  quickAddOpen: boolean;
  helpOpen: boolean;
  customizeBoardId: ID | null;
  toasts: Toast[];

  load(): Promise<void>;
  undo(): boolean;
  redo(): boolean;
  /** `key`: a new toast with the same key replaces the old one (e.g. zoom level). */
  toast(text: string, opts?: { undo?: boolean; key?: string }): void;
  dismissToast(id: ID): void;
  setOverlay(patch: Partial<Pick<State, "quickAddOpen" | "helpOpen" | "customizeBoardId" | "searchOpen">>): void;
  replaceData(data: AppData): void;
  navigate(route: Route): void;
  /**
   * Open a card. With `via` set, the current card is kept on a trail so the user can step back
   * (used when following a linked task / checklist link from inside a card).
   */
  openCard(id: ID | null, opts?: { via?: CardTrailStep["via"] }): void;
  /** Return to the card we came from (or to an earlier step of the trail). */
  cardBack(toIndex?: number): void;
  setSearchOpen(open: boolean): void;

  createBoard(title: string, color?: string): ID;
  updateBoard(id: ID, patch: Partial<Board>): void;
  deleteBoard(id: ID): void;
  /** Copy a board; without cards it's a "new board from template". */
  duplicateBoard(id: ID, opts?: { title?: string; withCards?: boolean }): ID;

  createList(boardId: ID, title: string): ID;
  updateList(id: ID, patch: Partial<List>): void;
  deleteList(id: ID): void;
  reorderLists(ids: ID[]): void;

  createCard(listId: ID, title: string, extra?: Partial<Card>): ID;
  updateCard(id: ID, patch: Partial<Card>): void;
  deleteCard(id: ID): void;
  duplicateCard(id: ID): ID;
  moveCardToBoard(id: ID, boardId: ID, listId: ID): void;
  /** Set `order` by position for `ids` and apply `patch` to the moved card. */
  applyCardOrder(ids: ID[], movedId: ID, patch: Partial<Card>): void;
  linkCards(a: ID, b: ID, type: LinkType): void;
  unlinkCards(a: ID, b: ID): void;
  /** Point a checklist item at a card (or detach it with null). */
  linkChecklistItem(cardId: ID, itemId: ID, target: ID | null): void;
  /** Create a card from a checklist item and keep the item linked to it. */
  spinOffChecklistItem(cardId: ID, itemId: ID, listId: ID): ID;
  /** Toggle a checklist item; linked items toggle the linked card instead. */
  toggleChecklistItem(cardId: ID, itemId: ID): void;

  startTimer(cardId: ID): void;
  stopTimer(): void;
  addTime(cardId: ID, minutes: number): void;
  deleteTimeEntry(cardId: ID, entryId: ID): void;

  saveTemplate(cardId: ID, name: string): void;
  updateTemplate(id: ID, patch: Partial<CardTemplate>): void;
  deleteTemplate(id: ID): void;
  createFromTemplate(templateId: ID, listId: ID, extra?: Partial<Card>): ID;

  setBoardUi(boardId: ID, patch: Partial<BoardUi>): void;
  setFilter(boardId: ID, patch: Partial<Filter>): void;
  saveFilter(boardId: ID, name: string, filter: Filter): void;
  deleteSavedFilter(id: ID): void;
  updateSettings(patch: Partial<Settings>): void;
}

const progressPatch = (prev: Card, patch: Partial<Card>): Partial<Card> => {
  if (!patch.progress || patch.progress === prev.progress) return patch;
  return { ...patch, completedAt: patch.progress === "completed" ? Date.now() : null };
};

/** The next instance of a recurring card, or null when the rule has run out. */
function nextOccurrence(c: Card): Card | null {
  if (!c.recurrence) return null;
  const due = nextRecurrenceDate(c.recurrence, c.dueDate ?? todayISO());
  if (!due) return null;
  const startDate =
    c.startDate && c.dueDate
      ? toISO(addDays(fromISO(due), differenceInCalendarDays(fromISO(c.startDate), fromISO(c.dueDate))))
      : null;
  return {
    ...structuredClone(c),
    id: uid(),
    dueDate: due,
    startDate,
    progress: "notStarted",
    completedAt: null,
    archived: false,
    checklist: c.checklist.map((i) => ({ ...i, id: uid(), done: i.cardId ? i.done : false })),
    comments: [],
    links: [],
    time: [],
    activity: [{ at: Date.now(), kind: "created" }],
    order: c.order - 0.5,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

/**
 * Apply a patch to one card inside a cards map. Handles completedAt and, when a
 * recurring card gets completed, spawns its next occurrence (the completed one
 * stops recurring so re-toggling it can't spawn duplicates).
 */
const MAX_ACTIVITY = 200;

/** Activity entries describing what changed between two versions of a card. */
function diffActivity(prev: Card, next: Card): Activity[] {
  const at = Date.now();
  const out: Activity[] = [];
  if (prev.boardId !== next.boardId) out.push({ at, kind: "board", from: prev.boardId, to: next.boardId });
  else if (prev.listId !== next.listId) out.push({ at, kind: "moved", from: prev.listId, to: next.listId });
  if (prev.progress !== next.progress) out.push({ at, kind: "progress", from: prev.progress, to: next.progress });
  if (prev.priority !== next.priority) out.push({ at, kind: "priority", from: prev.priority, to: next.priority });
  if (prev.dueDate !== next.dueDate) out.push({ at, kind: "due", from: prev.dueDate, to: next.dueDate });
  if (prev.archived !== next.archived) out.push({ at, kind: next.archived ? "archived" : "restored" });
  if (prev.title !== next.title) out.push({ at, kind: "renamed", from: prev.title, to: next.title });
  for (const a of next.assignees) if (!prev.assignees.includes(a)) out.push({ at, kind: "assigned", to: a });
  for (const a of prev.assignees) if (!next.assignees.includes(a)) out.push({ at, kind: "unassigned", from: a });
  return out;
}

function patchCard(cards: Record<ID, Card>, id: ID, patch: Partial<Card>): Record<ID, Card> {
  const prev = cards[id];
  if (!prev) return cards;
  let next: Card = { ...prev, ...progressPatch(prev, patch), updatedAt: Date.now() };
  const changes = diffActivity(prev, next);
  if (changes.length) next.activity = [...next.activity, ...changes].slice(-MAX_ACTIVITY);
  const out = { ...cards };
  if (next.progress === "completed" && prev.progress !== "completed" && next.recurrence) {
    const spawn = nextOccurrence(next);
    if (spawn) out[spawn.id] = spawn;
    next = { ...next, recurrence: null };
  }
  out[id] = next;
  // Keep checklist items that point at this card in sync with its completion.
  if (next.progress !== prev.progress) {
    const done = next.progress === "completed";
    for (const c of Object.values(out)) {
      if (c.checklist.some((i) => i.cardId === id && i.done !== done))
        out[c.id] = { ...c, checklist: c.checklist.map((i) => (i.cardId === id ? { ...i, done } : i)) };
    }
  }
  return out;
}

/** Remove links / checklist references pointing at deleted cards. */
function pruneRefs(cards: Record<ID, Card>): Record<ID, Card> {
  const out: Record<ID, Card> = {};
  for (const [id, c] of Object.entries(cards)) {
    const links = c.links.filter((l) => cards[l.cardId]);
    const dangling = c.checklist.some((i) => i.cardId && !cards[i.cardId]);
    out[id] =
      links.length === c.links.length && !dangling
        ? c
        : {
            ...c,
            links,
            checklist: c.checklist.map((i) => (i.cardId && !cards[i.cardId] ? { ...i, cardId: null } : i)),
          };
  }
  return out;
}

// ---- Undo / redo: snapshots of `data` (view state like filters is not undoable) ----
const HISTORY_LIMIT = 150;
/** Changes closer together than this are merged into one undo step (e.g. typing). */
const COALESCE_MS = 700;
let past: AppData[] = [];
let future: AppData[] = [];
let lastChange = 0;
/** View preferences (zoom, sidebar) change too often to be worth an undo step. */
const VIEW_PREFS = ["zoom", "sidebarCollapsed"] as const;
const settingsChanged = (a: Settings, b: Settings) =>
  a !== b &&
  (Object.keys(a) as (keyof Settings)[]).some(
    (k) => !(VIEW_PREFS as readonly string[]).includes(k) && JSON.stringify(a[k]) !== JSON.stringify(b[k]),
  );
const undoable = (a: AppData, b: AppData) =>
  a.boards !== b.boards || a.lists !== b.lists || a.cards !== b.cards ||
  a.savedFilters !== b.savedFilters || a.templates !== b.templates || settingsChanged(a.settings, b.settings);

export const useStore = create<State>((set, get) => {
  /** Apply an immutable update to `data`, recording undo history. */
  const mut = (fn: (d: AppData) => AppData) =>
    set((s) => {
      const next = fn(s.data);
      if (s.loaded && next !== s.data && undoable(next, s.data)) {
        const now = Date.now();
        if (now - lastChange > COALESCE_MS) {
          past.push(s.data);
          if (past.length > HISTORY_LIMIT) past.shift();
        }
        lastChange = now;
        future = [];
      }
      return { data: next };
    });

  return {
    data: sampleData(),
    loaded: false,
    loadError: null,
    saveError: null,
    route: { page: "home" },
    openCardId: null,
    cardTrail: [],
    cardNavDir: null,
    searchOpen: false,
    quickAddOpen: false,
    helpOpen: false,
    customizeBoardId: null,
    toasts: [],

    undo() {
      const prev = past.pop();
      if (!prev) return false;
      future.push(get().data);
      lastChange = 0;
      set((s) => ({ data: { ...prev, ui: s.data.ui } }));
      return true;
    },
    redo() {
      const next = future.pop();
      if (!next) return false;
      past.push(get().data);
      lastChange = 0;
      set((s) => ({ data: { ...next, ui: s.data.ui } }));
      return true;
    },
    toast(text, opts) {
      const t: Toast = { id: uid(), text, undo: opts?.undo, key: opts?.key };
      set((s) => ({ toasts: [...s.toasts.filter((x) => !t.key || x.key !== t.key).slice(-3), t] }));
      setTimeout(() => get().dismissToast(t.id), 6000);
    },
    dismissToast(id) {
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
    },
    setOverlay(patch) {
      set(patch);
    },

    async load() {
      try {
        const raw = await loadRaw();
        const data = raw ? normalize(JSON.parse(raw)) : sampleData();
        const first = Object.values(data.boards).filter((b) => !b.archived).sort(byOrder)[0];
        set({ data, loaded: true, route: raw ? { page: "home" } : first ? { page: "board", boardId: first.id } : { page: "home" } });
      } catch (e) {
        // Never overwrite a file we failed to parse: stay unloaded so autosave is disabled.
        set({ loadError: String(e) });
      }
    },

    replaceData(data) {
      past.push(get().data);
      future = [];
      set({ data, route: { page: "home" }, openCardId: null });
    },

    navigate(route) {
      set({ route, openCardId: null, cardTrail: [], cardNavDir: null });
    },
    openCard(id, opts) {
      const { openCardId, cardTrail } = get();
      if (id && opts?.via && openCardId && openCardId !== id)
        set({ openCardId: id, cardTrail: [...cardTrail, { cardId: openCardId, via: opts.via }], cardNavDir: "forward" });
      else set({ openCardId: id, cardTrail: [], cardNavDir: null });
    },
    cardBack(toIndex) {
      const { cardTrail, data } = get();
      if (!cardTrail.length) return;
      const i = toIndex ?? cardTrail.length - 1;
      const step = cardTrail[i];
      // Skip back past cards that were deleted meanwhile.
      if (!data.cards[step.cardId]) return set({ cardTrail: cardTrail.slice(0, i) });
      set({ openCardId: step.cardId, cardTrail: cardTrail.slice(0, i), cardNavDir: "back" });
    },
    setSearchOpen(open) {
      set({ searchOpen: open });
    },

    createBoard(title, color) {
      const order = Math.max(-1, ...Object.values(get().data.boards).map((b) => b.order)) + 1;
      const board = newBoard(title, color ?? PALETTE[order % PALETTE.length], order);
      const lists = ["To do", "In progress", "Done"].map((t, i) => newList(board.id, t, i));
      mut((d) => ({
        ...d,
        boards: { ...d.boards, [board.id]: board },
        lists: { ...d.lists, ...Object.fromEntries(lists.map((l) => [l.id, l])) },
        ui: { ...d.ui, [board.id]: defaultUi(d.settings.defaultView) },
      }));
      return board.id;
    },
    updateBoard(id, patch) {
      mut((d) => ({ ...d, boards: { ...d.boards, [id]: { ...d.boards[id], ...patch } } }));
    },
    deleteBoard(id) {
      mut((d) => {
        const { [id]: _, ...boards } = d.boards;
        const { [id]: __, ...ui } = d.ui;
        return {
          ...d,
          boards,
          ui,
          lists: Object.fromEntries(Object.entries(d.lists).filter(([, l]) => l.boardId !== id)),
          cards: pruneRefs(Object.fromEntries(Object.entries(d.cards).filter(([, c]) => c.boardId !== id))),
          savedFilters: d.savedFilters.filter((f) => f.boardId !== id),
        };
      });
      const r = get().route;
      if (r.page === "board" && r.boardId === id) set({ route: { page: "home" } });
    },
    duplicateBoard(id, opts) {
      const d = get().data;
      const src = d.boards[id];
      const order = Math.max(...Object.values(d.boards).map((b) => b.order)) + 1;
      const labelMap = new Map(src.labels.map((l) => [l.id, uid()]));
      const board: Board = {
        ...src,
        id: uid(),
        title: opts?.title ?? `${src.title} (copy)`,
        order,
        starred: false,
        archived: false,
        createdAt: Date.now(),
        labels: src.labels.map((l) => ({ ...l, id: labelMap.get(l.id)! })),
      };
      const listMap = new Map<ID, ID>();
      const lists = Object.values(d.lists)
        .filter((l) => l.boardId === id && !l.archived)
        .map((l) => {
          const nl = { ...l, id: uid(), boardId: board.id };
          listMap.set(l.id, nl.id);
          return nl;
        });
      const cards = Object.values(d.cards)
        .filter((c) => opts?.withCards !== false && c.boardId === id && listMap.has(c.listId))
        .map((c) => ({
          ...structuredClone(c),
          id: uid(),
          boardId: board.id,
          listId: listMap.get(c.listId)!,
          labelIds: c.labelIds.map((l) => labelMap.get(l)).filter((x): x is ID => !!x),
          links: [],
          time: [],
        }));
      mut((d) => ({
        ...d,
        boards: { ...d.boards, [board.id]: board },
        lists: { ...d.lists, ...Object.fromEntries(lists.map((l) => [l.id, l])) },
        cards: { ...d.cards, ...Object.fromEntries(cards.map((c) => [c.id, c])) },
      }));
      return board.id;
    },

    createList(boardId, title) {
      const siblings = Object.values(get().data.lists).filter((l) => l.boardId === boardId);
      const list = newList(boardId, title, Math.max(-1, ...siblings.map((l) => l.order)) + 1);
      mut((d) => ({ ...d, lists: { ...d.lists, [list.id]: list } }));
      return list.id;
    },
    updateList(id, patch) {
      mut((d) => ({ ...d, lists: { ...d.lists, [id]: { ...d.lists[id], ...patch } } }));
    },
    deleteList(id) {
      mut((d) => {
        const { [id]: _, ...lists } = d.lists;
        return { ...d, lists, cards: pruneRefs(Object.fromEntries(Object.entries(d.cards).filter(([, c]) => c.listId !== id))) };
      });
    },
    reorderLists(ids) {
      mut((d) => {
        const lists = { ...d.lists };
        ids.forEach((id, i) => (lists[id] = { ...lists[id], order: i }));
        return { ...d, lists };
      });
    },

    createCard(listId, title, extra) {
      const d = get().data;
      const list = d.lists[listId];
      const siblings = Object.values(d.cards).filter((c) => c.listId === listId);
      const card = newCard(list.boardId, listId, title, Math.max(-1, ...siblings.map((c) => c.order)) + 1, {
        activity: [{ at: Date.now(), kind: "created" }],
        ...extra,
      });
      if (card.progress === "completed") card.completedAt = Date.now();
      mut((d) => ({ ...d, cards: { ...d.cards, [card.id]: card } }));
      return card.id;
    },
    updateCard(id, patch) {
      mut((d) => ({ ...d, cards: patchCard(d.cards, id, patch) }));
    },
    deleteCard(id) {
      mut((d) => {
        const { [id]: _, ...cards } = d.cards;
        return { ...d, cards: pruneRefs(cards) };
      });
      if (get().openCardId === id) set({ openCardId: null });
    },
    duplicateCard(id) {
      const src = get().data.cards[id];
      const card: Card = {
        ...structuredClone(src),
        id: uid(),
        title: `${src.title} (copy)`,
        order: src.order + 0.5,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        checklist: src.checklist.map((i) => ({ ...i, id: uid() })),
        links: [],
        time: [],
        activity: [{ at: Date.now(), kind: "created" }],
      };
      mut((d) => ({ ...d, cards: { ...d.cards, [card.id]: card } }));
      return card.id;
    },
    moveCardToBoard(id, boardId, listId) {
      mut((d) => {
        const c = d.cards[id];
        // Carry labels across by matching name; drop ones the target board lacks.
        const srcLabels = d.boards[c.boardId].labels;
        const dstLabels = d.boards[boardId].labels;
        const labelIds = c.labelIds
          .map((lid) => srcLabels.find((l) => l.id === lid)?.name)
          .map((name) => dstLabels.find((l) => l.name === name)?.id)
          .filter((x): x is ID => !!x);
        const order = Math.max(-1, ...Object.values(d.cards).filter((x) => x.listId === listId).map((x) => x.order)) + 1;
        return { ...d, cards: patchCard(d.cards, id, { boardId, listId, labelIds, order }) };
      });
    },
    applyCardOrder(ids, movedId, patch) {
      mut((d) => {
        const cards = { ...d.cards };
        ids.forEach((id, i) => {
          if (cards[id].order !== i) cards[id] = { ...cards[id], order: i };
        });
        return { ...d, cards: patchCard(cards, movedId, patch) };
      });
    },
    linkCards(a, b, type) {
      if (a === b) return;
      mut((d) => {
        const ca = d.cards[a], cb = d.cards[b];
        if (!ca || !cb) return d;
        return {
          ...d,
          cards: {
            ...d.cards,
            [a]: { ...ca, links: [...ca.links.filter((l) => l.cardId !== b), { cardId: b, type }] },
            [b]: { ...cb, links: [...cb.links.filter((l) => l.cardId !== a), { cardId: a, type: inverseLink(type) }] },
          },
        };
      });
    },
    unlinkCards(a, b) {
      mut((d) => {
        const cards = { ...d.cards };
        if (cards[a]) cards[a] = { ...cards[a], links: cards[a].links.filter((l) => l.cardId !== b) };
        if (cards[b]) cards[b] = { ...cards[b], links: cards[b].links.filter((l) => l.cardId !== a) };
        return { ...d, cards };
      });
    },
    linkChecklistItem(cardId, itemId, target) {
      const c = get().data.cards[cardId];
      const t = target ? get().data.cards[target] : null;
      get().updateCard(cardId, {
        checklist: c.checklist.map((i) =>
          i.id === itemId ? { ...i, cardId: target, text: t ? t.title : i.text, done: t ? t.progress === "completed" : i.done } : i,
        ),
      });
    },
    spinOffChecklistItem(cardId, itemId, listId) {
      const c = get().data.cards[cardId];
      const item = c.checklist.find((i) => i.id === itemId)!;
      const newId = get().createCard(listId, item.text, item.done ? { progress: "completed" } : {});
      get().linkChecklistItem(cardId, itemId, newId);
      return newId;
    },
    toggleChecklistItem(cardId, itemId) {
      const d = get().data;
      const item = d.cards[cardId].checklist.find((i) => i.id === itemId);
      if (!item) return;
      const target = item.cardId ? d.cards[item.cardId] : null;
      if (target) get().updateCard(target.id, { progress: target.progress === "completed" ? "notStarted" : "completed" });
      else
        get().updateCard(cardId, {
          checklist: d.cards[cardId].checklist.map((i) => (i.id === itemId ? { ...i, done: !i.done } : i)),
        });
    },

    startTimer(cardId) {
      const now = Date.now();
      mut((d) => {
        const cards = { ...d.cards };
        // Only one timer runs at a time.
        for (const c of Object.values(cards))
          if (c.time.some((t) => t.end === null))
            cards[c.id] = { ...c, time: c.time.map((t) => (t.end === null ? { ...t, end: now } : t)) };
        const c = cards[cardId];
        const starts = c.progress === "notStarted";
        cards[cardId] = {
          ...c,
          time: [...c.time, { id: uid(), start: now, end: null }],
          progress: starts ? "inProgress" : c.progress,
          activity: starts ? [...c.activity, { at: now, kind: "progress", from: c.progress, to: "inProgress" }] : c.activity,
        };
        return { ...d, cards };
      });
    },
    stopTimer() {
      const now = Date.now();
      mut((d) => {
        const cards = { ...d.cards };
        for (const c of Object.values(cards))
          if (c.time.some((t) => t.end === null))
            cards[c.id] = { ...c, time: c.time.map((t) => (t.end === null ? { ...t, end: now } : t)) };
        return { ...d, cards };
      });
    },
    addTime(cardId, minutes) {
      const end = Date.now();
      const c = get().data.cards[cardId];
      get().updateCard(cardId, { time: [...c.time, { id: uid(), start: end - minutes * 60_000, end }] });
    },
    deleteTimeEntry(cardId, entryId) {
      const c = get().data.cards[cardId];
      get().updateCard(cardId, { time: c.time.filter((t) => t.id !== entryId) });
    },

    saveTemplate(cardId, name) {
      const d = get().data;
      const c = d.cards[cardId];
      const labels = d.boards[c.boardId].labels.filter((l) => c.labelIds.includes(l.id));
      const t: CardTemplate = {
        id: uid(),
        name,
        createdAt: Date.now(),
        title: c.title,
        description: c.description,
        checklist: c.checklist.map((i) => i.text),
        labels: labels.map(({ name, color }) => ({ name, color })),
        priority: c.priority,
        assignees: c.assignees,
        recurrence: c.recurrence,
        cover: c.cover,
        estimate: c.estimate,
      };
      mut((d) => ({ ...d, templates: [...d.templates, t] }));
    },
    updateTemplate(id, patch) {
      mut((d) => ({ ...d, templates: d.templates.map((t) => (t.id === id ? { ...t, ...patch } : t)) }));
    },
    deleteTemplate(id) {
      mut((d) => ({ ...d, templates: d.templates.filter((t) => t.id !== id) }));
    },
    createFromTemplate(templateId, listId, extra) {
      const d = get().data;
      const t = d.templates.find((x) => x.id === templateId)!;
      const board = d.boards[d.lists[listId].boardId];
      // Match labels by name; create any the board doesn't have yet.
      const labels = [...board.labels];
      const labelIds = t.labels.map((tl) => {
        const found = labels.find((l) => l.name.toLowerCase() === tl.name.toLowerCase());
        if (found) return found.id;
        const nl = { id: uid(), ...tl };
        labels.push(nl);
        return nl.id;
      });
      if (labels.length !== board.labels.length) get().updateBoard(board.id, { labels });
      return get().createCard(listId, t.title, {
        description: t.description,
        checklist: t.checklist.map((text) => ({ id: uid(), text, done: false })),
        labelIds,
        priority: t.priority,
        assignees: t.assignees,
        recurrence: t.recurrence,
        cover: t.cover,
        estimate: t.estimate,
        ...(t.recurrence ? { dueDate: todayISO() } : {}),
        ...extra,
      });
    },

    setBoardUi(boardId, patch) {
      mut((d) => ({ ...d, ui: { ...d.ui, [boardId]: { ...(d.ui[boardId] ?? defaultUi(d.settings.defaultView)), ...patch } } }));
    },
    setFilter(boardId, patch) {
      const cur = get().data.ui[boardId] ?? defaultUi();
      get().setBoardUi(boardId, { filter: { ...cur.filter, ...patch } });
    },
    saveFilter(boardId, name, filter) {
      mut((d) => ({ ...d, savedFilters: [...d.savedFilters, { id: uid(), name, boardId, filter }] }));
    },
    deleteSavedFilter(id) {
      mut((d) => ({ ...d, savedFilters: d.savedFilters.filter((f) => f.id !== id) }));
    },
    updateSettings(patch) {
      mut((d) => ({ ...d, settings: { ...d.settings, ...patch } }));
    },
  };
});

// ---- Autosave: debounce writes whenever `data` changes after the initial load ----
let timer: ReturnType<typeof setTimeout> | undefined;
let pending: AppData | null = null;

async function flush() {
  if (!pending) return;
  const snapshot = pending;
  pending = null;
  try {
    await saveRaw(JSON.stringify(snapshot));
    if (useStore.getState().saveError) useStore.setState({ saveError: null });
  } catch (e) {
    useStore.setState({ saveError: String(e) });
  }
}

useStore.subscribe((s, prev) => {
  if (!s.loaded || s.data === prev.data || !prev.loaded) {
    // The very first load also counts as a change worth saving (writes the sample board).
    if (s.loaded && !prev.loaded) {
      pending = s.data;
      void flush();
    }
    return;
  }
  pending = s.data;
  clearTimeout(timer);
  timer = setTimeout(flush, 400);
});

window.addEventListener("beforeunload", () => void flush());
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") void flush();
});

// ---- Selectors ----
export const useBoardUi = (boardId: ID) => {
  const ui = useStore((s) => s.data.ui[boardId]);
  const view = useStore((s) => s.data.settings.defaultView);
  return ui ?? defaultUi(view);
};

/** The card whose timer is running, if any. */
export const runningTimer = (cards: Record<ID, Card>) => {
  for (const c of Object.values(cards)) {
    const t = c.time.find((e) => e.end === null);
    if (t) return { card: c, entry: t };
  }
  return null;
};
