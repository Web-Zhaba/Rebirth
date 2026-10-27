import { describe, expect, it } from "vitest";
import { ROAD_KINDS } from "../sim/roads";
import type { RoadKind } from "../sim/types";
import { PATTERN, type Model, type XY } from "./modelGeometry";
import { buildRoadModel } from "./roadModels";

const KINDS = Object.keys(ROAD_KINDS) as RoadKind[];
const STRAIGHT: XY[] = [[0, 0], [40, 0]];
const BENT: XY[] = [[0, 0], [20, 0], [30, 12], [30, 30]];
const ARC: XY[] = Array.from({ length: 13 }, (_, k) => [20 * Math.cos((k / 12) * Math.PI), 20 * Math.sin((k / 12) * Math.PI)]);

function check(m: Model): void {
  const n = m.positions.length / 3;
  expect(m.normals.length).toBe(m.positions.length);
  expect(m.colors.length).toBe(m.positions.length);
  expect(m.facade.length).toBe(n * 4);
  expect(m.indices.length % 3).toBe(0);
  expect(m.indices.every((i) => i >= 0 && i < n)).toBe(true);
  expect([...m.positions, ...m.normals, ...m.colors, ...m.facade].every(Number.isFinite)).toBe(true);
}
const zs = (m: Model) => m.positions.filter((_, i) => i % 3 === 2);
const ys = (m: Model) => m.positions.filter((_, i) => i % 3 === 1);
const codes = (m: Model) => new Set(m.facade.filter((_, i) => i % 4 === 3));

describe("buildRoadModel", () => {
  it("builds valid meshes for every kind on straight, bent and curved lines", () => {
    for (const kind of KINDS)
      for (const pts of [STRAIGHT, BENT, ARC, [[0, 0], [3, 0]] as XY[]]) {
        const m = buildRoadModel(pts, kind);
        check(m);
        expect(m.indices.length).toBeGreaterThan(0);
      }
  });
  it("survives degenerate lines", () => {
    for (const kind of KINDS) for (const pts of [[], [[1, 1]], [[1, 1], [1, 1]], [[NaN, 0], [5, 0]], [[0, 0], [0, 0.01], [8, 0]]] as XY[][]) check(buildRoadModel(pts, kind));
  });
  it("lays ground roads flat just above the ground, at their real width", () => {
    for (const kind of ["path", "dirt", "stone"] as RoadKind[]) {
      const m = buildRoadModel(STRAIGHT, kind);
      const z = zs(m);
      expect(Math.min(...z)).toBeGreaterThan(0);
      expect(Math.max(...z)).toBeLessThan(0.1);
      const hw = ROAD_KINDS[kind].width / 2;
      expect(Math.max(...ys(m))).toBeCloseTo(hw, 6);
      expect(Math.min(...ys(m))).toBeCloseTo(-hw, 6);
    }
  });
  it("keeps the width through a bend (mitred, with a round joint)", () => {
    const m = buildRoadModel(BENT, "dirt");
    for (let i = 0; i < m.positions.length; i += 3) {
      const [x, y] = [m.positions[i], m.positions[i + 1]];
      // distance to the centre line never exceeds the miter limit (2 x half width)
      let d = Infinity;
      for (let k = 0; k + 1 < BENT.length; k++) {
        const [a, b] = [BENT[k], BENT[k + 1]];
        const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
        const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / l2));
        d = Math.min(d, Math.hypot(x - a[0] - t * dx, y - a[1] - t * dy));
      }
      expect(d).toBeLessThanOrEqual(ROAD_KINDS.dirt.width + 1e-6);
    }
  });
  it("gives each surface its pattern", () => {
    expect(codes(buildRoadModel(STRAIGHT, "path")).has(PATTERN.track)).toBe(true);
    expect(codes(buildRoadModel(STRAIGHT, "dirt")).has(PATTERN.ruts)).toBe(true);
    expect(codes(buildRoadModel(STRAIGHT, "stone")).has(PATTERN.cobbles)).toBe(true);
    expect(codes(buildRoadModel(STRAIGHT, "bridge")).has(PATTERN.deck)).toBe(true);
    expect(codes(buildRoadModel(STRAIGHT, "stonebridge")).has(PATTERN.ashlar)).toBe(true);
  });
  it("raises bridges over the water and brings them down to the banks", () => {
    for (const kind of ["footbridge", "bridge", "stonebridge"] as RoadKind[]) {
      const m = buildRoadModel(STRAIGHT, kind);
      expect(Math.min(...zs(m))).toBeGreaterThanOrEqual(0);
      expect(Math.max(...zs(m))).toBeGreaterThan(1);
      // the deck is at the ground at both ends
      for (const x0 of [0, 40]) {
        let low = Infinity;
        for (let i = 0; i < m.positions.length / 3; i++) if (Math.abs(m.positions[i * 3] - x0) < 1e-6 && m.facade[i * 4 + 3] !== PATTERN.plain) low = Math.min(low, m.positions[i * 3 + 2]);
        expect(low).toBeLessThan(0.05);
      }
    }
  });
  it("lets a rope bridge sag in the middle", () => {
    const m = buildRoadModel(STRAIGHT, "footbridge");
    const deckAt = (x: number) => {
      let z = -1;
      for (let i = 0; i < m.positions.length / 3; i++) if (m.facade[i * 4 + 3] === PATTERN.deck && Math.abs(m.positions[i * 3] - x) < 0.3) z = Math.max(z, m.positions[i * 3 + 2]);
      return z;
    };
    expect(deckAt(20)).toBeLessThan(deckAt(5));
    expect(deckAt(20)).toBeGreaterThan(0.3);
  });
  it("builds a stone bridge on arches", () => {
    const m = buildRoadModel([[0, 0], [60, 0]], "stonebridge");
    let soffit = 0;
    for (let i = 0; i < m.positions.length / 3; i++) if (m.normals[i * 3 + 2] < -0.5 && m.positions[i * 3 + 2] > 1) soffit++;
    expect(soffit).toBeGreaterThan(10);
  });
});
