import { describe, expect, it } from "vitest";
import { DAYS_PER_SEASON, START_MINUTE_OF_DAY } from "../sim/clock";
import { TREE_COLORS } from "../ui/palette";
import { crownAt } from "./treeLayer";
import { buildTree } from "./treeModels";
import { coniferShare, scatterTrees, TREE_KINDS, TREE_STRIDE, type ForestPoly } from "./treeScatter";

const square = (x0: number, y0: number, x1: number, y1: number): ForestPoly => ({ bbox: [x0, y0, x1, y1], rings: [[[x0, y0], [x1, y0], [x1, y1], [x0, y1]]] });
const base = { centre: [0, 0] as [number, number], radius: 400, spacing: 6, lat: 59, maxTrees: 1e6, blocked: () => false };

describe("scatterTrees", () => {
  it("puts trees only inside the forest, about one per cell", () => {
    const t = scatterTrees({ ...base, forests: [square(0, 0, 120, 120)] });
    const n = t.length / TREE_STRIDE;
    expect(n).toBeGreaterThan(0.8 * (120 * 120) / 36);
    expect(n).toBeLessThan(1.2 * (120 * 120) / 36);
    for (let k = 0; k < t.length; k += TREE_STRIDE) {
      expect(t[k]).toBeGreaterThanOrEqual(0);
      expect(t[k]).toBeLessThanOrEqual(120);
      expect([0, 1, 2]).toContain(t[k + 3]);
      expect(t[k + 2]).toBeGreaterThan(1);
    }
  });

  it("keeps every tree in place when ground nearby gets blocked", () => {
    const forests = [square(-200, -200, 200, 200)];
    const all = scatterTrees({ ...base, forests });
    const some = scatterTrees({ ...base, forests, blocked: (x) => x > 0 });
    const at = (t: Float32Array) => new Set(Array.from({ length: t.length / TREE_STRIDE }, (_, i) => `${t[i * TREE_STRIDE]},${t[i * TREE_STRIDE + 1]}`));
    const a = at(all), s = at(some);
    expect(s.size).toBeLessThan(a.size * 0.6);
    for (const k of s) expect(a.has(k)).toBe(true);
  });

  it("fells a share of the trees by their hash", () => {
    const forests = [square(-100, -100, 100, 100)];
    const n = scatterTrees({ ...base, forests }).length;
    const half = scatterTrees({ ...base, forests, blocked: (_x, _y, h) => h < 0.5 }).length;
    expect(half / n).toBeGreaterThan(0.4);
    expect(half / n).toBeLessThan(0.6);
  });

  it("thins down to the cap and leaves an empty disc outside the radius", () => {
    const forests = [square(-1000, -1000, 1000, 1000)];
    const t = scatterTrees({ ...base, forests, maxTrees: 2000 });
    expect(t.length / TREE_STRIDE).toBeGreaterThan(1600);
    expect(t.length / TREE_STRIDE).toBeLessThan(2400);
    for (let k = 0; k < t.length; k += TREE_STRIDE) expect(Math.hypot(t[k], t[k + 1])).toBeLessThanOrEqual(400);
  });

  it("grows more conifers to the north", () => {
    expect(coniferShare(64)).toBeGreaterThan(coniferShare(50));
    expect(coniferShare(30)).toBeGreaterThan(0);
  });
});

describe("trees", () => {
  it("builds each kind with crown and trunk vertices about one metre tall", () => {
    for (const kind of TREE_KINDS) {
      const t = buildTree(kind);
      const z = t.positions.filter((_, i) => i % 3 === 2);
      expect(Math.max(...z)).toBeCloseTo(1, 1);
      expect(Math.min(...z)).toBe(0);
      expect(t.crown.length).toBe(z.length);
      expect(t.crown).toContain(0);
      expect(t.crown).toContain(1);
      expect(Math.max(...t.indices)).toBeLessThan(z.length);
    }
  });

  it("turns deciduous crowns with the seasons", () => {
    const at = (season: number, day: number) => (season * DAYS_PER_SEASON + day) * 1440 + 12 * 60 - START_MINUTE_OF_DAY;
    expect(crownAt(at(0, 0)).bare).toBeGreaterThan(0.8); // early spring: still bare
    expect(crownAt(at(1, 3))).toMatchObject({ a: TREE_COLORS.summer, bare: 0 });
    expect(crownAt(at(2, 5)).a).toBe(TREE_COLORS.autumn);
    expect(crownAt(at(3, 4)).bare).toBe(1); // winter
  });
});
