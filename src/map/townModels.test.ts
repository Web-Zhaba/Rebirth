import { describe, expect, it } from "vitest";
import { BUILDINGS } from "../sim/buildings";
import { DOOR, GATE, PATTERN, type Model, type XY } from "./modelGeometry";
import { buildTownModel, townForm } from "./townModels";

// Footprint the way growth.ts makes it: along the road (x) by deep (y), the road below (front = -y).
const lot = (along: number, deep: number, cx = 0, cy = 0): XY[] => [[cx - along / 2, cy - deep / 2], [cx + along / 2, cy - deep / 2], [cx + along / 2, cy + deep / 2], [cx - along / 2, cy + deep / 2]];
const FRONT: XY = [0, -1];

function check(m: Model): void {
  const n = m.positions.length / 3;
  expect(n).toBeGreaterThan(0);
  expect(m.normals.length).toBe(m.positions.length);
  expect(m.colors.length).toBe(m.positions.length);
  expect(m.facade.length).toBe(n * 4);
  expect(m.indices.length % 3).toBe(0);
  expect(m.indices.every((i) => i >= 0 && i < n)).toBe(true);
  expect([...m.positions, ...m.normals, ...m.colors, ...m.facade].every(Number.isFinite)).toBe(true);
}
const zMax = (m: Model) => Math.max(...m.positions.filter((_, i) => i % 3 === 2));
const zMin = (m: Model) => Math.min(...m.positions.filter((_, i) => i % 3 === 2));
const xyRange = (m: Model) => {
  const xs = m.positions.filter((_, i) => i % 3 === 0), ys = m.positions.filter((_, i) => i % 3 === 1);
  return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
};
// Walls (vertices) carrying a door or gate code, with their outward normal.
const doorWalls = (m: Model) => {
  const out: { code: number; n: [number, number] }[] = [];
  for (let i = 0; i < m.facade.length / 4; i++) if (m.facade[i * 4 + 3] >= DOOR) out.push({ code: m.facade[i * 4 + 3], n: [m.normals[i * 3], m.normals[i * 3 + 1]] });
  return out;
};

describe("buildTownModel", () => {
  it("builds valid meshes for every template, seed, level and orientation", () => {
    for (const t of Object.values(BUILDINGS))
      for (const seed of [1, 2, 3, 42, 777])
        for (const rot of [0, 0.7]) {
          const c = Math.cos(rot), s = Math.sin(rot);
          const ring = lot(t.along, t.deep, 30, -12).map(([x, y]): XY => [x * c - y * s, x * s + y * c]);
          check(buildTownModel(ring, t.height, t.id, { seed, front: [-s * -1, -c], level: seed % 2 ? 1 : 2, upgrading: seed === 3 }));
        }
  });
  it("survives odd input", () => {
    for (const ring of [[], [[0, 0]], lot(0.4, 0.4)] as XY[][]) for (const h of [0, NaN, -2, 1e5]) check(buildTownModel(ring, h, "izba", { front: FRONT }));
    check(buildTownModel(lot(6, 7), 5, "no-such-template"));
  });
  it("maps templates to forms", () => {
    expect(townForm("izba")).toBe("cabin");
    expect(townForm("smithy")).toBe("workshop");
    expect(townForm("gumno")).toBe("barn");
    expect(townForm("orchard")).toBe("orchard");
    expect(townForm("chapel")).toBe("chapel");
    expect(townForm("whatever")).toBe("cabin");
  });
  it("stands on the ground and stays near its lot (eaves, porch and sign reach a little past it)", () => {
    for (const t of Object.values(BUILDINGS))
      for (const seed of [1, 2, 3]) {
        const m = buildTownModel(lot(t.along, t.deep), t.height, t.id, { seed, front: FRONT });
        expect(zMin(m)).toBeGreaterThanOrEqual(0);
        const r = xyRange(m);
        expect(r.x0).toBeGreaterThan(-t.along / 2 - 1.2);
        expect(r.x1).toBeLessThan(t.along / 2 + 1.2);
        expect(r.y0).toBeGreaterThan(-t.deep / 2 - 1.2);
        expect(r.y1).toBeLessThan(t.deep / 2 + 1.2);
      }
  });
  it("keeps a building's look and varies between buildings", () => {
    const ring = lot(6, 7, 10, 20);
    expect(buildTownModel(ring, 5, "izba", { front: FRONT })).toEqual(buildTownModel(ring, 5, "izba", { front: FRONT }));
    const looks = new Set([1, 2, 3, 4, 5, 6, 7, 8].map((seed) => JSON.stringify(buildTownModel(ring, 5, "izba", { seed, front: FRONT }).colors.slice(0, 3)) + zMax(buildTownModel(ring, 5, "izba", { seed, front: FRONT })).toFixed(2)));
    expect(looks.size).toBeGreaterThanOrEqual(5);
  });
  it("puts the door on the wall facing the street", () => {
    for (const seed of [1, 2, 3, 4]) {
      const walls = doorWalls(buildTownModel(lot(6, 7), 5, "izba", { seed, front: FRONT }));
      expect(walls.length).toBeGreaterThan(0);
      for (const w of walls) expect(w.n[1]).toBeLessThan(-0.9);
      const side = doorWalls(buildTownModel(lot(6, 7), 5, "izba", { seed, front: [1, 0] }));
      for (const w of side) expect(w.n[0]).toBeGreaterThan(0.9);
    }
    expect(doorWalls(buildTownModel(lot(6, 7), 5, "izba", { seed: 1 }))).toHaveLength(0);
  });
  it("gives barns and workshops a gate, houses a door", () => {
    expect(doorWalls(buildTownModel(lot(8, 10), 6, "gumno", { seed: 1, front: FRONT })).every((w) => w.code >= GATE)).toBe(true);
    expect(doorWalls(buildTownModel(lot(6, 5), 4, "smithy", { seed: 1, front: FRONT })).every((w) => w.code >= GATE)).toBe(true);
    expect(doorWalls(buildTownModel(lot(6, 7), 5, "izba", { seed: 1, front: FRONT })).every((w) => w.code === PATTERN.cabin + DOOR || w.code === PATTERN.house + DOOR)).toBe(true);
  });
  it("rebuilt houses are a floor higher", () => {
    for (const seed of [1, 2, 3]) {
      const a = buildTownModel(lot(6, 7), 5, "izba", { seed, front: FRONT, level: 1 });
      const b = buildTownModel(lot(6, 7), 6.5, "izba", { seed, front: FRONT, level: 2 });
      expect(zMax(b)).toBeGreaterThan(zMax(a) + 1);
    }
  });
  it("an overlay tint colours the walls", () => {
    const m = buildTownModel(lot(6, 7), 5, "izba", { seed: 1, front: FRONT, tint: "#ff0000" });
    let red = 0;
    for (let i = 0; i < m.colors.length; i += 3) if (m.colors[i] === 1 && m.colors[i + 1] === 0 && m.colors[i + 2] === 0) red++;
    expect(red).toBeGreaterThan(8);
  });
  it("yards stay low, houses rise", () => {
    expect(zMax(buildTownModel(lot(3, 3), 1, "garden", { seed: 1 }))).toBeLessThan(0.6);
    expect(zMax(buildTownModel(lot(6, 6), 1, "dig", { seed: 1 }))).toBeLessThan(2);
    expect(zMax(buildTownModel(lot(6, 7), 5, "izba", { seed: 1, front: FRONT }))).toBeGreaterThan(4);
  });
});
