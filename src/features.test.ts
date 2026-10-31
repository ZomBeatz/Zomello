import { beforeAll, describe, expect, it } from "vitest";
import type { Card } from "./types";

// features.ts reads the store, which loads browser pieces; give it the few it touches.
Object.assign(globalThis, {
  window: Object.assign(globalThis, { addEventListener() {}, removeEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {} }) }),
  document: { addEventListener() {}, visibilityState: "visible", querySelector: () => null },
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  location: { hash: "", search: "", href: "http://localhost/" },
});

let F: typeof import("./features");
beforeAll(async () => {
  F = await import("./features");
});

const card = (extra: Partial<Card> = {}) =>
  ({ startDate: null, recurrence: null, links: [], time: [], estimate: null, fields: {}, cover: null, ...extra }) as unknown as Card;

describe("feature groups", () => {
  it("keeps everything on for people who never chose", () => {
    for (const f of F.FEATURES) expect(F.featureOn({}, f.id)).toBe(true);
    expect(F.currentPreset({})).toBe("everything");
  });

  it("recognises each preset, and a mix as none of them", () => {
    for (const p of ["simple", "standard", "everything"] as const) expect(F.currentPreset({ features: F.presetFeatures(p) })).toBe(p);
    expect(F.currentPreset({ features: { ...F.presetFeatures("simple"), time: true } })).toBeNull();
  });

  it("Simple turns every group off", () => {
    const s = { features: F.presetFeatures("simple") };
    for (const f of F.FEATURES) expect(F.featureOn(s, f.id)).toBe(false);
  });

  it("always offers Board and Calendar, and the other views only with More views", () => {
    const simple = { features: F.presetFeatures("simple") };
    expect(F.viewShown(simple, "board")).toBe(true);
    expect(F.viewShown(simple, "calendar")).toBe(true);
    expect(F.viewShown(simple, "charts")).toBe(false);
    expect(F.viewShown({}, "charts")).toBe(true);
  });

  it("hides card parts of groups that are off, unless the card already uses them", () => {
    const simple = { features: F.presetFeatures("simple") };
    expect(F.sectionShown(simple, card(), "time")).toBe(false);
    expect(F.sectionShown(simple, card({ estimate: 30 }), "time")).toBe(true);
    expect(F.sectionShown(simple, card(), "startDate")).toBe(false);
    expect(F.sectionShown(simple, card({ startDate: "2026-11-02" }), "startDate")).toBe(true);
    expect(F.sectionShown(simple, card({ fields: { f1: "" } }), "fields")).toBe(false);
    expect(F.sectionShown(simple, card({ fields: { f1: 3 } }), "fields")).toBe(true);
    // Parts that belong to no group are always there.
    expect(F.sectionShown(simple, card(), "checklist")).toBe(true);
    expect(F.sectionShown(simple, card(), "dueDate")).toBe(true);
    expect(F.sectionShown(simple, card(), "reminder")).toBe(true);
  });
});
