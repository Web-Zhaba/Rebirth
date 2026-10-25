import { describe, expect, it } from "vitest";
import { Handler, type Storage, type TerrainSampler } from "./handler";
import type { FromWorker } from "./protocol";
import { addRoad, emptyRoads } from "./roads";
import { parseSave } from "./save";
import type { City, RoadGraph, RoadKind, SaveV4, TerrainInfo, ZoneCell } from "./types";
import { emptyZones, paintCells, qkey, regenerateCells, validateField, type FieldCheck } from "./zones";

const road = (g: RoadGraph, pts: [number, number][], kind: RoadKind = "dirt"): RoadGraph => {
  const r = addRoad(g, pts, kind, 1, pts.slice(1).map(() => 0));
  if (!r.ok) throw new Error(r.reason);
  return r.graph;
};

const meadow: TerrainInfo = { land: "meadow", slope: 0 };

// Terrain entries for every cell centre of a first (pending) generation.
function landFor(g: RoadGraph, override: Record<string, TerrainInfo> = {}): Record<string, TerrainInfo> {
  const t: Record<string, TerrainInfo> = {};
  for (const c of regenerateCells(g, [], [], {})) t[qkey(c.cx, c.cy)] = meadow;
  return { ...t, ...override };
}

const gen = (g: RoadGraph, old: ZoneCell[] = [], fields: { id: number; pts: [number, number][]; area: number }[] = []) =>
  regenerateCells(g, old, fields, landFor(g));
const byKey = (cells: ZoneCell[]) => new Map(cells.map((c) => [c.key, c]));

describe("cell generation", () => {
  it("80 m dirt edge: 10 per side, 4 deep, both sides", () => {
    const g = road(emptyRoads(), [[0, 0], [80, 0]]);
    const cells = regenerateCells(g, [], [], {});
    expect(cells).toHaveLength(80);
    expect(new Set(cells.map((c) => c.key)).size).toBe(80);
    expect(cells.every((c) => c.block === "pending")).toBe(true);
    const c = byKey(cells).get("3:1:0:0")!;
    // first left cell: along 0..8, across 2.5..10.5 (left of +x is +y)
    expect(c.cx).toBeCloseTo(4);
    expect(c.cy).toBeCloseTo(6.5);
    expect(byKey(cells).get("3:-1:9:3")!.cy).toBeCloseTo(-(2.5 + 24 + 4));
  });
  it("centres leftover length as margin", () => {
    const g = road(emptyRoads(), [[0, 0], [20, 0]], "path"); // k = 2, margin 2
    const cells = regenerateCells(g, [], [], {});
    expect(cells).toHaveLength(2 * 2 * 4);
    expect(byKey(cells).get("3:1:0:0")!.cx).toBeCloseTo(6);
    expect(byKey(cells).get("3:1:0:0")!.cy).toBeCloseTo(1 + 4);
  });
  it("is deterministic", () => {
    const g = road(road(emptyRoads(), [[0, 0], [160, 0]]), [[80, -100], [80, 100]]);
    expect(gen(g)).toEqual(gen(g));
  });
  it("a crossing road blocks its cells and those behind them", () => {
    let g = road(emptyRoads(), [[0, 0], [160, 0]]);
    g = road(g, [[80, -100], [80, 100]]);
    expect(g.nodes[g.edges[3].b].x).toBeCloseTo(80);
    const m = byKey(gen(g));
    for (let d = 0; d < 4; d++) expect(m.get(`3:1:9:${d}`)!.block).toBe("road"); // touches the crossing
    expect(m.get("3:1:8:0")!.block).toBeNull();
    expect(m.get("3:1:8:3")!.block).toBeNull();
    // vertical edge 8 runs (80,-100) -> (80,0); its last cells end 2 m from the other road
    expect(m.get("8:1:11:0")!.block).toBe("road");
    expect(m.get("8:1:11:3")!.block).toBe("road");
    expect(m.get("8:1:6:0")!.block).toBeNull();
  });
  it("depth continuity shades cells behind a blocked one", () => {
    const g = road(emptyRoads(), [[0, 0], [80, 0]]);
    const first = regenerateCells(g, [], [], {});
    const inner = first.find((c) => c.key === "3:1:3:1")!;
    const m = byKey(regenerateCells(g, [], [], { ...landFor(g), [qkey(inner.cx, inner.cy)]: { land: "water", slope: 0 } }));
    expect(m.get("3:1:3:0")!.block).toBeNull();
    expect(m.get("3:1:3:1")!.block).toBe("water");
    expect(m.get("3:1:3:2")!.block).toBe("water");
    expect(m.get("3:1:3:3")!.block).toBe("water");
  });
  it("parallel roads 40 m apart: the older edge wins the overlap", () => {
    let g = road(emptyRoads(), [[0, 0], [80, 0]]);
    g = road(g, [[0, 40], [80, 40]]);
    const m = gen(g);
    const older = m.filter((c) => c.edge === 3);
    const newer = m.filter((c) => c.edge === 6);
    expect(older.every((c) => c.block === null)).toBe(true);
    // newer edge's right side faces the older road: all of it is overlapped
    expect(newer.filter((c) => c.side === -1).every((c) => c.block === "overlap")).toBe(true);
    expect(newer.filter((c) => c.side === 1).every((c) => c.block === null)).toBe(true);
  });
  it("terrain: water, steep, pending", () => {
    const g = road(emptyRoads(), [[0, 0], [80, 0]]);
    const raw = byKey(regenerateCells(g, [], [], {}));
    const k = (key: string) => qkey(raw.get(key)!.cx, raw.get(key)!.cy);
    const terrain = {
      ...landFor(g),
      [k("3:1:0:0")]: { land: "water" as const, slope: 0 },
      [k("3:1:5:0")]: { land: "meadow" as const, slope: 10.5 },
      [k("3:1:7:0")]: { land: "forest" as const, slope: 9 },
    };
    delete (terrain as Record<string, TerrainInfo>)[k("3:-1:2:0")];
    const m = byKey(regenerateCells(g, [], [], terrain));
    expect(m.get("3:1:0:0")!.block).toBe("water");
    expect(m.get("3:1:5:0")!.block).toBe("steep");
    expect(m.get("3:1:7:0")!.block).toBeNull(); // forest is fine, 9 degrees is fine
    expect(m.get("3:-1:2:0")!.block).toBe("pending");
    expect(m.get("3:-1:2:1")!.block).toBe("pending");
    expect(m.get("3:-1:3:0")!.block).toBeNull();
  });
});

describe("painting", () => {
  it("paints unblocked cells only; none clears", () => {
    const g = road(road(emptyRoads(), [[0, 0], [160, 0]]), [[80, -100], [80, 100]]);
    const cells = gen(g);
    const blocked = cells.find((c) => c.block)!;
    const free = cells.find((c) => !c.block)!;
    const painted = paintCells(cells, [blocked.key, free.key], "res");
    expect(byKey(painted).get(blocked.key)!.zone).toBe("none");
    expect(byKey(painted).get(free.key)!.zone).toBe("res");
    expect(painted.filter((c) => c.zone !== "none")).toHaveLength(1);
    const cleared = paintCells(painted, [free.key], "none");
    expect(cleared.every((c) => c.zone === "none")).toBe(true);
    expect(cells.every((c) => c.zone === "none")).toBe(true); // input untouched
  });
  it("zones survive splitting the edge with a crossing road", () => {
    const g0 = road(emptyRoads(), [[0, 0], [160, 0]]);
    const cells0 = gen(g0);
    const painted = paintCells(cells0, cells0.filter((c) => !c.block).map((c) => c.key), "craft");
    expect(painted.filter((c) => c.zone === "craft")).toHaveLength(160);
    const g1 = road(g0, [[83, -100], [83, 100]]); // off the 8 m grid: the halves re-centre
    const after = regenerateCells(g1, painted, [], landFor(g1));
    const horizontal = after.filter((c) => c.edge === 3 || c.edge === 7);
    const free = horizontal.filter((c) => !c.block);
    expect(free.length).toBeGreaterThan(100);
    expect(free.every((c) => c.zone === "craft")).toBe(true);
    expect(horizontal.filter((c) => c.block).every((c) => c.zone === "none")).toBe(true);
    expect(after.filter((c) => c.edge > 7 && !c.block).every((c) => c.zone === "none")).toBe(true);
  });
});

const square = (x: number, y: number, s: number): [number, number][] => [[x, y], [x + s, y], [x + s, y + s], [x, y + s]];
const reason = (r: FieldCheck) => (r.ok ? "ok" : r.reason);

describe("fields", () => {
  const g = road(emptyRoads(), [[0, 0], [80, 0]]);
  it("accepts a valid polygon and stores it counter-clockwise", () => {
    const r = validateField(square(20, 20, 40).reverse(), g, []);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.area).toBeCloseTo(1600);
      const a = r.pts.reduce((s, p, i) => s + (r.pts[(i + 1) % 4][0] - p[0]) * (r.pts[(i + 1) % 4][1] + p[1]), 0);
      expect(a).toBeLessThan(0); // counter-clockwise
    }
  });
  it("rejects bad shapes and sizes", () => {
    expect(reason(validateField([[0, 0], [10, 10]], g, []))).toBe("Нужно минимум 3 точки");
    expect(reason(validateField([[20, 20], [60, 60], [60, 20], [20, 60]], g, []))).toBe("Контур пересекает сам себя");
    expect(reason(validateField(square(20, 20, 10), g, []))).toBe("Слишком маленькое поле");
    expect(reason(validateField(square(20, 20, 500), g, []))).toBe("Слишком большое поле");
  });
  it("rejects fields on a road, near a road, or on another field", () => {
    expect(reason(validateField(square(20, -20, 40), g, []))).toBe("Поле пересекает дорогу");
    expect(reason(validateField(square(20, 1, 40), g, []))).toBe("Поле пересекает дорогу"); // within 2.5 m
    expect(reason(validateField(square(20, 3, 40), g, []))).toBe("ok");
    const other = { id: 1, pts: square(20, 20, 40), area: 1600 };
    expect(reason(validateField(square(40, 40, 40), g, [other]))).toBe("Поле накладывается на другое");
    expect(reason(validateField(square(20, 20, 25), g, [other]))).toBe("Поле накладывается на другое"); // inside
    expect(reason(validateField(square(70, 20, 40), g, [other]))).toBe("ok");
  });
  it("blocks cells whose centre is inside a field", () => {
    const f = { id: 1, pts: square(20, 10, 40), area: 1600 };
    const cells = gen(g, [], [f]);
    const inField = cells.filter((c) => c.cx > 20 && c.cx < 60 && c.cy > 10 && c.cy < 50);
    expect(inField.length).toBeGreaterThan(0);
    expect(inField.filter((c) => c.block !== "field").map((c) => [c.key, c.cx, c.cy, c.block])).toEqual([]);
    expect(cells.find((c) => c.key === "3:1:0:0")!.block).toBeNull();
  });
});

describe("zones in the worker", () => {
  const NOW = 1_800_000_000_000;
  const city: City = { name: "Череповец", lat: 59.12, lng: 37.9, foundedAt: NOW - 1000 };
  function setup(initial?: unknown, sampler?: TerrainSampler) {
    let stored: unknown = initial;
    const storage: Storage = {
      get: async () => stored,
      put: async (s) => {
        stored = s;
      },
      clear: async () => {
        stored = undefined;
      },
    };
    const out: FromWorker[] = [];
    const h = new Handler(storage, (m) => out.push(m), sampler);
    return { h, out, get: () => stored as SaveV4 };
  }
  const fake: TerrainSampler = async () => meadow;
  const add = (h: Handler, id: number, pts: [number, number][]) =>
    h.handle({ t: "cmd", id, cmd: { type: "addRoad", kind: "dirt", pts, snapTol: 1, labor: [0] } });
  const lastSnap = (out: FromWorker[]) => [...out].reverse().find((m) => m.t === "snapshot") as Extract<FromWorker, { t: "snapshot" }>;

  it("cells regenerate after addRoad and terrain enrichment unblocks them", async () => {
    const { h, out, get } = setup(undefined, fake);
    await h.handle({ t: "found", city, now: NOW });
    await add(h, 1, [[0, 0], [80, 0]]);
    const first = out.find((m) => m.t === "snapshot") as Extract<FromWorker, { t: "snapshot" }>;
    expect(first.zones!.cells).toHaveLength(80);
    expect(first.zones!.cells.every((c) => c.block === "pending")).toBe(true);
    await h.idle();
    const done = lastSnap(out);
    expect(done.zones!.rev).toBeGreaterThan(first.zones!.rev);
    expect(done.zones!.cells.every((c) => c.block === null)).toBe(true);
    expect(get().sim.zones).toEqual(done.zones);
  });
  it("without a sampler cells stay pending", async () => {
    const { h, out } = setup();
    await h.handle({ t: "found", city, now: NOW });
    await add(h, 1, [[0, 0], [80, 0]]);
    await h.idle();
    expect(lastSnap(out).zones!.cells.every((c) => c.block === "pending")).toBe(true);
  });
  it("failed samples leave cells pending", async () => {
    const { h, out } = setup(undefined, async () => {
      throw new Error("offline");
    });
    await h.handle({ t: "found", city, now: NOW });
    await add(h, 1, [[0, 0], [80, 0]]);
    await h.idle();
    expect(lastSnap(out).zones!.cells.every((c) => c.block === "pending")).toBe(true);
    await h.handle({ t: "flush" }); // clear the retry timer promptly
    await h.handle({ t: "reset" });
  });
  it("paintZones persists and bumps rev; zones ride only on changed snapshots", async () => {
    const { h, out, get } = setup(undefined, fake);
    await h.handle({ t: "found", city, now: NOW });
    await add(h, 1, [[0, 0], [80, 0]]);
    await h.idle();
    const rev = get().sim.zones.rev;
    out.length = 0;
    await h.handle({ t: "cmd", id: 2, cmd: { type: "paintZones", keys: ["3:1:0:0", "3:1:1:0", "nope"], zone: "res" } });
    expect(out.map((m) => m.t)).toEqual(["snapshot", "cmdResult"]);
    expect(out[1]).toMatchObject({ ok: true });
    expect(get().sim.zones.rev).toBe(rev + 1);
    expect(get().sim.zones.cells.filter((c) => c.zone === "res")).toHaveLength(2);
    expect(lastSnap(out).zones!.rev).toBe(rev + 1);
    out.length = 0;
    h.tick(NOW + 10_000);
    expect(lastSnap(out).zones).toBeUndefined();
    await h.handle({ t: "cmd", id: 3, cmd: { type: "paintZones", keys: ["3:1:0:0"], zone: "bogus" as never } });
    expect(out.at(-1)).toMatchObject({ t: "cmdResult", ok: false });
  });
  it("addField rejected and accepted; removeField", async () => {
    const { h, out, get } = setup(undefined, fake);
    await h.handle({ t: "found", city, now: NOW });
    await add(h, 1, [[0, 0], [80, 0]]);
    await h.idle();
    out.length = 0;
    await h.handle({ t: "cmd", id: 2, cmd: { type: "addField", pts: square(20, -20, 40) } });
    expect(out).toEqual([{ t: "cmdResult", id: 2, ok: false, reason: "Поле пересекает дорогу" }]);
    out.length = 0;
    await h.handle({ t: "cmd", id: 3, cmd: { type: "addField", pts: square(20, 40, 40) } });
    expect(out.map((m) => m.t)).toEqual(["snapshot", "cmdResult"]);
    expect(get().sim.zones.fields).toHaveLength(1);
    expect(get().sim.zones.fields[0].id).toBe(1);
    await h.idle();
    out.length = 0;
    await h.handle({ t: "cmd", id: 4, cmd: { type: "removeField", id: 1 } });
    expect(get().sim.zones.fields).toHaveLength(0);
    await h.handle({ t: "cmd", id: 5, cmd: { type: "removeField", id: 1 } });
    expect(out.at(-1)).toMatchObject({ t: "cmdResult", ok: false });
  });
});

describe("save with zones", () => {
  const NOW = 1_800_000_000_000;
  const city: City = { name: "Череповец", lat: 59.12, lng: 37.9, foundedAt: NOW - 1000 };
  const base = { version: 4, city, sim: { realTime: NOW, gameMinutes: 5, roads: emptyRoads() } };
  it("loads a save without zones as empty zones", () => {
    expect(parseSave(base, NOW)!.sim.zones).toEqual(emptyZones());
  });
  it("round-trips valid zones and drops broken ones without losing the town", () => {
    const g = road(emptyRoads(), [[0, 0], [80, 0]]);
    const zones = {
      cells: paintCells(gen(g), ["3:1:0:0"], "trade"),
      fields: [{ id: 1, pts: square(20, 40, 40), area: 1600 }],
      terrain: { "0:0": meadow },
      rev: 4,
    };
    const ok = { ...base, sim: { ...base.sim, roads: g, zones } };
    expect(parseSave(ok, NOW)!.sim.zones).toEqual(zones);
    const withZones = (z: unknown) => ({ ...base, sim: { ...base.sim, roads: g, zones: z } });
    const broken = [
      null,
      { ...zones, rev: -1 },
      { ...zones, cells: [{ ...zones.cells[0], zone: "farm" }] },
      { ...zones, cells: [{ ...zones.cells[0], depth: 4 }] },
      { ...zones, fields: [{ id: 1, pts: [[0, 0], [1, 1]], area: 5 }] },
      { ...zones, terrain: { "0:0": { land: "lava", slope: 1 } } },
    ];
    for (const z of broken) {
      const s = parseSave(withZones(z), NOW)!;
      expect(s.sim.zones).toEqual(emptyZones());
      expect(s.sim.roads).toEqual(g);
    }
  });
});
