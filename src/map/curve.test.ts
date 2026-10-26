import { describe, expect, it } from "vitest";
import { MIN_SEGMENT } from "../sim/roads";
import { arcPath, dedupePath, resamplePath, snapAngle, type Pt } from "./curve";

const segs = (pts: readonly Pt[]) => pts.slice(1).map((p, i) => Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]));
const total = (pts: readonly Pt[]) => segs(pts).reduce((s, l) => s + l, 0);

describe("snapAngle", () => {
  it("snaps the direction to 15° steps and keeps the reach along the ray", () => {
    const r = snapAngle([0, 0], [100, 20]);
    const angle = Math.PI / 12;
    const along = 100 * Math.cos(angle) + 20 * Math.sin(angle);
    expect(r.deg).toBe(15);
    expect(r.x).toBeCloseTo(Math.cos(angle) * along);
    expect(r.y).toBeCloseTo(Math.sin(angle) * along);
    expect(Math.hypot(r.x, r.y)).toBeLessThanOrEqual(Math.hypot(100, 20) + 1e-9);
  });
  it("rounds to the nearest axis and diagonal", () => {
    expect(snapAngle([0, 0], [0, 10]).deg).toBe(90);
    expect(snapAngle([0, 0], [-10, -10]).deg).toBe(225);
    expect(snapAngle([0, 0], [10, 8]).deg).toBe(45);
  });
  it("keeps a zero-length cursor at the anchor", () => {
    expect(snapAngle([5, 5], [5, 5])).toEqual({ x: 5, y: 5, deg: 0 });
  });
});

describe("dedupePath", () => {
  it("drops repeated points", () => {
    expect(dedupePath([[0, 0], [0, 0], [1, 0], [1, 0], [2, 0]])).toEqual([[0, 0], [1, 0], [2, 0]]);
  });
});

describe("resamplePath", () => {
  it("keeps the ends and makes no piece shorter than MIN_SEGMENT", () => {
    const pts: Pt[] = [];
    for (let i = 0; i <= 100; i++) pts.push([i * 3, Math.sin(i / 5) * 20]);
    const out = resamplePath(pts);
    expect(out[0]).toEqual(pts[0]);
    expect(out[out.length - 1]).toEqual(pts[pts.length - 1]);
    for (const l of segs(out)) expect(l).toBeGreaterThanOrEqual(MIN_SEGMENT - 1e-9);
  });
  it("spaces points evenly along the arc", () => {
    const out = resamplePath([[0, 0], [100, 0]], 10);
    const lengths = segs(out);
    for (const l of lengths) expect(l).toBeCloseTo(lengths[0]);
    expect(lengths.reduce((s, l) => s + l, 0)).toBeCloseTo(100);
  });
});

describe("arcPath", () => {
  it("passes through the bend point and keeps both ends", () => {
    const a: Pt = [0, 0];
    const b: Pt = [100, 0];
    const c: Pt = [50, 30];
    const out = arcPath(a, c, b);
    expect(out[0]).toEqual(a);
    expect(out[out.length - 1]).toEqual(b);
    const nearest = Math.min(...out.map((p) => Math.hypot(p[0] - c[0], p[1] - c[1])));
    expect(nearest).toBeLessThan(2);
    for (const l of segs(out)) expect(l).toBeGreaterThanOrEqual(MIN_SEGMENT - 1e-9);
  });
  it("is a straight line when the bend point lies on the chord", () => {
    const out = arcPath([0, 0], [50, 0], [100, 0]);
    expect(out.every((p) => Math.abs(p[1]) < 1e-9)).toBe(true);
    expect(total(out)).toBeCloseTo(100);
  });
  it("bends to the side the cursor is on", () => {
    const up = arcPath([0, 0], [50, 20], [100, 0]);
    const down = arcPath([0, 0], [50, -20], [100, 0]);
    expect(Math.max(...up.map((p) => p[1]))).toBeGreaterThan(0);
    expect(Math.min(...down.map((p) => p[1]))).toBeLessThan(0);
  });
  it("takes the long way round when the bend point is behind the chord", () => {
    const out = arcPath([0, 0], [-50, 1], [100, 0]);
    expect(out[0]).toEqual([0, 0]);
    expect(out[out.length - 1]).toEqual([100, 0]);
    expect(Math.max(...out.map((p) => Math.abs(p[1])))).toBeGreaterThan(10);
  });
  it("stays valid for a very short chord", () => {
    const out = arcPath([0, 0], [2, 1], [3, 0]);
    expect(out[0]).toEqual([0, 0]);
    expect(out[out.length - 1]).toEqual([3, 0]);
  });
});
