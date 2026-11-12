import { describe, expect, it } from "vitest";
import { inFrame, mapFrame, museumPlan, toMap } from "./museumPlan";

type Pt = [number, number];
const rot = (pts: Pt[], a: number): Pt[] => pts.map(([x, y]) => [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)]);

describe("the museum plan", () => {
  it("lays a tall, turned footprint long side across and cuts it into its halls", () => {
    const ring = rot([[0, 0], [12, 0], [12, 30], [0, 30]], 0.7); // 12 x 30 m, turned
    const p = museumPlan(ring, 5);
    expect(p.rooms).toHaveLength(5);
    expect(p.width / p.height).toBeGreaterThanOrEqual(1.25 - 1e-9);
    const xs = p.outline.map((q) => q[0]);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(30, 6);
    expect(p.rooms.filter((r) => r.y < p.height / 2 - 1e-6 && r.y + r.h <= p.height / 2 + 1e-6)).toHaveLength(3); // the first row holds the odd one
    for (const r of p.rooms) {
      expect(r.x).toBeGreaterThanOrEqual(-1e-9);
      expect(r.x + r.w).toBeLessThanOrEqual(p.width + 1e-9);
      expect(r.y + r.h).toBeLessThanOrEqual(p.height + 1e-9);
    }
  });
  it("puts the halls of a long narrow building in one row", () => {
    const p = museumPlan([[0, 0], [60, 0], [60, 10], [0, 10]], 6);
    expect(new Set(p.rooms.map((r) => r.y)).size).toBe(1);
    expect(p.width / p.height).toBeLessThanOrEqual(3.2 + 1e-9);
  });
});

describe("the theme map", () => {
  it("frames the points in a square and maps them with y down", () => {
    const f = mapFrame([[0, 0], [100, 50]]);
    expect(f.size).toBe(240);
    expect(inFrame(f, [50, 25])).toBe(true);
    const [x, y] = toMap(f, [50, 25]);
    expect(x).toBeCloseTo(500, 6);
    expect(y).toBeCloseTo(500, 6);
    expect(toMap(f, [50, 100])[1]).toBeLessThan(500);
  });
});
