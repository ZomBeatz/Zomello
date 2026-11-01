import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Card, Filter } from "./types";

// The store runs in the browser; give it the few browser pieces it touches when it loads.
const mem = new Map<string, string>();
Object.assign(globalThis, {
  window: Object.assign(globalThis, { addEventListener() {}, removeEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {} }) }),
  document: { addEventListener() {}, visibilityState: "visible", querySelector: () => null },
  localStorage: { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => mem.set(k, v), removeItem: (k: string) => mem.delete(k) },
  location: { hash: "", search: "", href: "http://localhost/" },
});

let useStore: typeof import("./store").useStore;
let utils: typeof import("./utils");
beforeAll(async () => {
  ({ useStore } = await import("./store"));
  utils = await import("./utils");
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
const items = (...texts: string[]) => texts.map((text, i) => ({ id: `i${i}-${Math.random()}`, text, done: false }));

beforeEach(() => {
  useStore.setState({ loaded: true, selected: [], toasts: [] });
});
afterEach(() => {
  vi.useRealTimers();
});

describe("more bucket rules", () => {
  it("gives arriving cards a due date only when they have none", () => {
    const b = board();
    st().updateList(b.doing, { arriveDueDays: 3 });
    const a = st().createCard(b.todo, "No date");
    const d = st().createCard(b.todo, "Has a date", { dueDate: "2030-01-01" });
    st().moveCardToList(a, b.doing);
    st().moveCardToList(d, b.doing);
    expect(card(a).dueDate).toBe(utils.toISO(new Date(Date.now() + 3 * 86_400_000)));
    expect(card(d).dueDate).toBe("2030-01-01");
  });

  it("assigns people and adds to My Day, for cards moved or made there", () => {
    const b = board();
    st().updateList(b.doing, { arriveAssignees: ["Pat", "Sam"], arriveMyDay: true });
    const moved = st().createCard(b.todo, "Moved", { assignees: ["Sam"] });
    st().moveCardToList(moved, b.doing);
    expect(card(moved).assignees).toEqual(["Sam", "Pat"]);
    expect(card(moved).myDay).toBe(utils.todayISO());
    const made = st().createCard(b.doing, "Made");
    expect(card(made).assignees).toEqual(["Pat", "Sam"]);
  });

  it("starts new cards from the bucket's template, keeping the typed title", () => {
    const b = board();
    const src = st().createCard(b.todo, "Bug report", { description: "Steps:", checklist: items("Reproduce", "Fix"), labelIds: [b.red] });
    st().saveTemplate(src, "Bug");
    const t = st().data.templates.find((x) => x.name === "Bug")!;
    st().updateList(b.doing, { newTemplateId: t.id, newPriority: "urgent" });
    const c = st().createCard(b.doing, "Login fails");
    expect(card(c).title).toBe("Login fails");
    expect(card(c).description).toBe("Steps:");
    expect(card(c).checklist.map((i) => i.text)).toEqual(["Reproduce", "Fix"]);
    expect(card(c).labelIds).toEqual([b.red]);
    expect(card(c).priority).toBe("urgent");
    // "New from template" in that bucket isn't doubled up.
    const fromT = st().createFromTemplate(t.id, b.doing);
    expect(card(fromT).checklist).toHaveLength(2);
  });

  it("completes and moves a card when its last checklist item is ticked", () => {
    const b = board();
    st().updateList(b.doing, { checkedComplete: true, checkedMoveTo: b.done });
    const c = st().createCard(b.doing, "Card", { checklist: items("One", "Two") });
    st().toggleChecklistItem(c, card(c).checklist[0].id);
    expect(card(c).listId).toBe(b.doing);
    st().toggleChecklistItem(c, card(c).checklist[1].id);
    expect(card(c).listId).toBe(b.done);
    expect(card(c).progress).toBe("completed");
  });

  it("runs the checklist rule on a parent when its last sub-task is completed", () => {
    const b = board();
    st().updateList(b.todo, { checkedMoveTo: b.done });
    const parent = st().createCard(b.todo, "Parent");
    const child = st().createCard(b.doing, "Child");
    st().addToParent(parent, child);
    st().updateCard(child, { progress: "completed" });
    expect(card(parent).listId).toBe(b.done);
    // The Done bucket completes cards that arrive.
    expect(card(parent).progress).toBe("completed");
  });

  it("archives cards completed long enough ago, and only those", () => {
    const b = board();
    st().updateList(b.done, { archiveAfterDays: 7 });
    const old = st().createCard(b.done, "Old");
    const fresh = st().createCard(b.done, "Fresh");
    const open = st().createCard(b.done, "Reopened", { progress: "inProgress" });
    useStore.setState((s) => ({ data: { ...s.data, cards: { ...s.data.cards, [old]: { ...s.data.cards[old], completedAt: Date.now() - 8 * 86_400_000 } } } }));
    expect(st().sweepRules()).toBe(1);
    expect(card(old).archived).toBe(true);
    expect(card(fresh).archived).toBe(false);
    expect(card(open).archived).toBe(false);
  });

  it("points a board copy's 'move it to' rule at the copied bucket", () => {
    const b = board();
    st().updateList(b.doing, { checkedMoveTo: b.done });
    const copy = st().duplicateBoard(b.id);
    const lists = Object.values(st().data.lists).filter((l) => l.boardId === copy).sort((x, y) => x.order - y.order);
    expect(lists[1].checkedMoveTo).toBe(lists[2].id);
  });
});

describe("late cards, cards already here, and rule history", () => {
  const yesterday = () => utils.toISO(new Date(Date.now() - 86_400_000));

  it("moves late cards and raises their priority, leaving finished ones alone", () => {
    const b = board();
    st().updateList(b.todo, { lateMoveTo: b.doing, latePriority: "urgent" });
    const late = st().createCard(b.todo, "Late", { dueDate: yesterday() });
    const done = st().createCard(b.todo, "Done late", { dueDate: yesterday(), progress: "completed" });
    const fine = st().createCard(b.todo, "Not due", { dueDate: "2099-01-01" });
    expect(st().sweepRules()).toBe(1);
    expect(card(late).listId).toBe(b.doing);
    expect(card(late).priority).toBe("urgent");
    // The bucket it lands in has its own rules too (In progress).
    expect(card(late).progress).toBe("inProgress");
    expect(card(done).listId).toBe(b.todo);
    expect(card(fine).listId).toBe(b.todo);
  });

  it("says in the card's history which bucket's rule changed it", () => {
    const b = board();
    st().updateList(b.doing, { arriveAssignees: ["Pat"] });
    const c = st().createCard(b.todo, "Card");
    st().moveCardToList(c, b.doing);
    const act = card(c).activity;
    expect(act.find((a) => a.kind === "moved")?.rule).toBeUndefined();
    expect(act.find((a) => a.kind === "assigned")?.rule).toBe(b.doing);
    expect(act.find((a) => a.kind === "progress")?.rule).toBe(b.doing);
    // A change you make yourself afterwards isn't tagged.
    st().updateCard(c, { priority: "urgent" });
    expect(card(c).activity.find((a) => a.kind === "priority")?.rule).toBeUndefined();
  });

  it("applies a bucket's rules to the cards already in it", () => {
    const b = board();
    const a = st().createCard(b.doing, "A", { progress: "notStarted" });
    const finished = st().createCard(b.doing, "Finished", { progress: "completed" });
    const skip = st().createCard(b.doing, "Skip", { skipRules: true });
    st().updateList(b.doing, { arriveAssignees: ["Sam"], checkedMoveTo: b.done });
    const ticked = st().createCard(b.todo, "Ticked", { checklist: [{ id: "x", text: "x", done: true }] });
    st().moveCardToList(ticked, b.doing);
    expect(st().applyBucketRules(b.doing)).toBe(3);
    expect(card(a).assignees).toEqual(["Sam"]);
    expect(card(a).progress).toBe("inProgress");
    // Not reopened by "Set progress: In progress".
    expect(card(finished).progress).toBe("completed");
    expect(card(skip).assignees).toEqual([]);
    expect(card(ticked).listId).toBe(b.done);
  });
});

describe("the Undead Easter egg", () => {
  it("knows its braaains", async () => {
    const { isBraaains } = await import("./undead");
    for (const t of ["Braaains", "braaaaaaains!", " BRAAAINS ", "Braaain"]) expect(isBraaains(t)).toBe(true);
    for (const t of ["Brains", "Braaains for dinner", "Rain"]) expect(isBraaains(t)).toBe(false);
  });
});

describe("skip bucket rules", () => {
  it("leaves a card alone when it moves, and when its checklist is all ticked", () => {
    const b = board();
    st().updateList(b.doing, { arriveAssignees: ["Pat"], arriveLabelIds: [b.red], checkedMoveTo: b.done });
    const c = st().createCard(b.todo, "Reference", { skipRules: true, checklist: items("Only") });
    st().moveCardToList(c, b.doing);
    expect(card(c).progress).toBe("notStarted");
    expect(card(c).assignees).toEqual([]);
    expect(card(c).labelIds).toEqual([]);
    st().toggleChecklistItem(c, card(c).checklist[0].id);
    expect(card(c).listId).toBe(b.doing);
    st().moveCardToList(c, b.done);
    expect(card(c).progress).toBe("notStarted");
  });

  it("keeps a completed card out of Tidy up, and stays completed when dragged out of Done", () => {
    const b = board();
    st().updateList(b.done, { archiveAfterDays: 1 });
    const c = st().createCard(b.done, "Brand colors", { skipRules: true, progress: "completed" });
    useStore.setState((s) => ({ data: { ...s.data, cards: { ...s.data.cards, [c]: { ...s.data.cards[c], completedAt: Date.now() - 5 * 86_400_000 } } } }));
    expect(st().sweepRules()).toBe(0);
    st().moveCardToList(c, b.todo);
    expect(card(c).progress).toBe("completed");
  });
});

describe("blocked cards", () => {
  it("says which card is no longer blocked when its blocker is completed", () => {
    const b = board();
    const blocker = st().createCard(b.todo, "Design");
    const waiting = st().createCard(b.todo, "Build");
    st().linkCards(blocker, waiting, "blocks");
    expect(utils.isBlocked(card(waiting), st().data.cards)).toBe(true);
    st().updateCard(blocker, { progress: "completed" });
    expect(utils.isBlocked(card(waiting), st().data.cards)).toBe(false);
    expect(st().toasts.map((t) => t.text)).toContain("No longer blocked: Build");
  });

  it("stays quiet while another blocker is still open", () => {
    const b = board();
    const a = st().createCard(b.todo, "A");
    const c = st().createCard(b.todo, "C");
    const waiting = st().createCard(b.todo, "Waiting");
    st().linkCards(a, waiting, "blocks");
    st().linkCards(c, waiting, "blocks");
    st().updateCard(a, { progress: "completed" });
    expect(st().toasts.some((t) => t.text.includes("no longer blocked") || t.text.includes("No longer blocked"))).toBe(false);
  });
});

describe("filters", () => {
  const base = (over: Partial<Card> = {}): Card =>
    ({ id: "x", labelIds: [], fields: {}, links: [], progress: "notStarted", priority: "medium", assignees: [], dueDate: null, title: "", description: "", checklist: [], comments: [], attachments: [], ...over }) as unknown as Card;
  const f = (over: Partial<Filter>): Filter => ({ ...utils.emptyFilter(), ...over });

  it("matches blocked and not-blocked cards", () => {
    const blocker = base({ id: "b" });
    const waiting = base({ id: "w", links: [{ cardId: "b", type: "blockedBy" }] });
    const cards = { b: blocker, w: waiting };
    expect(utils.matchesFilter(waiting, f({ blocked: "blocked" }), cards)).toBe(true);
    expect(utils.matchesFilter(blocker, f({ blocked: "blocked" }), cards)).toBe(false);
    expect(utils.matchesFilter(blocker, f({ blocked: "notBlocked" }), cards)).toBe(true);
    cards.b = { ...blocker, progress: "completed" };
    expect(utils.matchesFilter(waiting, f({ blocked: "blocked" }), cards)).toBe(false);
  });

  it("handles 'No labels' next to label choices, and hides 'Not' labels", () => {
    const none = base();
    const red = base({ labelIds: ["red"] });
    const blue = base({ labelIds: ["blue"] });
    expect(utils.matchesFilter(none, f({ noLabels: true }))).toBe(true);
    expect(utils.matchesFilter(red, f({ noLabels: true }))).toBe(false);
    expect(utils.matchesFilter(red, f({ noLabels: true, labelIds: ["red"] }))).toBe(true);
    expect(utils.matchesFilter(red, f({ notLabelIds: ["red"] }))).toBe(false);
    expect(utils.matchesFilter(blue, f({ notLabelIds: ["red"] }))).toBe(true);
    expect(utils.filterChoiceCount(f({ noLabels: true, notLabelIds: ["red"] }))).toBe(2);
  });

  it("matches custom field values", () => {
    const c = base({ fields: { size: "big", ok: true, note: "" } });
    expect(utils.matchesFilter(c, f({ fields: { size: ["big", "small"] } }))).toBe(true);
    expect(utils.matchesFilter(c, f({ fields: { size: ["small"] } }))).toBe(false);
    expect(utils.matchesFilter(c, f({ fields: { ok: ["yes"] } }))).toBe(true);
    expect(utils.matchesFilter(c, f({ fields: { ok: ["no"] } }))).toBe(false);
    expect(utils.matchesFilter(c, f({ fields: { note: ["empty"] } }))).toBe(true);
    expect(utils.matchesFilter(c, f({ fields: { note: ["set"] } }))).toBe(false);
    expect(utils.matchesFilter(c, f({ fields: { missing: ["set"] } }))).toBe(false);
  });

  it("treats saved filters from before 0.6.0 (without the new choices) as before", () => {
    const old = { text: "", labelIds: ["red"], priorities: [], progress: [], assignees: [], due: "any", relatedTo: null, relatedDeep: false } as Filter;
    expect(utils.matchesFilter(base({ labelIds: ["red"] }), old)).toBe(true);
    expect(utils.filterChoiceCount(old)).toBe(1);
  });
});
