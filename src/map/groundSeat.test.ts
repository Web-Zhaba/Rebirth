import { describe, expect, it } from "vitest";
import { buildHeritageModel } from "./heritageModels";
import { drapeRoad, ROAD_LIFT, seatBridge, seatBuilding } from "./groundSeat";
import type { Model, XY } from "./modelGeometry";
import { buildRoadModel } from "./roadModels";

const zs = (m: Model) => m.positions.filter((_, i) => i % 3 === 2);
const ring: XY[] = [[0, 0], [10, 0], [10, 6], [0, 6]];

describe("groundSeat", () => {
  it("lifts a building to the highest ground under it and fills a plinth below the lowest", () => {
    const m = buildHeritageModel(ring, 6, "house");
    const slope = (x: number) => 100 + x * 0.3; // 3 m across the lot
    const s = seatBuilding(m, ring, slope, "#888888");
    const base = Math.min(...zs(m));
    // the original vertices moved up by the top of the lot
    expect(zs(s).slice(0, zs(m).length).every((z, i) => Math.abs(z - zs(m)[i] - 103) < 1e-9)).toBe(true);
    expect(base).toBeCloseTo(0, 6);
    // the plinth reaches below the lowest ground
    expect(Math.min(...zs(s))).toBeLessThan(100);
    expect(s.indices.length).toBeGreaterThan(m.indices.length);
    expect(Math.max(...s.indices)).toBeLessThan(s.positions.length / 3);
  });

  it("adds no plinth on flat ground", () => {
    const m = buildHeritageModel(ring, 6, "house");
    const s = seatBuilding(m, ring, () => 50, "#888888");
    expect(s.positions.length).toBe(m.positions.length);
    expect(Math.min(...zs(s))).toBeCloseTo(50, 6);
  });

  it("drapes a ground road over the relief vertex by vertex", () => {
    const pts: XY[] = [[0, 0], [40, 0]];
    const m = buildRoadModel(pts, "dirt");
    const hill = (x: number) => 20 + 5 * Math.sin(x / 10);
    const d = drapeRoad(m, hill);
    for (let k = 0; k < d.positions.length; k += 3) {
      expect(d.positions[k + 2] - m.positions[k + 2]).toBeCloseTo(hill(d.positions[k]) + ROAD_LIFT, 6);
    }
    // the ribbon is resampled finely enough to follow the hill
    expect(new Set(m.positions.filter((_, i) => i % 3 === 0).map((x) => Math.round(x))).size).toBeGreaterThan(6);
  });

  it("runs a bridge deck straight between its banks and stands its feet on the riverbed", () => {
    const pts: XY[] = [[0, 0], [30, 0]];
    const m = buildRoadModel(pts, "bridge");
    const valley = (x: number) => 10 + Math.abs(x - 15) / 3; // banks at 15, riverbed at 10
    const s = seatBridge(m, pts, valley);
    for (let k = 0; k < s.positions.length; k += 3) {
      const z0 = m.positions[k + 2], z = s.positions[k + 2];
      if (z0 > 0.01) expect(z - z0).toBeCloseTo(15, 6); // both banks at 15: a level deck
      else expect(z).toBeCloseTo(Math.min(15, valley(s.positions[k])) + z0, 6);
    }
    expect(Math.min(...zs(s))).toBeLessThan(11);
  });
});
