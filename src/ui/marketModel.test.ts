import { describe, expect, it } from "vitest";
import { firstStall, generatedStallName, marketView, stallName } from "./marketModel";

const p = (techs: string[], active: string | null = null) => ({ techs, research: { active: active ? { techId: active, done: 0 } : null, queue: [] } });

describe("market view", () => {
  it("one stall open at first; the others shut by the techs that open them, in the tree's order", () => {
    const v = marketView(p(["trade"]), [], undefined, 1);
    expect(v.stalls.map((s) => s.state)).toEqual(["free", "locked", "locked"]);
    expect(v.stalls.map((s) => s.tech?.id ?? null)).toEqual([null, "fairs", "traderoutes"]);
    expect(v.limits).toBe(false);
    expect(firstStall(v)).toBe(0);
  });
  it("research opens stalls and limits; a stall under research is marked", () => {
    const v = marketView(p(["trade", "fairs", "stockkeeping"], "traderoutes"), [{ give: "stone", get: "tools" }], undefined, 1);
    expect(v.stalls.map((s) => s.state)).toEqual(["order", "free", "locked"]);
    expect(v.stalls[2].researching).toBe(true);
    expect(v.limits).toBe(true);
    expect(firstStall(v)).toBe(1);
  });
  it("yesterday's swaps go to their stalls and to the day volume used", () => {
    // two workers move 300 points; 25 t of stone at 6 points are 150 of them
    const v = marketView(p(["fairs"]), [{ give: "stone", get: "tools" }, { give: "logs", get: "food" }], [{ give: "stone", get: "tools", gave: 25, got: 2.8 }], 2);
    expect(v.volume).toBe(300);
    expect(v.stalls[0].swap?.gave).toBe(25);
    expect(v.stalls[1].swap).toBeNull();
    expect(v.used).toBeCloseTo(0.5);
  });
});

describe("stall names", () => {
  it("are generated per town, never twice in one market, and the player's name wins", () => {
    for (const seed of [0, 1, 1700000000000, 1712345678901]) {
      const names = [0, 1, 2].map((i) => generatedStallName(i, seed));
      expect(new Set(names).size).toBe(3);
      expect(generatedStallName(1, seed)).toBe(names[1]); // stable
    }
    expect([0, 1, 2, 3, 4].map((k) => generatedStallName(0, 1700000000000 + k * 86400000)).some((n) => n !== generatedStallName(0, 1700000000000))).toBe(true);
    expect(stallName(1, 5, ["", "  Угол "])).toBe("Угол");
    expect(stallName(0, 5, ["", "Угол"])).toBe(generatedStallName(0, 5));
  });
});
