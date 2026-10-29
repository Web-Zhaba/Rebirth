import { describe, expect, it } from "vitest";
import { doneKinds } from "../sim/heritage";
import { brokenWalls, insetRing, streetWidth, WALL_HEIGHT } from "./ruinsLayer";
import type { XY } from "../world/oldworld";

const area = (r: XY[]) => {
  let s = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) s += r[j][0] * r[i][1] - r[i][0] * r[j][1];
  return s / 2;
};

describe("insetRing", () => {
  const square: XY[] = [
    [0, 0],
    [10, 0],
    [10, 10],
    [0, 10],
  ];
  it("insets a square by d on every side", () => {
    const r = insetRing(square, 0.5)!;
    expect(r).not.toBeNull();
    expect(area(r)).toBeCloseTo(81, 6);
    for (const [x, y] of r) {
      expect(x).toBeGreaterThanOrEqual(0.5 - 1e-9);
      expect(x).toBeLessThanOrEqual(9.5 + 1e-9);
      expect(y).toBeGreaterThanOrEqual(0.5 - 1e-9);
      expect(y).toBeLessThanOrEqual(9.5 + 1e-9);
    }
  });
  it("handles clockwise and closed rings, always returning counter-clockwise", () => {
    const cwClosed: XY[] = [...square].reverse();
    cwClosed.push(cwClosed[0]);
    const r = insetRing(cwClosed, 1)!;
    expect(area(r)).toBeCloseTo(64, 6);
  });
  it("handles a concave L shape", () => {
    const L: XY[] = [
      [0, 0],
      [10, 0],
      [10, 4],
      [4, 4],
      [4, 10],
      [0, 10],
    ];
    const r = insetRing(L, 0.5)!;
    expect(r).not.toBeNull();
    expect(r.length).toBe(6);
    expect(area(r)).toBeLessThan(area(L));
    expect(area(r)).toBeGreaterThan(0);
  });
  it("returns null when the ring is thinner than twice the inset", () => {
    expect(insetRing([[0, 0], [10, 0], [10, 0.6], [0, 0.6]], 0.5)).toBeNull();
    expect(insetRing([[0, 0], [0.8, 0], [0.8, 0.8], [0, 0.8]], 0.5)).toBeNull();
  });
  it("returns null for degenerate or self-intersecting input", () => {
    expect(insetRing([[0, 0], [1, 1]], 0.5)).toBeNull();
    expect(insetRing([[0, 0], [1, 1], [2, 2]], 0.5)).toBeNull();
    expect(insetRing([[0, 0], [4, 4], [0, 4], [4, 0]], 0.5)).toBeNull();
  });

  it("keeps a valid narrow concavity well-formed", () => {
    const notch: XY[] = [[0, 0], [8, 0], [8, 8], [4.3, 8], [4.3, 1], [3.7, 1], [3.7, 8], [0, 8]];
    const r = insetRing(notch, 0.5);
    expect(r).not.toBeNull();
    expect(r!.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y))).toBe(true);
    expect(area(r!)).toBeGreaterThan(0);
    expect(area(r!)).toBeLessThan(area(notch));
  });
});

describe("streetWidth", () => {
  it("is wider for larger classes", () => {
    expect(streetWidth("residential")).toBe(6);
    expect(streetWidth("minor")).toBe(6);
    expect(streetWidth("primary")).toBe(10);
  });
});

describe("doneKinds", () => {
  it("lists kinds with a restoring or restored site, not lost or untouched ones", () => {
    const k = doneKinds([{ cls: "castle", state: "restored" }, { cls: "school", state: "restoring" }, { cls: "library", state: "lost" }, { cls: "museum" }, { state: "restored" }]);
    expect([...k].sort()).toEqual(["castle", "school"]);
  });
});

describe("brokenWalls", () => {
  const house: XY[] = [[0, 0], [12, 0], [12, 8], [0, 8]];
  it("breaks the walls into pieces of different heights, the same every time", () => {
    const a = brokenWalls(house, "way/1", 9)!;
    expect(a.length).toBeGreaterThanOrEqual(14); // 40 m of wall in ~2.5 m pieces
    const hs = a.map((q) => q.h);
    expect(new Set(hs).size).toBeGreaterThan(5);
    expect(Math.min(...hs)).toBeLessThan(WALL_HEIGHT);
    expect(Math.max(...hs)).toBeLessThanOrEqual(3);
    expect(brokenWalls(house, "way/1", 9)).toEqual(a);
    expect(brokenWalls(house, "way/2", 9)!.map((q) => q.h)).not.toEqual(hs);
  });
  it("covers the band of the wall and rejects unsafe geometry", () => {
    const sum = brokenWalls(house, "x")!.reduce((s, q) => s + Math.abs(area(q.quad)), 0);
    expect(sum).toBeCloseTo(12 * 8 - 11 * 7, 6);
    expect(brokenWalls([[0, 0], [10, 0], [10, 0.6], [0, 0.6]], "x")).toBeNull();
    expect(brokenWalls([[0, 0], [4, 4], [0, 4], [4, 0]], "x")).toBeNull();
  });
});
