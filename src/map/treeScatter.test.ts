import { describe, expect, it } from "vitest";
import { DAYS_PER_SEASON, START_MINUTE_OF_DAY } from "../sim/clock";
import { TREE_COLORS } from "../ui/palette";
import { buildTree, crownAt, KIND_INFO, reedAt } from "./treeModels";
import { impostorRadius } from "./treeImpostor";
import { coniferShare, keepAt, MIN_KEEP, scatterDetails, scatterTrees, thinReach, TREE_KINDS, TREE_STRIDE, type DetailPoly, type ForestPoly } from "./treeScatter";

const square = (x0: number, y0: number, x1: number, y1: number): ForestPoly => ({ bbox: [x0, y0, x1, y1], rings: [[[x0, y0], [x1, y0], [x1, y1], [x0, y1]]] });
const base = { rect: [-400, -400, 400, 400] as [number, number, number, number], spacing: 6, lat: 59, blocked: () => false };
const places = (t: Float32Array) => new Set(Array.from({ length: t.length / TREE_STRIDE }, (_, i) => `${t[i * TREE_STRIDE]},${t[i * TREE_STRIDE + 1]}`));

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

  it("tiles the plane: chunks side by side hold exactly the trees of their union, once each", () => {
    const forests = [square(-300, -300, 300, 300)];
    const whole = scatterTrees({ ...base, forests, rect: [-200, -200, 200, 200] });
    const parts = [[-200, -200, 0, 0], [0, -200, 200, 0], [-200, 0, 0, 200], [0, 0, 200, 200]].map((rect) => scatterTrees({ ...base, forests, rect: rect as [number, number, number, number] }));
    const joined = parts.flatMap((t) => [...places(t)]);
    expect(joined.length).toBe(whole.length / TREE_STRIDE);
    expect(new Set(joined)).toEqual(places(whole));
  });

  it("keeps every tree in place when ground nearby gets blocked", () => {
    const forests = [square(-200, -200, 200, 200)];
    const a = places(scatterTrees({ ...base, forests }));
    const s = places(scatterTrees({ ...base, forests, blocked: (x) => x > 0 }));
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

  it("grows more conifers to the north", () => {
    expect(coniferShare(64)).toBeGreaterThan(coniferShare(50));
    expect(coniferShare(30)).toBeGreaterThan(0);
  });
});

describe("trees", () => {
  it("builds each kind at each level of detail, cheaper with every level", () => {
    for (const kind of TREE_KINDS) {
      const tris = ([0, 2] as const).map((lod) => {
        const t = buildTree(kind, lod);
        const z = t.positions.filter((_, i) => i % 3 === 2);
        expect(t.crown.length).toBe(z.length);
        expect(t.crown).toContain(1);
        expect(Math.max(...t.indices)).toBeLessThan(z.length);
        expect(Math.max(...z)).toBeLessThanOrEqual(1.0001);
        return t.indices.length / 3;
      });
      expect(tris[1]).toBeLessThanOrEqual(6);
      // the impostor's view holds the whole tree, turned any way about its middle, and not much more
      const r = impostorRadius(buildTree(kind, 0));
      expect(r).toBeGreaterThan(0.5);
      expect(r).toBeLessThan(KIND_INFO[kind].tall > 5 ? 0.65 : 0.9);
    }
    for (const kind of ["conifer", "broadleaf", "birch", "reed"] as const) expect(buildTree(kind, 0).crown).toContain(0); // a trunk, or the reeds' heads
    expect(buildTree("boulder", 0).crown).not.toContain(0); // snow lies all over a boulder
  });

  it("turns deciduous crowns with the seasons", () => {
    const at = (season: number, day: number) => (season * DAYS_PER_SEASON + day) * 1440 + 12 * 60 - START_MINUTE_OF_DAY;
    expect(crownAt(at(0, 0)).bare).toBeGreaterThan(0.8); // early spring: still bare
    expect(crownAt(at(1, 3))).toMatchObject({ a: TREE_COLORS.summer, bare: 0 });
    expect(crownAt(at(2, 5)).a).toBe(TREE_COLORS.autumn);
    expect(crownAt(at(3, 4)).bare).toBe(1); // winter
  });
});

describe("details", () => {
  const square = (x0: number, x1: number): DetailPoly["rings"] => [[[x0, 0], [x1, 0], [x1, 100], [x0, 100]]];
  const polys: DetailPoly[] = [
    { bbox: [0, 0, 50, 100], rings: square(0, 50), mix: { reed: { share: 0.8, size: [1, 2] } } },
    { bbox: [50, 0, 100, 100], rings: square(50, 100), mix: { boulder: { share: 0.5, size: [0.5, 2] }, bush: { share: 0.3, size: [0.5, 1] } } },
  ];
  const all = scatterDetails({ polys, rect: [0, 0, 100, 100], blocked: () => false });
  const recs = Array.from({ length: all.length / TREE_STRIDE }, (_, k) => all.subarray(k * TREE_STRIDE, (k + 1) * TREE_STRIDE));
  it("grows each kind only where its ground has it, in its size range", () => {
    const kind = (name: string) => recs.filter((r) => TREE_KINDS[r[3]] === name);
    expect(kind("reed").length).toBeGreaterThan(100);
    expect(kind("reed").every((r) => r[0] < 50 && r[2] >= 1 && r[2] <= 2)).toBe(true);
    expect(kind("boulder").every((r) => r[0] >= 50 && r[2] >= 0.5 && r[2] <= 2)).toBe(true);
    expect(kind("bush").length).toBeGreaterThan(20);
    expect(recs.some((r) => TREE_KINDS[r[3]] === "conifer")).toBe(false);
  });
  it("stays put whichever rect builds it, and keeps off blocked ground", () => {
    const a = scatterDetails({ polys, rect: [0, 0, 60, 100], blocked: () => false });
    const b = scatterDetails({ polys, rect: [60, 0, 100, 100], blocked: () => false });
    expect(a.length + b.length).toBe(all.length);
    expect(scatterDetails({ polys, rect: [0, 0, 100, 100], blocked: (x) => x < 50 }).length).toBeLessThan(all.length / 2);
  });
  it("dries the reeds in the autumn and greens them in the summer", () => {
    const at = (season: number, day: number) => (season * DAYS_PER_SEASON + day) * 1440 + 12 * 60 - START_MINUTE_OF_DAY;
    const col = (r: ReturnType<typeof reedAt>) => (r.t > 0.5 ? r.b : r.a);
    expect(col(reedAt(at(1, 4)))).toBe(TREE_COLORS.reed);
    expect(col(reedAt(at(3, 2)))).toBe(TREE_COLORS.reedDry);
  });
});

describe("far thinning", () => {
  const ring = Array.from({ length: 60 }, (_, k) => ({ n: 500, d: 100 + k * 150 }));
  const total = (reach: number) => ring.reduce((a, c) => a + (c.d < 450 ? c.n : c.n * keepAt(c.d, reach)), 0);
  it("keeps everything when it fits", () => {
    expect(thinReach(ring, 1e6, 450)).toBe(Infinity);
  });
  it("brings the total down to the cap, near chunks whole, the share falling with distance", () => {
    const r = thinReach(ring, 12_000, 450);
    expect(total(r)).toBeLessThanOrEqual(12_000);
    expect(total(r)).toBeGreaterThan(11_500);
    expect(keepAt(500, r)).toBeGreaterThan(keepAt(5000, r));
    expect(keepAt(1e6, r)).toBe(MIN_KEEP);
  });
});
