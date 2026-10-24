import { describe, expect, it } from "vitest";
import type { Land } from "./landcover";
import { sampleSite, sharesOf, sitePoints } from "./site";

describe("site shares", () => {
  it("counts forest, water and rock+sand", () => {
    const lands: Land[] = ["forest", "forest", "water", "rock", "sand", "meadow", "meadow", "meadow", "meadow", "wetland"];
    const s = sharesOf(lands);
    expect(s.forest).toBeCloseTo(0.2);
    expect(s.water).toBeCloseTo(0.1);
    expect(s.rock).toBeCloseTo(0.2);
  });

  it("is zero without samples", () => {
    expect(sharesOf([])).toEqual({ forest: 0, water: 0, rock: 0 });
  });

  it("keeps sample points inside the radius", () => {
    const pts = sitePoints(10, 20, 100, 25);
    expect(pts.length).toBeGreaterThan(30);
    expect(pts.every(([x, y]) => Math.hypot(x - 10, y - 20) <= 100 + 1e-9)).toBe(true);
    expect(sitePoints(0, 0, 5, 25)).toEqual([[0, 0]]);
  });

  it("samples a stubbed world: forest in the east half only", async () => {
    const site = await sampleSite(0, 0, 100, async (x) => (x > 0 ? "forest" : "meadow"), 20);
    // the x = 0 column is meadow, so slightly under one half
    expect(site.forest).toBeGreaterThan(0.4);
    expect(site.forest).toBeLessThan(0.5);
    expect(site.water).toBe(0);
    expect(site.rock).toBe(0);
  });
});
