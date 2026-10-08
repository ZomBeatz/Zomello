import { create } from "zustand";
import { addDays } from "date-fns";
import { loadRaw, saveRaw } from "./storage";
import type { AppData, Board, BoardUi, Card, Filter, ID, List, Route, Settings } from "./types";
import { byOrder, emptyFilter, PALETTE, toISO, uid } from "./utils";

const DEFAULT_LABELS = [
  { name: "Bug", color: "#ef4444" },
  { name: "Feature", color: "#22c55e" },
  { name: "Design", color: "#a855f7" },
  { name: "Research", color: "#0ea5e9" },
  { name: "Blocked", color: "#f97316" },
  { name: "Idea", color: "#eab308" },
];

export const newBoard = (title: string, color: string, order: number): Board => ({
  id: uid(),
  title,
  description: "",
  color,
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
  cover: null,
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
    newCard(board.id, lists[2].id, "Install Planwise", 0, { progress: "completed", completedAt: Date.now() }),
  ];
  return {
    version: 1,
    boards: { [board.id]: board },
    lists: Object.fromEntries(lists.map((l) => [l.id, l])),
    cards: Object.fromEntries(cards.map((c) => [c.id, c])),
    savedFilters: [],
    ui: {},
    settings: { theme: "system", me: "Me", people: ["Me"] },
  };
}

/** Fill in any fields missing from older / hand-edited / imported files. */
export function normalize(raw: unknown): AppData {
  const d = (raw ?? {}) as Partial<AppData>;
  if (typeof d !== "object" || !d.boards || !d.lists || !d.cards) throw new Error("Not a Planwise data file");
  const base = sampleData();
  const boards: AppData["boards"] = {};
  for (const b of Object.values(d.boards)) boards[b.id] = { ...newBoard("", PALETTE[6], 0), ...b, id: b.id };
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
    ui,
    settings: { ...base.settings, ...d.settings },
  };
}

export const defaultUi = (): BoardUi => ({ view: "board", groupBy: "bucket", filter: emptyFilter(), showCompleted: [] });

interface State {
  data: AppData;
  loaded: boolean;
  loadError: string | null;
  saveError: string | null;
  route: Route;
  openCardId: ID | null;
  searchOpen: boolean;

  load(): Promise<void>;
  replaceData(data: AppData): void;
  navigate(route: Route): void;
  openCard(id: ID | null): void;
  setSearchOpen(open: boolean): void;

  createBoard(title: string, color?: string): ID;
  updateBoard(id: ID, patch: Partial<Board>): void;
  deleteBoard(id: ID): void;
  duplicateBoard(id: ID): ID;

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

export const useStore = create<State>((set, get) => {
  /** Apply an immutable update to `data`. */
  const mut = (fn: (d: AppData) => AppData) => set((s) => ({ data: fn(s.data) }));

  return {
    data: sampleData(),
    loaded: false,
    loadError: null,
    saveError: null,
    route: { page: "home" },
    openCardId: null,
    searchOpen: false,

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
      set({ data, route: { page: "home" }, openCardId: null });
    },

    navigate(route) {
      set({ route, openCardId: null });
    },
    openCard(id) {
      set({ openCardId: id });
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
          cards: Object.fromEntries(Object.entries(d.cards).filter(([, c]) => c.boardId !== id)),
          savedFilters: d.savedFilters.filter((f) => f.boardId !== id),
        };
      });
      const r = get().route;
      if (r.page === "board" && r.boardId === id) set({ route: { page: "home" } });
    },
    duplicateBoard(id) {
      const d = get().data;
      const src = d.boards[id];
      const order = Math.max(...Object.values(d.boards).map((b) => b.order)) + 1;
      const labelMap = new Map(src.labels.map((l) => [l.id, uid()]));
      const board: Board = {
        ...src,
        id: uid(),
        title: `${src.title} (copy)`,
        order,
        starred: false,
        createdAt: Date.now(),
        labels: src.labels.map((l) => ({ ...l, id: labelMap.get(l.id)! })),
      };
      const listMap = new Map<ID, ID>();
      const lists = Object.values(d.lists)
        .filter((l) => l.boardId === id)
        .map((l) => {
          const nl = { ...l, id: uid(), boardId: board.id };
          listMap.set(l.id, nl.id);
          return nl;
        });
      const cards = Object.values(d.cards)
        .filter((c) => c.boardId === id && listMap.has(c.listId))
        .map((c) => ({
          ...structuredClone(c),
          id: uid(),
          boardId: board.id,
          listId: listMap.get(c.listId)!,
          labelIds: c.labelIds.map((l) => labelMap.get(l)).filter((x): x is ID => !!x),
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
        return { ...d, lists, cards: Object.fromEntries(Object.entries(d.cards).filter(([, c]) => c.listId !== id)) };
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
      const card = newCard(list.boardId, listId, title, Math.max(-1, ...siblings.map((c) => c.order)) + 1, extra);
      if (card.progress === "completed") card.completedAt = Date.now();
      mut((d) => ({ ...d, cards: { ...d.cards, [card.id]: card } }));
      return card.id;
    },
    updateCard(id, patch) {
      mut((d) => {
        const prev = d.cards[id];
        if (!prev) return d;
        return { ...d, cards: { ...d.cards, [id]: { ...prev, ...progressPatch(prev, patch), updatedAt: Date.now() } } };
      });
    },
    deleteCard(id) {
      mut((d) => {
        const { [id]: _, ...cards } = d.cards;
        return { ...d, cards };
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
        return { ...d, cards: { ...d.cards, [id]: { ...c, boardId, listId, labelIds, order, updatedAt: Date.now() } } };
      });
    },
    applyCardOrder(ids, movedId, patch) {
      mut((d) => {
        const cards = { ...d.cards };
        ids.forEach((id, i) => {
          if (cards[id].order !== i) cards[id] = { ...cards[id], order: i };
        });
        const prev = cards[movedId];
        cards[movedId] = { ...prev, ...progressPatch(prev, patch), updatedAt: Date.now() };
        return { ...d, cards };
      });
    },

    setBoardUi(boardId, patch) {
      mut((d) => ({ ...d, ui: { ...d.ui, [boardId]: { ...(d.ui[boardId] ?? defaultUi()), ...patch } } }));
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
export const useBoardUi = (boardId: ID) => useStore((s) => s.data.ui[boardId]) ?? defaultUi();
