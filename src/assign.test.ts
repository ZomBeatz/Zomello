import { describe, expect, it } from "vitest";
import { plan, queuePlace } from "./assign";
import type { AppData, Board, Card, List } from "./types";

const board = (extra: Partial<Board> = {}) =>
  ({ id: "b", title: "Home", labels: [], capacity: { Sam: { points: 5 }, Kim: { points: 5, maxCard: 2 } }, ...extra }) as unknown as Board;
const list = (id: string, autoAssign = true) => ({ id, boardId: "b", title: id, autoAssign }) as unknown as List;
let t = 0;
const card = (id: string, extra: Partial<Card> = {}) =>
  ({ id, boardId: "b", listId: "jobs", title: id, assignees: [], priority: "medium", progress: "notStarted", createdAt: ++t, ...extra }) as unknown as Card;
const data = (b: Board, cards: Card[], lists = [list("jobs"), list("other", false)]) =>
  ({ boards: { b }, lists: Object.fromEntries(lists.map((l) => [l.id, l])), cards: Object.fromEntries(cards.map((c) => [c.id, c])) }) as unknown as AppData;

describe("auto-assign", () => {
  it("gives each card to whoever is least full afterwards, and respects the largest card someone takes", () => {
    const d = data(board(), [card("big", { effort: 3 }), card("a", { effort: 1 }), card("b", { effort: 1 })]);
    const p = plan(d, d.boards.b);
    expect(p.give).toEqual([
      { cardId: "big", person: "Sam" }, // too big for Kim
      { cardId: "a", person: "Kim" },
      { cardId: "b", person: "Kim" },
    ]);
  });

  it("hands out the most important first, and queues what doesn't fit", () => {
    const d = data(board({ capacity: { Sam: { points: 3 } } }), [
      card("later", { effort: 2 }),
      card("now", { effort: 2, priority: "urgent" }),
      card("small", { effort: 1 }),
    ]);
    const p = plan(d, d.boards.b);
    expect(p.give).toEqual([{ cardId: "now", person: "Sam" }, { cardId: "small", person: "Sam" }]);
    expect([...p.waiting]).toEqual([["later", 1]]);
    expect(queuePlace(d, d.cards.later)).toBe(1);
  });

  it("counts what people already have, skips buckets without the rule, and lets an emergency go over", () => {
    const b = board({
      capacity: { Sam: { points: 2 } },
      priorities: [{ id: "fire", name: "Fire", color: "#f00", overCapacity: true }, { id: "medium", name: "Medium", color: "#00f" }],
    });
    const d = data(b, [
      card("held", { effort: 2, assignees: ["Sam"], listId: "other" }),
      card("normal"),
      card("fire", { priority: "fire" }),
      card("elsewhere", { listId: "other" }),
    ]);
    const p = plan(d, b);
    expect(p.give).toEqual([{ cardId: "fire", person: "Sam" }]);
    expect([...p.waiting.keys()]).toEqual(["normal"]);
  });

  it("only picks people who may work in that bucket", () => {
    const b = board({
      capacity: { Sam: { points: 9 }, Kim: { points: 9 } },
      share: { Sam: "view", Kim: "custom" },
      shareRules: { Kim: { buckets: { jobs: "work" } } },
    });
    const d = data(b, [card("x")]);
    expect(plan(d, b).give).toEqual([{ cardId: "x", person: "Kim" }]);
  });
});
