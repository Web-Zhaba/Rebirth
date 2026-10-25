import { describe, expect, it } from "vitest";
import { NAME_CHOICES, SETTLEMENT_NAMES, siteNotes, suggestNames } from "./foundModel";

describe("suggestNames", () => {
  it("is deterministic and distinct", () => {
    const a = suggestNames(56.3, 44.0);
    expect(a).toEqual(suggestNames(56.3, 44.0));
    expect(a).toHaveLength(NAME_CHOICES);
    expect(new Set(a).size).toBe(NAME_CHOICES);
    for (const n of a) expect(SETTLEMENT_NAMES).toContain(n);
  });
  it("offers neutral descriptive names", () => {
    expect(SETTLEMENT_NAMES).toContain("Речной");
    for (const old of ["Заречье", "Починок", "Выселки", "Слобода"]) expect(SETTLEMENT_NAMES).not.toContain(old);
  });
  it("varies with the place", () => {
    const sets = new Set([suggestNames(56.3, 44.0)[0], suggestNames(55.1, 37.2)[0], suggestNames(59.9, 30.3)[0], suggestNames(51.5, 46.0)[0]]);
    expect(sets.size).toBeGreaterThan(1);
  });
});

describe("siteNotes", () => {
  it("is empty for a plain place", () => {
    expect(siteNotes({ forest: 0.3, water: 0, rock: 0 }, 2, false)).toEqual([]);
  });
  it("flags river, steep slope and forest", () => {
    expect(siteNotes({ forest: 0.7, water: 0, rock: 0 }, 12, true)).toHaveLength(3);
  });
});
