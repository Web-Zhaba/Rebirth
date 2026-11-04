import { describe, expect, it } from "vitest";
import { Handler, type Storage } from "./handler";
import type { Cmd, FromWorker } from "./protocol";
import { emptyGrowth, seedOf } from "./growth";
import { addRoad, emptyRoads, kindsChanged, needsWork, plannedKind, spendOnRoads, upgradeReason, upgradeRoads, upgradeWork, workableEdges, workLeft } from "./roads";
import { parseSave } from "./save";
import { initialProgress } from "./tech";
import type { City, ProgressState, RoadGraph, RoadKind, SaveV4, SimState, Stock } from "./types";
import { emptyZones } from "./zones";

const NOW = 1_800_000_000_000;
const city: City = { name: "Тест", lat: 59, lng: 37, foundedAt: NOW - 1e6 };
const stockOf = (stone: number): Stock => ({ food: 100, logs: 0, planks: 0, stone, wares: 0 });

const road = (kind: RoadKind, pts: [number, number][], labor: number[], g: RoadGraph = emptyRoads()): RoadGraph => {
  const r = addRoad(g, pts, kind, 1, labor);
  if (!r.ok) throw new Error(r.reason);
  return r.graph;
};
const built = (g: RoadGraph): RoadGraph => spendOnRoads(g, 1e9).roads;
const up = (g: RoadGraph, ids: number[], kind: RoadKind, full: number[]): RoadGraph => {
  const r = upgradeRoads(g, ids, kind, full);
  if (!r.ok) throw new Error(r.reason);
  return r.graph;
};
const edgeIds = (g: RoadGraph) => Object.keys(g.edges).map(Number);

describe("which roads can be rebuilt as what", () => {
  it("only as a better kind of the same sort", () => {
    const g = built(road("dirt", [[0, 0], [50, 0]], [20]));
    const e = g.edges[edgeIds(g)[0]];
    expect(upgradeReason(e, "stone")).toBeNull();
    expect(upgradeReason(e, "path")).toBe("Здесь уже не хуже");
    expect(upgradeReason(e, "dirt")).toBe("Здесь уже не хуже");
    expect(upgradeReason(e, "bridge")).toBe("Дорогу нельзя заменить мостом");
    const b = built(road("footbridge", [[0, 0], [30, 0]], [5]));
    const be = b.edges[edgeIds(b)[0]];
    expect(upgradeReason(be, "stonebridge")).toBeNull();
    expect(upgradeReason(be, "stone")).toBe("Мост меняется только на мост");
  });
  it("counts an ordered rebuilding as the kind the road will be", () => {
    let g = built(road("path", [[0, 0], [50, 0]], [2]));
    const id = edgeIds(g)[0];
    g = up(g, [id], "dirt", [20]);
    expect(plannedKind(g.edges[id])).toBe("dirt");
    expect(upgradeReason(g.edges[id], "dirt")).toBe("Здесь уже не хуже");
    expect(upgradeReason(g.edges[id], "stone")).toBeNull();
  });
});

describe("rebuilding a built road", () => {
  it("keeps the old road in service and adds the work beyond it as a job of its own", () => {
    let g = built(road("path", [[0, 0], [50, 0]], [2]));
    const id = edgeIds(g)[0];
    g = up(g, [id], "dirt", [20]);
    const e = g.edges[id];
    expect(e.kind).toBe("path");
    expect(e.done).toBe(e.labor);
    expect(e.upgrade).toEqual({ kind: "dirt", labor: 18, done: 0 });
    expect(needsWork(e)).toBe(true);
    expect(workLeft(e)).toBe(18);
    expect(workableEdges(g)).toEqual([id]);
  });
  it("costs at least a quarter of the new road", () => {
    const g = built(road("dirt", [[0, 0], [50, 0]], [20]));
    const e = g.edges[edgeIds(g)[0]];
    expect(upgradeWork(e, 22)).toBeCloseTo(5.5);
    expect(upgradeWork(e, 40)).toBe(20);
  });
  it("is built by the road builders and then is the new kind", () => {
    let g = built(road("path", [[0, 0], [50, 0]], [2]));
    const id = edgeIds(g)[0];
    g = up(g, [id], "dirt", [20]);
    const half = spendOnRoads(g, 9).roads;
    expect(half.edges[id].kind).toBe("path");
    expect(half.edges[id].upgrade?.done).toBe(9);
    const r = spendOnRoads(half, 20);
    expect(r.left).toBeCloseTo(11);
    expect(r.roads.edges[id]).toMatchObject({ kind: "dirt", labor: 20, done: 20 });
    expect(r.roads.edges[id].upgrade).toBeUndefined();
    expect(kindsChanged(half, r.roads)).toBe(true);
    expect(kindsChanged(g, half)).toBe(false);
  });
  it("takes the stone when the rebuilding starts and waits for it", () => {
    let g = built(road("dirt", [[0, 0], [100, 0]], [40]));
    const id = edgeIds(g)[0];
    g = up(g, [id], "stone", [80]);
    expect(g.edges[id].upgrade?.stone).toBeCloseTo(1);
    expect(workableEdges(g, stockOf(0.5))).toEqual([]);
    const r = spendOnRoads(g, 10, stockOf(3));
    expect(r.stock?.stone).toBeCloseTo(2);
    expect(r.roads.edges[id].upgrade?.stone).toBeUndefined();
    expect(r.roads.edges[id].upgrade?.done).toBe(10);
  });
  it("an unfinished road simply becomes the new kind, keeping its work", () => {
    let g = road("path", [[0, 0], [50, 0]], [10]);
    const id = edgeIds(g)[0];
    g = spendOnRoads(g, 4).roads;
    g = up(g, [id], "dirt", [20]);
    expect(g.edges[id]).toMatchObject({ kind: "dirt", labor: 20, done: 4 });
    expect(g.edges[id].upgrade).toBeUndefined();
  });
  it("is shared by length when a new road splits the edge", () => {
    let g = built(road("dirt", [[0, 0], [100, 0]], [40]));
    const id = edgeIds(g)[0];
    g = up(g, [id], "stone", [80]);
    g = spendOnRoads(g, 20, stockOf(5)).roads; // 20 of 40 done, stone taken
    g = road("path", [[25, -20], [25, 20]], [4], g); // crosses at a quarter
    const parts = Object.values(g.edges).filter((e) => e.upgrade);
    expect(parts).toHaveLength(2);
    expect(parts.reduce((s, e) => s + e.upgrade!.labor, 0)).toBeCloseTo(40);
    expect(parts.reduce((s, e) => s + e.upgrade!.done, 0)).toBeCloseTo(20);
    expect(parts.map((e) => e.upgrade!.labor).sort((a, b) => a - b)).toEqual([10, 30]);
  });
  it("refuses all of it when one edge cannot be rebuilt", () => {
    let g = built(road("dirt", [[0, 0], [50, 0]], [20]));
    g = built(road("stone", [[50, 0], [100, 0]], [40], g));
    const [a, b] = edgeIds(g);
    expect(upgradeRoads(g, [a, b], "stone", [40, 40])).toEqual({ ok: false, reason: "Здесь уже не хуже" });
    expect(upgradeRoads(g, [a, 999], "stone", [40, 40])).toMatchObject({ ok: false });
    expect(upgradeRoads(g, [a], "stone", [])).toMatchObject({ ok: false });
  });
  it("comes back from a save, and a broken rebuilding is dropped, not the save", () => {
    let g = built(road("dirt", [[0, 0], [100, 0]], [40]));
    const id = edgeIds(g)[0];
    g = up(g, [id], "stone", [80]);
    const sim = { realTime: NOW, gameMinutes: 0, roads: g, zones: emptyZones(), ...emptyGrowth(7, 0) } as SimState;
    const raw = JSON.parse(JSON.stringify({ version: 4, city, sim }));
    expect(parseSave(raw, NOW + 1)!.sim.roads.edges[id]).toEqual(g.edges[id]);
    raw.sim.roads.edges[id].upgrade.done = 99;
    const back = parseSave(raw, NOW + 1)!.sim.roads.edges[id];
    expect(back.upgrade).toBeUndefined();
    expect(back.kind).toBe("dirt");
  });
});

describe("worker upgradeRoad", () => {
  const run = async (progress: ProgressState | undefined, roads: RoadGraph, cmd: Extract<Cmd, { type: "upgradeRoad" }>) => {
    const sim = { realTime: NOW, gameMinutes: 0, roads, zones: emptyZones(), ...emptyGrowth(seedOf(city.foundedAt), 0), ...(progress ? { progress } : {}) };
    let stored: SaveV4 | undefined = { version: 4, city, sim } as SaveV4;
    const storage: Storage = { get: async () => stored, put: async (s) => void (stored = s), clear: async () => void (stored = undefined) };
    const out: FromWorker[] = [];
    const h = new Handler(storage, (m) => out.push(m));
    await h.handle({ t: "load", legacy: null, now: NOW });
    out.length = 0;
    await h.handle({ t: "cmd", id: 1, cmd });
    return { res: out.find((m) => m.t === "cmdResult") as Extract<FromWorker, { t: "cmdResult" }>, roads: stored!.sim.roads };
  };
  it("orders the rebuilding, refusing a closed kind and a span too long", async () => {
    const g = built(road("dirt", [[0, 0], [50, 0]], [20]));
    const id = edgeIds(g)[0];
    expect((await run(undefined, g, { type: "upgradeRoad", kind: "stone", edges: [id], labor: [40] })).res).toMatchObject({ ok: false, reason: "Эпоха II" });
    const ok = await run({ ...initialProgress(), techs: ["paving"] }, g, { type: "upgradeRoad", kind: "stone", edges: [id], labor: [40] });
    expect(ok.res).toMatchObject({ ok: true });
    expect(ok.roads.edges[id].upgrade).toMatchObject({ kind: "stone", labor: 20 });
    const b = built(road("footbridge", [[0, 0], [40, 0]], [5]));
    const bid = edgeIds(b)[0];
    expect((await run(undefined, b, { type: "upgradeRoad", kind: "bridge", edges: [bid], labor: [30], span: 40 })).res).toMatchObject({ ok: false });
    expect((await run(undefined, b, { type: "upgradeRoad", kind: "bridge", edges: [bid], labor: [30], span: 20 })).res).toMatchObject({ ok: true });
    expect((await run(undefined, b, { type: "upgradeRoad", kind: "bridge", edges: [bid, bid], labor: [30, 30] })).res).toMatchObject({ ok: false });
  });
});
