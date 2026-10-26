import { describe, expect, it } from "vitest";
import { ADMIN, finishAll, grantStock, reveal, unlockAll } from "./admin";
import { isCleared } from "./clearing";
import { digInfos } from "./excavation";
import { ALL_UNLOCKS } from "./goals";
import { emptyGrowth, seedOf } from "./growth";
import { addRoad, emptyRoads } from "./roads";
import type { SimState } from "./types";
import { emptyZones } from "./zones";

const road = addRoad(emptyRoads(), [[0, 0], [100, 0]], "dirt", 1, [500]);
if (!road.ok) throw new Error(road.reason);
const base = (): SimState => ({
  realTime: 0,
  gameMinutes: 360,
  roads: road.graph,
  zones: emptyZones(),
  ...emptyGrowth(seedOf(1), 360),
  clearings: [{ id: 1, pts: [[0, 10], [20, 10], [20, 30], [0, 30]], area: 400, forest: 0.5, labor: 100, done: 0 }],
});

describe("admin", () => {
  it("finishes roads and clearings and is a no-op afterwards", () => {
    const done = finishAll(base());
    expect(Object.values(done.roads.edges).every((e) => e.done >= e.labor)).toBe(true);
    expect(done.clearings.every(isCleared)).toBe(true);
    expect(finishAll(done)).toBe(done);
  });

  it("grants goods and unlocks everything", () => {
    const s = base();
    expect(grantStock(s).stock.logs).toBe(s.stock.logs + ADMIN.grant);
    expect(unlockAll(s).goals.unlocks).toEqual(ALL_UNLOCKS);
  });

  it("reveals a disc that shows up as a dig and rejects bad input", () => {
    const s = base();
    const r = reveal(s, 10, 20, 100);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(digInfos(r.sim)).toEqual([expect.objectContaining({ x: 10, y: 20, r: 100 })]);
    expect(r.sim.nextBuildingId).toBe(s.nextBuildingId + 1);
    expect(reveal(s, 0, 0, ADMIN.maxRadius + 1).ok).toBe(false);
    expect(reveal(s, NaN, 0, 10).ok).toBe(false);
  });
});
