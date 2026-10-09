import { create } from "zustand";
import type { Card, ID } from "./types";
import { parentIndex, subtaskIds } from "./utils";

/** How another card relates to the hovered one (drives the outline color on the board). */
export type LinkRole = "parent" | "child" | "blocker" | "blocked" | "related";

export const useLinkHover = create<{ source: ID | null; roles: Record<ID, LinkRole> }>(() => ({ source: null, roles: {} }));

export function hoverLinks(card: Card, cards: Record<ID, Card>) {
  const roles: Record<ID, LinkRole> = {};
  for (const p of parentIndex(cards).get(card.id) ?? []) roles[p.id] = "parent";
  for (const id of subtaskIds(card)) roles[id] = "child";
  for (const l of card.links)
    roles[l.cardId] ??= l.type === "blocks" ? "blocked" : l.type === "blockedBy" ? "blocker" : "related";
  useLinkHover.setState(Object.keys(roles).length ? { source: card.id, roles } : { source: null, roles: {} });
}

export function clearHoverLinks(id: ID) {
  if (useLinkHover.getState().source === id) useLinkHover.setState({ source: null, roles: {} });
}
