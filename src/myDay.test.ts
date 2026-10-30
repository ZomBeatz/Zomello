import { describe, expect, it } from "vitest";
import { myDayLists } from "./myDay";
import { boardAsTemplate } from "./boardTemplates";
import type { AppData, Card } from "./types";

// Thursday, October 29, 2026, 10:00 in the morning.
const now = new Date(2026, 9, 29, 10, 0);

const card = (id: string, extra: Partial<Card> = {}): Card =>
  ({ id, boardId: "b", listId: "l", title: id, description: "", order: 0, labelIds: [], checklist: [], assignees: [], priority: "medium", progress: "notStarted", archived: false, ...extra }) as Card;

const data = (cards: Card[]) =>
  ({
    boards: { b: { id: "b", title: "Home", description: "Our house\nmore", color: "#22c55e", icon: "🏠", labels: [{ id: "x", name: "Weekly", color: "#0ea5e9" }], archived: false } },
    lists: { l: { id: "l", boardId: "b", title: "To do", order: 0, archived: false } },
    cards: Object.fromEntries(cards.map((c) => [c.id, c])),
    settings: { me: "" },
  }) as unknown as AppData;

describe("My Day leftovers", () => {
  it("offers unfinished tasks added in the last week", () => {
    const d = data([
      card("yesterday", { myDay: "2026-10-28" }),
      card("monday", { myDay: "2026-10-26" }),
      card("old", { myDay: "2026-10-01" }),
      card("today", { myDay: "2026-10-29" }),
      card("finished", { myDay: "2026-10-28", progress: "completed" }),
      card("late", { myDay: "2026-10-28", dueDate: "2026-10-27" }),
    ]);
    const { leftovers, added, late } = myDayLists(d, now);
    expect(leftovers.map((c) => c.id)).toEqual(["yesterday", "monday"]);
    expect(added.map((c) => c.id)).toEqual(["today"]);
    expect(late.map((c) => c.id)).toEqual(["late"]);
  });
});

describe("boardAsTemplate", () => {
  it("keeps buckets, labels and open cards, without dates or people", () => {
    const d = data([
      card("Laundry", { labelIds: ["x"], dueDate: "2026-11-01", assignees: ["Sam"], checklist: [{ id: "i", text: "Whites", done: true }] }),
      card("Done one", { progress: "completed" }),
    ]);
    const t = boardAsTemplate(d, "b", "Chores");
    expect(t).toMatchObject({ name: "Chores", icon: "🏠", about: "Our house", labels: [{ name: "Weekly", color: "#0ea5e9" }] });
    expect(t.lists).toEqual([{ name: "To do", cards: [{ title: "Laundry", labels: ["Weekly"], checklist: ["Whites"] }] }]);
  });
});
