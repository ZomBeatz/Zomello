import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// The store runs in the browser; give it the few browser pieces it touches when it loads.
const mem = new Map<string, string>();
Object.assign(globalThis, {
  window: Object.assign(globalThis, { addEventListener() {}, removeEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {} }) }),
  document: { addEventListener() {}, visibilityState: "visible", querySelector: () => null },
  localStorage: { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => mem.set(k, v), removeItem: (k: string) => mem.delete(k) },
  location: { hash: "", search: "", href: "http://localhost/" },
});

let useStore: typeof import("./store").useStore;
beforeAll(async () => {
  ({ useStore } = await import("./store"));
});

const st = () => useStore.getState();
const card = (id: string) => st().data.cards[id];
/** A board with its three default buckets (To do, In progress, Done) and two labels. */
function board(title = "Test") {
  const id = st().createBoard(title);
  st().updateBoard(id, { labels: [{ id: `${id}-red`, name: "Red", color: "#f00" }, { id: `${id}-blue`, name: "Blue", color: "#00f" }] });
  const lists = Object.values(st().data.lists).filter((l) => l.boardId === id).sort((a, b) => a.order - b.order);
  return { id, todo: lists[0].id, doing: lists[1].id, done: lists[2].id, red: `${id}-red`, blue: `${id}-blue` };
}

beforeEach(() => {
  useStore.setState({ loaded: true, selected: [] });
});
afterEach(() => {
  vi.useRealTimers();
});

describe("bucket rules", () => {
  it("gives cards made in a bucket its labels and priority, and they keep them after moving", () => {
    const b = board();
    st().updateList(b.todo, { newLabelIds: [b.red], newPriority: "urgent" });
    const c = st().createCard(b.todo, "Made here");
    expect(card(c).labelIds).toEqual([b.red]);
    expect(card(c).priority).toBe("urgent");
    st().moveCardToList(c, b.doing);
    expect(card(c).labelIds).toEqual([b.red]);
  });

  it("doesn't give made-here labels to cards moved in", () => {
    const b = board();
    st().updateList(b.doing, { newLabelIds: [b.red] });
    const c = st().createCard(b.todo, "Moved in");
    st().moveCardToList(c, b.doing);
    expect(card(c).labelIds).toEqual([]);
  });

  it("adds moved-in labels to cards moved or made there, once, next to their own", () => {
    const b = board();
    st().updateList(b.doing, { arriveLabelIds: [b.red] });
    const c = st().createCard(b.todo, "Card", { labelIds: [b.blue] });
    st().moveCardToList(c, b.doing);
    expect(card(c).labelIds).toEqual([b.blue, b.red]);
    st().moveCardToList(c, b.todo);
    st().moveCardToList(c, b.doing);
    expect(card(c).labelIds).toEqual([b.blue, b.red]);
    expect(card(st().createCard(b.doing, "Made there")).labelIds).toEqual([b.red]);
  });

  it("still sets progress on arrival, and labels arrive even when progress is set at the same time", () => {
    const b = board();
    st().updateList(b.done, { arriveLabelIds: [b.blue] });
    const c = st().createCard(b.todo, "Card");
    st().updateCard(c, { listId: b.done });
    expect(card(c).progress).toBe("completed");
    const d = st().createCard(b.todo, "Card 2");
    st().updateCard(d, { listId: b.done, progress: "waiting" });
    expect(card(d).progress).toBe("waiting");
    expect(card(d).labelIds).toEqual([b.blue]);
  });

  it("skips rule labels the board no longer has", () => {
    const b = board();
    st().updateList(b.todo, { newLabelIds: [b.red, "gone"] });
    expect(card(st().createCard(b.todo, "Card")).labelIds).toEqual([b.red]);
  });

  it("applies the target bucket's rules when a card moves to another board", () => {
    const a = board("A");
    const b = board("B");
    st().updateList(b.doing, { arriveLabelIds: [b.blue] });
    const c = st().createCard(a.todo, "Traveller", { labelIds: [a.red] });
    st().moveCardToBoard(c, b.id, b.doing);
    // "Red" carries over by name to B's own Red label, and B's bucket adds Blue.
    expect(card(c).labelIds).toEqual([b.red, b.blue]);
    expect(card(c).progress).toBe("inProgress");
  });

  it("copies of a board keep their rules, pointing at the copy's labels", () => {
    const b = board();
    st().updateList(b.todo, { newLabelIds: [b.red], arriveLabelIds: [b.blue], newPriority: "low" });
    const copy = st().duplicateBoard(b.id);
    const todo = Object.values(st().data.lists).find((l) => l.boardId === copy && l.title === "To do")!;
    const labels = st().data.boards[copy].labels;
    expect(todo.newLabelIds).toEqual([labels.find((l) => l.name === "Red")!.id]);
    expect(todo.arriveLabelIds).toEqual([labels.find((l) => l.name === "Blue")!.id]);
    expect(todo.newPriority).toBe("low");
    expect(card(st().createCard(todo.id, "In the copy")).labelIds).toEqual(todo.newLabelIds!.concat(todo.arriveLabelIds!));
  });
});

describe("selecting and changing many cards", () => {
  it("selects without duplicates and clears", () => {
    st().selectCards(["a", "b"]);
    st().selectCards(["b", "c"]);
    expect(st().selected).toEqual(["a", "b", "c"]);
    st().toggleSelected("b");
    expect(st().selected).toEqual(["a", "c"]);
    st().clearSelected();
    expect(st().selected).toEqual([]);
  });

  it("changes 300 cards in one go, and one Undo puts them all back", () => {
    const b = board();
    const ids = Array.from({ length: 300 }, (_, i) => st().createCard(b.todo, `Card ${i}`));
    // A moment later (as when you select them and pick a change), so making them is its own undo step.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 10_000);
    const before = st().data;
    const t = performance.now();
    for (const id of ids) st().updateCard(id, { priority: "urgent", progress: "waiting", labelIds: [b.red] });
    expect(performance.now() - t).toBeLessThan(2000);
    expect(ids.every((id) => card(id).priority === "urgent" && card(id).progress === "waiting")).toBe(true);
    // Changes made together merge into one undo step.
    st().undo();
    expect(ids.every((id) => card(id).priority === before.cards[id].priority && card(id).labelIds.length === 0)).toBe(true);
  });

  it("moves many cards between boards with their labels and the target's rules", () => {
    const a = board("From");
    const b = board("To");
    st().updateList(b.done, { arriveLabelIds: [b.blue] });
    const ids = Array.from({ length: 50 }, (_, i) => st().createCard(a.todo, `C${i}`, { labelIds: [a.red] }));
    for (const id of ids) st().moveCardToBoard(id, b.id, b.done);
    for (const id of ids) {
      expect(card(id).boardId).toBe(b.id);
      expect(card(id).listId).toBe(b.done);
      expect(card(id).progress).toBe("completed");
      expect(card(id).labelIds).toEqual([b.red, b.blue]);
    }
    // They land in order, one after another, not on top of each other.
    const orders = ids.map((id) => card(id).order);
    expect(new Set(orders).size).toBe(ids.length);
  });

  it("duplicates cards as new, separate cards", () => {
    const b = board();
    const c = st().createCard(b.todo, "Original", { checklist: [{ id: "i1", text: "Step", done: false }] });
    const copy = st().duplicateCard(c);
    expect(copy).not.toBe(c);
    expect(card(copy).title).toBe("Original (copy)");
    expect(card(copy).checklist[0].id).not.toBe("i1");
    st().updateCard(copy, { title: "Changed" });
    expect(card(c).title).toBe("Original");
  });
});
