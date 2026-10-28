import { describe, expect, it } from "vitest";
import { cooking, heating, smokeKindOf, smokeStrength } from "./smokeMath";

describe("smokeKindOf", () => {
  it("smokes only buildings in use", () => {
    expect(smokeKindOf({ kind: "izba", style: "town" })).toBeNull(); // empty
    expect(smokeKindOf({ kind: "izba", style: "town", lamp: "house" })).toBe("home");
    expect(smokeKindOf({ kind: "house", style: "heritage", lamp: "work" })).toBe("home"); // a restored one that is operated
    expect(smokeKindOf({ kind: "house", style: "heritage" })).toBeNull();
    expect(smokeKindOf({ kind: "dirt", style: "road", lamp: "work" })).toBeNull();
  });
  it("tells furnaces and taverns", () => {
    expect(smokeKindOf({ kind: "smithy", style: "town", lamp: "work" })).toBe("furnace");
    expect(smokeKindOf({ kind: "pottery", style: "town", lamp: "work" })).toBe("furnace");
    expect(smokeKindOf({ kind: "smithy", style: "town" })).toBeNull(); // nobody works there
    expect(smokeKindOf({ kind: "carpentry", style: "town", lamp: "work" })).toBe("home");
    expect(smokeKindOf({ kind: "tavern", style: "town", lamp: "tavern" })).toBe("tavern");
  });
});

describe("smokeStrength", () => {
  it("heats with the cold and not in the warm", () => {
    expect(heating(-10)).toBe(1);
    expect(heating(5)).toBe(1);
    expect(heating(18)).toBe(0);
    expect(heating(30)).toBe(0);
    expect(smokeStrength("home", -5, 14)).toBeGreaterThan(0.9);
    expect(smokeStrength("home", 24, 14)).toBe(0);
    expect(smokeStrength("home", 10, 14)).toBeGreaterThan(0);
    expect(smokeStrength("home", 10, 14)).toBeLessThan(smokeStrength("home", 0, 14));
  });
  it("cooks in the morning and the evening whatever the weather", () => {
    expect(cooking(7.5)).toBeGreaterThan(0.4);
    expect(cooking(19)).toBeGreaterThan(0.4);
    expect(cooking(13)).toBe(0);
    expect(smokeStrength("home", 24, 7.5)).toBeGreaterThan(0.3);
    expect(smokeStrength("home", 24, 19)).toBeGreaterThan(0.3);
    expect(smokeStrength("home", 24, 13)).toBe(0);
    expect(smokeStrength("home", 24, 3)).toBe(0);
  });
  it("banks the fires at night", () => {
    expect(smokeStrength("home", -5, 2)).toBeLessThan(smokeStrength("home", -5, 14));
    expect(smokeStrength("home", -5, 2)).toBeGreaterThan(0.4);
  });
  it("keeps a furnace going through the working day at any temperature", () => {
    expect(smokeStrength("furnace", 28, 12)).toBeGreaterThan(0.8);
    expect(smokeStrength("furnace", 28, 3)).toBe(0);
    expect(smokeStrength("furnace", 28, 22)).toBe(0);
    expect(smokeStrength("furnace", -10, 12)).toBeGreaterThan(0.8);
  });
  it("lets a tavern smoke in the evening", () => {
    expect(smokeStrength("tavern", 24, 20)).toBeGreaterThan(smokeStrength("home", 24, 20));
    expect(smokeStrength("tavern", 24, 12)).toBe(0);
  });
  it("dims in rain and stays in 0..1", () => {
    expect(smokeStrength("home", -5, 14, 3)).toBeLessThan(smokeStrength("home", -5, 14, 0));
    expect(smokeStrength("home", -5, 14, 3)).toBeGreaterThan(0.5);
    for (const kind of ["home", "furnace", "tavern"] as const)
      for (let h = 0; h < 24; h += 0.5)
        for (const t of [-30, 0, 10, 20, 40]) {
          const s = smokeStrength(kind, t, h, 1);
          expect(s).toBeGreaterThanOrEqual(0);
          expect(s).toBeLessThanOrEqual(1);
        }
  });
});
