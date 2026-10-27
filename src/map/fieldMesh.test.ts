import { describe, expect, it } from "vitest";
import { buildFieldMesh, EDGE_CAP, furrowDirection, edgeDistance } from "./fieldMesh";
import type { XY } from "./modelGeometry";

const shoelace = (p: readonly XY[]) => {
  let a = 0;
  for (let i = 0; i < p.length; i++) {
    const q = p[(i + 1) % p.length];
    a += p[i][0] * q[1] - q[0] * p[i][1];
  }
  return Math.abs(a) / 2;
};
const meshArea = (m: ReturnType<typeof buildFieldMesh>) => {
  let a = 0;
  for (let t = 0; t < m.index.length; t += 3) {
    const [i, j, k] = [m.index[t], m.index[t + 1], m.index[t + 2]];
    a += Math.abs((m.xy[j * 2] - m.xy[i * 2]) * (m.xy[k * 2 + 1] - m.xy[i * 2 + 1]) - (m.xy[k * 2] - m.xy[i * 2]) * (m.xy[j * 2 + 1] - m.xy[i * 2 + 1])) / 2;
  }
  return a;
};
const inside = (p: readonly XY[], x: number, y: number) => {
  let c = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++)
    if (p[i][1] > y !== p[j][1] > y && x < ((p[j][0] - p[i][0]) * (y - p[i][1])) / (p[j][1] - p[i][1]) + p[i][0]) c = !c;
  return c;
};

const rect: XY[] = [[10, 3], [110, 3], [110, 33], [10, 33]];
const ell: XY[] = [[0, 0], [60, 0], [60, 20], [20, 20], [20, 70], [0, 70]]; // concave
const tilted: XY[] = [[0, 0], [90, 40], [75, 74], [-15, 34]];

describe("buildFieldMesh", () => {
  for (const [name, poly] of [["rectangle", rect], ["L shape", ell], ["tilted", tilted]] as const)
    it(`${name}: area preserved, vertices inside, edge distance sane`, () => {
      const m = buildFieldMesh(poly);
      expect(Math.abs(meshArea(m) - shoelace(poly)) / shoelace(poly)).toBeLessThan(0.01);
      for (let v = 0; v < m.xy.length / 2; v++) {
        const x = m.xy[v * 2], y = m.xy[v * 2 + 1];
        expect(inside(poly, x, y) || edgeDistance(poly, x, y) < 1e-3).toBe(true);
        expect(m.edge[v]).toBeGreaterThanOrEqual(0);
        expect(m.edge[v]).toBeLessThanOrEqual(EDGE_CAP);
      }
    });
  it("welds shared vertices (a grid, not one vertex per piece corner)", () => {
    const m = buildFieldMesh(rect, 8);
    const keys = new Set<string>();
    for (let v = 0; v < m.xy.length / 2; v++) keys.add(`${m.xy[v * 2].toFixed(3)},${m.xy[v * 2 + 1].toFixed(3)}`);
    expect(keys.size).toBe(m.xy.length / 2);
  });
  it("the furrow direction of a long rectangle follows its long side", () => {
    const [dx, dy] = furrowDirection(rect);
    expect(dx).toBeCloseTo(1);
    expect(dy).toBeCloseTo(0);
    const tall: XY[] = [[0, 0], [10, 0], [10, 100], [0, 100]];
    const [tx, ty] = furrowDirection(tall);
    expect(Math.abs(ty)).toBeCloseTo(1);
    expect(tx).toBeCloseTo(0);
    expect(Math.hypot(...furrowDirection(tilted))).toBeCloseTo(1);
  });
  it("reports the extent along the furrows", () => {
    const m = buildFieldMesh(rect);
    expect(m.along[0]).toBeCloseTo(10);
    expect(m.along[1]).toBeCloseTo(110);
  });
});
