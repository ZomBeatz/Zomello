import type { AppData, Board, BucketAccess, Card, ID } from "./types";
import { priorityMeta, priorityRank } from "./utils";

/**
 * Auto-assign (a bucket rule): a card that lands in such a bucket with no one on it goes to the person
 * with the most room. Priority decides the order (most important first); effort decides how much room a
 * card takes. Only people with a capacity on the board (Customize > Auto-assign) are picked, and only
 * where they may work (People on this board). When nobody has room, the card waits in a queue and is
 * handed out as soon as someone does. Runs where the data lives (src/components/AutoAssign.tsx).
 */

/** A card's effort in points; none counts as 1. */
export const effortOf = (c: Pick<Card, "effort">): number => (c.effort && c.effort > 0 ? c.effort : 1);

export const EFFORTS = [1, 2, 3, 5, 8];

const ORDER: BucketAccess[] = ["hidden", "see", "work", "lead"];

/** A bucket as `person` may use it on this board (people without a phone of their own can do anything). */
export function bucketAccess(board: Board, person: string, listId: ID): BucketAccess {
  const level = board.share?.[person];
  if (!level || level === "edit") return "lead";
  if (level !== "custom") return "see";
  const r = board.shareRules?.[person];
  return r?.buckets?.[listId] ?? r?.otherBuckets ?? "see";
}

/** `person` could look after a card in this bucket once it's theirs. */
export function canTake(board: Board, person: string, listId: ID): boolean {
  const level = board.share?.[person];
  if (level === "view") return false;
  const access = ORDER.indexOf(bucketAccess(board, person, listId));
  if (level !== "custom") return access >= ORDER.indexOf("see");
  const status = board.shareRules?.[person]?.status ?? "none";
  return access >= ORDER.indexOf("work") || (access >= ORDER.indexOf("see") && status !== "none");
}

const open = (data: AppData, c: Card) =>
  !c.archived && c.progress !== "completed" && !!data.lists[c.listId] && !data.lists[c.listId].archived;

/** Points each person has on a board now (their unfinished cards). */
export function loads(data: AppData, boardId: ID): Map<string, { points: number; cards: number }> {
  const out = new Map<string, { points: number; cards: number }>();
  for (const c of Object.values(data.cards)) {
    if (c.boardId !== boardId || !open(data, c)) continue;
    for (const p of c.assignees) {
      const l = out.get(p) ?? { points: 0, cards: 0 };
      l.points += effortOf(c);
      l.cards++;
      out.set(p, l);
    }
  }
  return out;
}

/** Cards waiting for someone on a board, in the order they're handed out. */
export function waitingCards(data: AppData, board: Board): Card[] {
  return Object.values(data.cards)
    .filter((c) => c.boardId === board.id && open(data, c) && c.assignees.length === 0 && data.lists[c.listId]?.autoAssign)
    .sort((a, b) => priorityRank(a.priority, board) - priorityRank(b.priority, board) || a.createdAt - b.createdAt);
}

export interface Plan {
  /** Who gets which card now. */
  give: { cardId: ID; person: string }[];
  /** Cards still waiting, with their place in the queue (1 = next). */
  waiting: Map<ID, number>;
}

/** What Auto-assign would do on a board right now. */
export function plan(data: AppData, board: Board): Plan {
  const give: Plan["give"] = [];
  const waiting = new Map<ID, number>();
  const people = Object.entries(board.capacity ?? {}).filter(([, c]) => c.points > 0);
  if (!people.length) {
    waitingCards(data, board).forEach((c, i) => waiting.set(c.id, i + 1));
    return { give, waiting };
  }
  const load = loads(data, board.id);
  for (const c of waitingCards(data, board)) {
    const e = effortOf(c);
    const over = !!priorityMeta(c.priority, board).overCapacity;
    let best: { person: string; fill: number; cards: number } | null = null;
    for (const [person, cap] of people) {
      if (!canTake(board, person, c.listId) || (cap.maxCard && e > cap.maxCard)) continue;
      const l = load.get(person) ?? { points: 0, cards: 0 };
      if (!over && l.points + e > cap.points) continue;
      const fill = (l.points + e) / cap.points;
      // Least full afterwards; then fewer cards; then by name, so it's predictable.
      if (!best || fill < best.fill - 1e-9 || (Math.abs(fill - best.fill) < 1e-9 && (l.cards < best.cards || (l.cards === best.cards && person < best.person))))
        best = { person, fill, cards: l.cards };
    }
    if (!best) {
      waiting.set(c.id, waiting.size + 1);
      continue;
    }
    give.push({ cardId: c.id, person: best.person });
    const l = load.get(best.person) ?? { points: 0, cards: 0 };
    load.set(best.person, { points: l.points + e, cards: l.cards + 1 });
  }
  return { give, waiting };
}

const waitCache = new WeakMap<AppData, Map<ID, Map<ID, number>>>();

/** A card's place in its board's queue (1 = next), or 0 when it isn't waiting. Cached per data version. */
export function queuePlace(data: AppData, card: Card): number {
  let byBoard = waitCache.get(data);
  if (!byBoard) waitCache.set(data, (byBoard = new Map()));
  let w = byBoard.get(card.boardId);
  if (!w) {
    const board = data.boards[card.boardId];
    w = board ? plan(data, board).waiting : new Map();
    byBoard.set(card.boardId, w);
  }
  return w.get(card.id) ?? 0;
}
