import { describe, expect, it } from "vitest";
import { insetRing, streetWidth } from "./ruinsLayer";
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
  it("returns null for degenerate input", () => {
    expect(insetRing([[0, 0], [1, 1]], 0.5)).toBeNull();
    expect(insetRing([[0, 0], [1, 1], [2, 2]], 0.5)).toBeNull();
  });
});

describe("streetWidth", () => {
  it("is wider for larger classes", () => {
    expect(streetWidth("residential")).toBe(6);
    expect(streetWidth("minor")).toBe(6);
    expect(streetWidth("primary")).toBe(10);
  });
});
