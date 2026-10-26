import { describe, expect, it } from "vitest";
import { constructionWork } from "./people";
import { advanceTo, TICK_MS } from "./clock";
import { Handler, type Storage } from "./handler";
import type { Cmd, FromWorker } from "./protocol";
import { emptyGrowth, seedOf } from "./growth";
import { addRoad, effectiveSpans, emptyRoads, longestSpan, ROAD_KINDS, segmentCost, spanReason, spendOnRoads, stoneWaiting, workableEdges, type TerrainProfile } from "./roads";
import { parseSave } from "./save";
import { initialProgress, lockReason } from "./tech";
import type { City, ProgressState, RoadGraph, SaveV4, SimState, Stock } from "./types";
import { emptyZones } from "./zones";

const NOW = 1_800_000_000_000;
const city: City = { name: "Тест", lat: 59, lng: 37, foundedAt: NOW - 1e6 };
const withTechs = (...techs: string[]): ProgressState => ({ ...initialProgress(), techs });

const profile = (land: TerrainProfile["land"], length = land.length * 10, grade = 0): TerrainProfile => ({
  length,
  land,
  elev: Array.from({ length: land.length + 1 }, (_, i) => 100 + (i * grade * length) / land.length),
});
const water = (n: number): TerrainProfile["land"] => Array.from({ length: n }, () => "water" as const);

const stockOf = (stone: number): Stock => ({ food: 100, logs: 0, planks: 0, stone, wares: 0 });
const road = (kind: "stone" | "dirt" | "stonebridge", pts: [number, number][], labor: number[], g: RoadGraph = emptyRoads()): RoadGraph => {
  const r = addRoad(g, pts, kind, 1, labor);
  if (!r.ok) throw new Error(r.reason);
  return r.graph;
};
const edges = (g: RoadGraph) => Object.values(g.edges);

describe("bridge span", () => {
  it("is the longest run of water pieces", () => {
    expect(longestSpan(profile(["meadow", "meadow"]))).toBe(0);
    expect(longestSpan(profile(["meadow", ...water(3), "meadow"]))).toBe(30);
    expect(longestSpan(profile([...water(2), "meadow", ...water(4), "sand", "water"]))).toBe(40); // runs of 2, 4, 1
    expect(longestSpan(profile(water(5), 52))).toBeCloseTo(52);
  });
  it("has base limits and adds the researched techs", () => {
    expect(effectiveSpans()).toEqual({ footbridge: 25, bridge: 30, stonebridge: 60 });
    expect(effectiveSpans(withTechs("joinery")).bridge).toBe(45);
    expect(effectiveSpans(withTechs("joinery", "trusses"))).toEqual({ footbridge: 25, bridge: 60, stonebridge: 100 });
    expect(effectiveSpans(withTechs("trusses")).stonebridge).toBe(100);
  });
  it("refuses a span over the limit and names it", () => {
    const p = profile(["meadow", ...water(4), "meadow"], 60); // 40 m of water
    expect(segmentCost(p, "bridge")).toMatchObject({ ok: false, reason: "Пролёт 40 м: свайный мост держит до 30 м" });
    expect(segmentCost(p, "footbridge")).toMatchObject({ ok: false, reason: "Пролёт 40 м: канатный мостик держит до 25 м" });
    expect(segmentCost(p, "stonebridge").ok).toBe(true);
    expect(segmentCost(p, "bridge", effectiveSpans(withTechs("joinery"))).ok).toBe(true);
    const long = profile(water(6), 52);
    expect(segmentCost(long, "bridge", effectiveSpans(withTechs("joinery")))).toMatchObject({ ok: false, reason: "Пролёт 52 м: свайный мост держит до 45 м" });
    expect(segmentCost(profile(water(7), 70), "stonebridge", effectiveSpans()).reason).toBe("Пролёт 70 м: каменный мост держит до 60 м");
    expect(segmentCost(profile(water(7), 70), "stonebridge", effectiveSpans(withTechs("trusses"))).ok).toBe(true);
  });
  it("counts runs, not the total water", () => {
    const p = profile([...water(2), "meadow", ...water(2), "meadow", ...water(2)], 80); // 3 runs of 20 m
    expect(segmentCost(p, "bridge").ok).toBe(true);
  });
  it("ignores kinds that do not cross water and shares one check with the worker", () => {
    expect(spanReason("dirt", 500)).toBeNull();
    expect(spanReason("bridge", 30)).toBeNull();
    expect(spanReason("bridge", 31, effectiveSpans())).toContain("держит до 30 м");
  });
});

describe("stone roads", () => {
  it("are priced with their own stone and accept 20 % where dirt fails", () => {
    expect(ROAD_KINDS.stone).toMatchObject({ width: 5, labor: 2, stone: 0.01, maxGrade: 0.2, crossesWater: false });
    expect(ROAD_KINDS.stonebridge).toMatchObject({ width: 5, labor: 4, stone: 0.04, maxGrade: 0.12, crossesWater: true });
    const steep = profile(["meadow", "meadow"], 20, 0.15);
    expect(segmentCost(steep, "dirt").ok).toBe(false);
    const c = segmentCost(steep, "stone");
    expect(c.ok).toBe(true);
    expect(c.stone).toBeCloseTo(0.2);
    expect(segmentCost(profile(["meadow", "meadow"], 20, 0.25), "stone").ok).toBe(false);
    expect(segmentCost(profile(["meadow", "water"], 20), "stone").reason).toBe("Через воду нужен мост");
    expect(segmentCost(profile(["meadow", "meadow"], 20, 0.15), "stonebridge").reason).toContain("Слишком круто");
  });
  it("owe their stone per metre and share it when the edge is split", () => {
    let g = road("stone", [[0, 0], [100, 0]], [10]);
    expect(edges(g)[0].stone).toBeCloseTo(1);
    g = road("dirt", [[25, 0.5], [25, 80]], [10], g); // snaps to the stone edge and splits it
    const parts = edges(g).filter((e) => e.kind === "stone");
    expect(parts).toHaveLength(2);
    expect(parts.reduce((s, e) => s + (e.stone ?? 0), 0)).toBeCloseTo(1);
    expect(parts.find((e) => e.id === 3)!.stone).toBeCloseTo(0.25);
    expect(edges(road("dirt", [[0, 0], [50, 0]], [10])).every((e) => e.stone === undefined)).toBe(true);
  });
  it("take stone when work starts, only once", () => {
    const g = road("stone", [[0, 0], [100, 0]], [100]);
    const a = spendOnRoads(g, 10, stockOf(5));
    const e = a.roads.edges[3];
    expect(e.done).toBe(10);
    expect(e.stone).toBeUndefined();
    expect(a.stock!.stone).toBeCloseTo(4);
    const b = spendOnRoads(a.roads, 10, a.stock);
    expect(b.stock!.stone).toBeCloseTo(4);
    expect(b.roads.edges[3].done).toBe(20);
  });
  it("an edge waiting for stone is not construction work", () => {
    const g = road("stone", [[0, 0], [100, 0]], [100]);
    expect(constructionWork({}, g, [], stockOf(0.5))).toBe(false);
    expect(constructionWork({}, g, [], stockOf(50))).toBe(true);
    expect(constructionWork({}, g)).toBe(true);
  });
  it("wait without stone and let the hands go to the next edge", () => {
    let g = road("stone", [[0, 0], [100, 0]], [100]);
    g = road("dirt", [[0, 0], [0, 100]], [50], g);
    const dirt = edges(g).find((e) => e.kind === "dirt")!.id;
    expect(workableEdges(g)).toHaveLength(2);
    expect(workableEdges(g, stockOf(0.5))).toEqual([dirt]);
    expect(stoneWaiting(g, stockOf(0.5))).toEqual(new Set([3]));
    const r = spendOnRoads(g, 60, stockOf(0.5));
    expect(r.roads.edges[3].done).toBe(0);
    expect(r.roads.edges[3].stone).toBeCloseTo(1);
    expect(r.roads.edges[dirt].done).toBe(50);
    expect(r.left).toBe(10); // nobody can use them
    expect(r.stock!.stone).toBe(0.5);
    const after = spendOnRoads(r.roads, 10, stockOf(2));
    expect(after.roads.edges[3].done).toBe(10);
    expect(after.stock!.stone).toBeCloseTo(1);
  });
  it("are taken from the stock by the clock", () => {
    const g = road("stone", [[0, 0], [100, 0]], [1e6]);
    const sim = (stone: number): SimState => {
      const base = { realTime: NOW, gameMinutes: 7 * 60, roads: g, zones: emptyZones(), ...emptyGrowth(7, 0) } as SimState;
      return { ...base, stock: { ...base.stock, stone } };
    };
    const fed = advanceTo(sim(12), NOW + 3 * TICK_MS);
    expect(fed.roads.edges[3].done).toBeGreaterThan(0);
    expect(fed.roads.edges[3].stone).toBeUndefined();
    expect(fed.stock.stone).toBeCloseTo(11);
    const dry = advanceTo(sim(0.5), NOW + 3 * TICK_MS);
    expect(dry.roads.edges[3].done).toBe(0);
    expect(dry.stock.stone).toBeCloseTo(0.5);
  });
});

describe("locks and saves", () => {
  it("close the stone kinds until researched", () => {
    expect(lockReason({ progress: initialProgress() }, "stone")).toBe("Эпоха II");
    expect(lockReason({ progress: { ...initialProgress(), era: 2 } }, "stone")).toContain("Технология");
    expect(lockReason({ progress: withTechs("paving") }, "stone")).toBeNull();
    expect(lockReason({ progress: withTechs("paving") }, "stonebridge")).not.toBeNull();
    expect(lockReason({ progress: initialProgress() }, "dirt")).toBeNull();
  });
  it("round-trip an owed stone and load old edges", () => {
    let g = road("stone", [[0, 0], [100, 0]], [50]);
    g = road("dirt", [[0, 0], [0, 100]], [50], g);
    const sim = { realTime: NOW, gameMinutes: 0, roads: g, zones: emptyZones(), ...emptyGrowth(7, 0) } as SimState;
    const back = parseSave(JSON.parse(JSON.stringify({ version: 4, city, sim })), NOW + 1)!.sim.roads;
    expect(back.edges[3].stone).toBeCloseTo(1);
    expect("stone" in back.edges[5]).toBe(false);
    expect(back).toEqual(g);
    const bad = JSON.parse(JSON.stringify({ version: 4, city, sim }));
    bad.sim.roads.edges[3].stone = -1;
    expect(parseSave(bad, NOW + 1)).toBeNull();
  });
});

describe("worker addRoad", () => {
  const run = async (progress: ProgressState | undefined, cmd: Extract<Cmd, { type: "addRoad" }>) => {
    const sim = { realTime: NOW, gameMinutes: 0, roads: emptyRoads(), zones: emptyZones(), ...emptyGrowth(seedOf(city.foundedAt), 0), ...(progress ? { progress } : {}) };
    let stored: SaveV4 | undefined = { version: 4, city, sim } as SaveV4;
    const storage: Storage = { get: async () => stored, put: async (s) => void (stored = s), clear: async () => void (stored = undefined) };
    const out: FromWorker[] = [];
    const h = new Handler(storage, (m) => out.push(m));
    await h.handle({ t: "load", legacy: null, now: NOW });
    out.length = 0;
    await h.handle({ t: "cmd", id: 1, cmd });
    return out.find((m) => m.t === "cmdResult") as Extract<FromWorker, { t: "cmdResult" }>;
  };
  const base = { type: "addRoad" as const, pts: [[0, 0], [50, 0]] as [number, number][], snapTol: 5, labor: [10] };
  it("refuses a locked kind and takes it once researched", async () => {
    expect(await run(undefined, { ...base, kind: "stone" })).toMatchObject({ ok: false, reason: "Эпоха II" });
    expect(await run(withTechs("paving"), { ...base, kind: "stone" })).toMatchObject({ ok: true });
  });
  it("refuses a span over the limit with the techs counted", async () => {
    expect(await run(undefined, { ...base, kind: "bridge", span: 52 })).toMatchObject({ ok: false, reason: "Пролёт 52 м: свайный мост держит до 30 м" });
    expect(await run(withTechs("joinery"), { ...base, kind: "bridge", span: 52 })).toMatchObject({ ok: false, reason: "Пролёт 52 м: свайный мост держит до 45 м" });
    expect(await run(withTechs("joinery", "trusses"), { ...base, kind: "bridge", span: 52 })).toMatchObject({ ok: true });
    expect(await run(undefined, { ...base, kind: "bridge", span: Number.NaN })).toMatchObject({ ok: false });
  });
});
