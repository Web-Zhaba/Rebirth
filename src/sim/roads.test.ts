import { describe, expect, it } from "vitest";
import { advanceTo, BASE_TICK, TICK_MS } from "./clock";
import {
  addRoad,
  advanceConstruction,
  emptyRoads,
  removeEdge,
  segmentCost,
  snapPoint,
  workableEdges,
  type TerrainProfile,
} from "./roads";
import type { RoadGraph } from "./types";

const NOW = 1_800_000_000_000;
const TOL = 5;

function add(g: RoadGraph, pts: [number, number][], labor: number[], kind: "path" | "dirt" = "path"): RoadGraph {
  const r = addRoad(g, pts, kind, TOL, labor);
  if (!r.ok) throw new Error(r.reason);
  return r.graph;
}
const edges = (g: RoadGraph) => Object.values(g.edges);
const sumLabor = (g: RoadGraph) => edges(g).reduce((s, e) => s + e.labor, 0);

describe("addRoad", () => {
  it("creates nodes and an edge with deterministic ids", () => {
    const g = add(emptyRoads(), [[0, 0], [100, 0]], [50]);
    expect(Object.keys(g.nodes)).toEqual(["1", "2"]);
    expect(g.edges[3]).toEqual({ id: 3, a: 1, b: 2, kind: "path", length: 100, labor: 50, done: 0 });
    expect(g.nextId).toBe(4);
  });
  it("does not mutate its input and rejects atomically", () => {
    const g0 = add(emptyRoads(), [[0, 0], [100, 0]], [50]);
    const snapshot = JSON.stringify(g0);
    const r = addRoad(g0, [[50, 0], [50, 100], [50, 103]], "path", TOL, [10, 1]);
    expect(r.ok).toBe(false);
    expect(JSON.stringify(g0)).toBe(snapshot);
  });
  it("snaps an endpoint to an existing node", () => {
    const g0 = add(emptyRoads(), [[0, 0], [100, 0]], [50]);
    const g = add(g0, [[102, 2], [100, 100]], [50]);
    expect(Object.keys(g.nodes)).toHaveLength(3); // only the far end is new
    const e = edges(g).find((x) => x.id !== 3)!;
    expect([e.a, e.b]).toContain(2);
  });
  it("snaps to an edge by splitting it and prorating labor and done", () => {
    let g0 = add(emptyRoads(), [[0, 0], [100, 0]], [100]);
    g0 = { ...g0, edges: { 3: { ...g0.edges[3], done: 40 } } };
    const g = add(g0, [[25, 3], [25, 80]], [30]);
    const parts = edges(g).filter((e) => e.kind === "path" && g.nodes[e.a].y === 0 && g.nodes[e.b].y === 0);
    expect(parts).toHaveLength(2);
    const left = parts.find((e) => e.id === 3)!;
    const right = parts.find((e) => e.id !== 3)!;
    expect(left.length).toBeCloseTo(25);
    expect(right.length).toBeCloseTo(75);
    expect(left.labor).toBeCloseTo(25);
    expect(right.labor).toBeCloseTo(75);
    expect(left.done).toBeCloseTo(10);
    expect(right.done).toBeCloseTo(30);
    const stem = edges(g).find((e) => !parts.includes(e))!;
    expect(stem.length).toBeCloseTo(80);
    expect(g.nodes[stem.a].x).toBeCloseTo(25);
    expect(g.nodes[stem.a].y).toBeCloseTo(0);
  });
  it("crossing creates an intersection and splits both edges", () => {
    let g0 = add(emptyRoads(), [[-50, 0], [50, 0]], [100]);
    g0 = { ...g0, edges: { 3: { ...g0.edges[3], done: 50 } } };
    const g = add(g0, [[0, -50], [0, 50]], [200]);
    expect(Object.keys(g.nodes)).toHaveLength(5);
    expect(edges(g)).toHaveLength(4);
    const hub = Object.values(g.nodes).find((n) => Math.abs(n.x) < 1e-9 && Math.abs(n.y) < 1e-9)!;
    const around = edges(g).filter((e) => e.a === hub.id || e.b === hub.id);
    expect(around).toHaveLength(4);
    for (const e of around) expect(e.length).toBeCloseTo(50);
    // old edge: labor 100 and done 50 split in halves; new edge: 200 in halves
    const horizontal = around.filter((e) => e.labor < 60);
    expect(horizontal).toHaveLength(2);
    for (const e of horizontal) {
      expect(e.labor).toBeCloseTo(50);
      expect(e.done).toBeCloseTo(25);
    }
    expect(sumLabor(g)).toBeCloseTo(300);
  });
  it("passing through an existing node does not duplicate it", () => {
    const g0 = add(add(emptyRoads(), [[-50, 0], [0, 0]], [10]), [[0, 0], [50, 0]], [10]);
    const g = add(g0, [[0, -50], [0, 50]], [20]);
    expect(Object.keys(g.nodes)).toHaveLength(5);
    expect(edges(g)).toHaveLength(4);
  });
  it("chains segments through the previous end", () => {
    const g = add(emptyRoads(), [[0, 0], [50, 0], [50, 50]], [10, 12]);
    expect(Object.keys(g.nodes)).toHaveLength(3);
    expect(edges(g)).toHaveLength(2);
  });
  it("rejects segments that are too short", () => {
    const r = addRoad(emptyRoads(), [[0, 0], [7, 0]], "path", TOL, [1]);
    expect(r).toEqual({ ok: false, reason: "Слишком коротко" });
    const g0 = add(emptyRoads(), [[0, 0], [100, 0]], [50]);
    // second point snaps onto the first node
    expect(addRoad(g0, [[50, 50], [2, 1]], "path", TOL, [1]).ok).toBe(true); // 50 m away is fine
    expect(addRoad(g0, [[1, 1], [3, 2]], "path", TOL, [1])).toEqual({ ok: false, reason: "Слишком коротко" });
  });
  it("rejects overlaps and duplicates", () => {
    const g0 = add(emptyRoads(), [[0, 0], [100, 0]], [50]);
    expect(addRoad(g0, [[10, 0.5], [90, -0.5]], "dirt", 0.1, [50]).ok).toBe(false);
    expect(addRoad(g0, [[0, 0], [100, 0]], "dirt", TOL, [50]).ok).toBe(false);
    expect(addRoad(g0, [[-20, 0], [60, 0.4]], "dirt", 0.1, [50]).ok).toBe(false);
    // a steep branch off the same node is fine
    expect(addRoad(g0, [[0, 0], [40, 40]], "dirt", TOL, [50]).ok).toBe(true);
  });
  it("rejects a duplicate of a short edge", () => {
    const g0 = add(emptyRoads(), [[0, 0], [9, 0]], [5]);
    expect(addRoad(g0, [[0, 0], [9, 0]], "path", TOL, [5])).toMatchObject({ ok: false });
  });
});

describe("removeEdge", () => {
  it("drops orphan nodes but keeps shared ones", () => {
    const g = add(emptyRoads(), [[0, 0], [50, 0], [50, 50]], [10, 10]);
    const first = edges(g)[0];
    const g2 = removeEdge(g, first.id);
    expect(edges(g2)).toHaveLength(1);
    expect(Object.keys(g2.nodes)).toHaveLength(2);
    expect(g2.nodes[first.a]).toBeUndefined();
    expect(g2.nodes[first.b]).toBeDefined();
    expect(Object.keys(removeEdge(g2, edges(g2)[0].id).nodes)).toHaveLength(0);
  });
  it("ignores unknown ids", () => {
    const g = add(emptyRoads(), [[0, 0], [50, 0]], [10]);
    expect(removeEdge(g, 99)).toBe(g);
  });
});

describe("snapPoint", () => {
  it("prefers a node, then an edge, else free", () => {
    const g = add(emptyRoads(), [[0, 0], [100, 0]], [50]);
    expect(snapPoint(g, { x: 3, y: 2 }, TOL)).toMatchObject({ kind: "node", x: 0, y: 0 });
    expect(snapPoint(g, { x: 50, y: 4 }, TOL)).toMatchObject({ kind: "edge", x: 50, y: 0 });
    expect(snapPoint(g, { x: 50, y: 9 }, TOL)).toMatchObject({ kind: "free", x: 50, y: 9 });
  });
});

describe("segmentCost", () => {
  const flat = (land: TerrainProfile["land"], length = land.length * 10): TerrainProfile => ({
    length,
    land,
    elev: Array.from({ length: land.length + 1 }, () => 100),
  });
  it("applies land multipliers", () => {
    expect(segmentCost(flat(["meadow", "meadow"]), "dirt").labor).toBeCloseTo(20);
    expect(segmentCost(flat(["forest", "sand"]), "dirt").labor).toBeCloseTo(10 * 3 + 10 * 1.2);
    expect(segmentCost(flat(["wetland", "rock", "ice"]), "path").labor).toBeCloseTo(0.2 * 10 * (2.5 + 2 + 3));
  });
  it("adds a grade factor per piece", () => {
    const p = flat(["meadow", "meadow"]);
    p.elev = [100, 101, 101]; // 10 % on the first piece
    const c = segmentCost(p, "dirt");
    expect(c.ok).toBe(true);
    expect(c.maxGrade).toBeCloseTo(0.1);
    expect(c.labor).toBeCloseTo(10 * (1 + 0.1 / 0.08) + 10);
  });
  it("rejects water", () => {
    expect(segmentCost(flat(["meadow", "water"]), "path")).toMatchObject({
      ok: false,
      reason: "Нельзя через воду — мосты позже",
    });
  });
  it("rejects steep grades per kind", () => {
    const p = flat(["meadow", "meadow"]);
    p.elev = [100, 101.5, 101.5]; // 15 %
    expect(segmentCost(p, "dirt")).toMatchObject({ ok: false, reason: "Слишком круто: 15 %" });
    expect(segmentCost(p, "path").ok).toBe(true);
    p.elev = [100, 103, 103]; // 30 %
    expect(segmentCost(p, "path")).toMatchObject({ ok: false, reason: "Слишком круто: 30 %" });
  });
  it("rejects short segments", () => {
    expect(segmentCost(flat(["meadow"], 7), "path")).toMatchObject({ ok: false, reason: "Слишком коротко" });
  });
});

describe("construction", () => {
  const HOURS = (10 * BASE_TICK) / 60;

  it("is FIFO and carries leftovers", () => {
    let g = add(emptyRoads(), [[0, 0], [50, 0]], [1]);
    g = add(g, [[50, 0], [100, 0]], [10]);
    const after = advanceConstruction(g, HOURS);
    const [e1, e2] = edges(after);
    expect(e1.done).toBe(e1.labor);
    expect(e2.done).toBeCloseTo(HOURS - 1);
  });
  it("only workable edges: an isolated edge waits until connected", () => {
    let g = add(emptyRoads(), [[0, 0], [50, 0]], [5]);
    g = add(g, [[500, 500], [550, 500]], [5]); // far from the founding point
    expect(workableEdges(g)).toEqual([edges(g)[0].id]);
    let a = advanceConstruction(g, 100);
    expect(edges(a)[0].done).toBe(5);
    expect(edges(a)[1].done).toBe(0);
    // connect it with a bridge road: now the whole network gets built
    a = add(a, [[50, 0], [500, 500]], [20]);
    expect(workableEdges(a)).toHaveLength(1); // the bridge; the far edge unlocks once it is built
    a = advanceConstruction(a, 100);
    expect(edges(a).every((e) => e.done === e.labor)).toBe(true);
  });
  it("a finished edge unlocks its neighbour within the same call", () => {
    let g = add(emptyRoads(), [[0, 0], [50, 0]], [1]);
    g = add(g, [[50, 0], [100, 0]], [1]);
    g = add(g, [[100, 0], [150, 0]], [1]);
    const a = advanceConstruction(g, 5);
    expect(edges(a).every((e) => e.done === e.labor)).toBe(true);
  });
  it("returns the same graph when there is nothing to do", () => {
    const g = add(emptyRoads(), [[500, 500], [550, 500]], [5]);
    expect(advanceConstruction(g, 5)).toBe(g);
  });
  it("works only 07:00-19:00 game time", () => {
    const g = add(emptyRoads(), [[0, 0], [50, 0]], [1000]);
    const start = { realTime: NOW, gameMinutes: 0, roads: g }; // 06:00
    const at = (minutes: number) => advanceTo(start, NOW + (minutes / BASE_TICK) * TICK_MS);
    expect(at(60).roads.edges[3].done).toBe(0); // 06:00-07:00 idle
    expect(at(70).roads.edges[3].done).toBeCloseTo(HOURS); // first work tick
    expect(at(13 * 60).roads.edges[3].done).toBeCloseTo(12 * 6 * HOURS); // 07:00-19:00 only
    expect(at(13 * 60 + 600).roads.edges[3].done).toBeCloseTo(12 * 6 * HOURS); // night idle
  });
});
