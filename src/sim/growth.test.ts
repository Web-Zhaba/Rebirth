import { describe, expect, it } from "vitest";
import { advanceTo, BASE_TICK, step, TICK_MS } from "./clock";
import { BUILDINGS } from "./buildings";
import { advanceBuildings, demand, emptyGrowth, nextRandom, reconcile, seedOf, townStats, workforce } from "./growth";
import { addRoad, emptyRoads, removeEdge } from "./roads";
import { parseSaveV3 } from "./save";
import type { Building, City, RoadGraph, SimState, TerrainInfo, ZoneCell, ZoneType } from "./types";
import { emptyZones, paintCells, qkey, regenerateCells, signedArea } from "./zones";

const NOW = 1_800_000_000_000;
const meadow: TerrainInfo = { land: "meadow", slope: 0 };

const road = (g: RoadGraph, pts: [number, number][], labor = 0): RoadGraph => {
  const r = addRoad(g, pts, "dirt", 1, pts.slice(1).map(() => labor));
  if (!r.ok) throw new Error(r.reason);
  return r.graph;
};

function landFor(g: RoadGraph): Record<string, TerrainInfo> {
  const t: Record<string, TerrainInfo> = {};
  for (const c of regenerateCells(g, [], [], {})) t[qkey(c.cx, c.cy)] = meadow;
  return t;
}

type ZoneFn = ZoneType | ((c: ZoneCell) => ZoneType | "none");

// A state whose cells are generated and zoned; gameMinutes 0 is 06:00 (nobody works yet).
function world(g: RoadGraph, zone: ZoneFn, gameMinutes = 0): SimState {
  const terrain = landFor(g);
  const cells = regenerateCells(g, [], [], terrain).map((c) => {
    const z = typeof zone === "function" ? zone(c) : zone;
    return !c.block && z !== "none" ? { ...c, zone: z } : c;
  });
  return { realTime: NOW, gameMinutes, roads: g, zones: { ...emptyZones(), cells, terrain, rev: 1 }, ...emptyGrowth(42) };
}

const ticks = (s: SimState, n: number) => {
  for (let i = 0; i < n; i++) s = step(s);
  return s;
};
const list = (s: SimState) => Object.values(s.buildings);
const allZones = (s: SimState, zone: "none" | ZoneType) =>
  paintCells(s.zones.cells, s.zones.cells.map((c) => c.key), zone);

const straight = () => road(emptyRoads(), [[0, 0], [160, 0]]);

describe("rng", () => {
  it("is deterministic and in [0, 1)", () => {
    let a = 7;
    let b = 7;
    for (let i = 0; i < 100; i++) {
      const [x, na] = nextRandom(a);
      const [y, nb] = nextRandom(b);
      expect(x).toBe(y);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
      a = na;
      b = nb;
    }
  });
});

describe("demand", () => {
  it("empty town wants houses only", () => {
    const d = demand({ buildings: {} });
    expect(d.res).toBeCloseTo(4);
    expect(d.craft).toBeLessThan(1);
    expect(d.trade).toBeLessThan(1);
  });
  it("finished houses raise craft demand; planned ones do not count as population", () => {
    const s = ticks(world(straight(), "res"), 1);
    const b = list(s)[0];
    expect(townStats(s.buildings).pop).toBe(10);
    const active = { 1: { ...b, state: "active" as const } };
    expect(townStats(active).pop).toBe(10 + BUILDINGS[b.template].residents);
    expect(demand({ buildings: active }).craft).toBeGreaterThan(0.83);
  });
});

describe("spawning", () => {
  it("no spawn without demand", () => {
    const s = ticks(world(straight(), "craft"), 20);
    expect(list(s)).toHaveLength(0);
    expect(s.rng).toBe(emptyGrowth(42).rng); // no random draw either
  });
  it("no spawn on unbuilt roads", () => {
    const s = ticks(world(road(emptyRoads(), [[0, 0], [160, 0]], 500), "res"), 20);
    expect(list(s)).toHaveLength(0);
  });
  it("picks a fitting lot facing the road with a 2 m front setback", () => {
    const s = ticks(world(straight(), "res"), 1);
    const [b] = list(s);
    expect(b).toMatchObject({ zone: "res", state: "planned", done: 0 });
    const t = BUILDINGS[b.template];
    expect(t.zone).toBe("res");
    expect(b.lot).toMatchObject({ w: t.w, d: t.d });
    expect(b.footprint).toHaveLength(4);
    expect(signedArea(b.footprint)).toBeGreaterThan(0);
    const ys = b.footprint.map((p) => Math.abs(p[1]));
    const xs = b.footprint.map((p) => p[0]);
    expect(Math.min(...ys)).toBeCloseTo(2.5 + 2); // road half width + setback
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(t.deep);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(t.along);
    expect(Math.sign(b.footprint[0][1])).toBe(b.side);
    // the lot lies inside the zoned strip
    const front = Math.abs(b.lot.cy) - (8 * t.d) / 2;
    expect(front).toBeCloseTo(2.5);
  });
  it("handles roads in any direction and on both sides", () => {
    const g = road(emptyRoads(), [[0, 0], [100, 100]]);
    for (const side of [1, -1]) {
      const s = ticks(world(g, (c) => (c.side === side ? "res" : "none")), 1);
      const [b] = list(s);
      expect(b.side).toBe(side);
      expect(signedArea(b.footprint)).toBeGreaterThan(0);
      // distance of every footprint corner from the road line y = x
      const d = b.footprint.map((p) => Math.abs(p[0] - p[1]) / Math.SQRT2);
      expect(Math.min(...d)).toBeCloseTo(4.5);
    }
  });
  it("one new building per zone type per game hour", () => {
    let s = world(straight(), (c) => (c.side === 1 ? "res" : "craft"));
    s = step(s);
    expect(list(s)).toHaveLength(1);
    // a finished house makes craft demand reach 1
    s = { ...s, buildings: { 1: { ...s.buildings[1], state: "active" } } };
    s = step(s);
    expect(list(s).map((b) => b.zone)).toEqual(["res", "craft"]);
    s = ticks(s, 4); // game minute 60: the res hour started at minute 10
    expect(list(s).filter((b) => b.zone === "res")).toHaveLength(1);
    s = step(s); // minute 70
    expect(list(s).filter((b) => b.zone === "res")).toHaveLength(2);
    expect(list(s).filter((b) => b.zone === "craft")).toHaveLength(1); // craft: not before minute 80
  });
  it("never reuses occupied cells", () => {
    const s = ticks(world(road(emptyRoads(), [[0, 0], [80, 0]]), "res"), 300);
    const bs = list(s);
    expect(bs.length).toBeGreaterThan(1);
    const centresIn = (b: Building) =>
      s.zones.cells.filter((c) => {
        const dx = c.cx - b.lot.cx;
        const dy = c.cy - b.lot.cy;
        const co = Math.cos(b.lot.angle);
        const si = Math.sin(b.lot.angle);
        return Math.abs(dx * co + dy * si) < 4 * b.lot.w && Math.abs(-dx * si + dy * co) < 4 * b.lot.d;
      });
    const seen = new Set<string>();
    for (const b of bs) {
      const cells = centresIn(b);
      expect(cells).toHaveLength(b.lot.w * b.lot.d);
      for (const c of cells) {
        expect(seen.has(c.key)).toBe(false);
        seen.add(c.key);
      }
    }
  });
});

describe("construction", () => {
  const at7 = 60; // game minutes since 06:00 -> 07:00, work starts
  it("roads first, then buildings FIFO", () => {
    let s = ticks(world(straight(), "res"), 1);
    const g = road(s.roads, [[0, 0], [0, -40]], 20); // unbuilt, starts at the founding point
    const idB = Math.max(...Object.keys(g.edges).map(Number));
    s = { ...s, roads: g, gameMinutes: at7, lastSpawn: { res: at7, craft: at7, trade: at7 } };
    const per = (10 * BASE_TICK) / 60;
    s = ticks(s, 5);
    expect(s.roads.edges[idB].done).toBeCloseTo(5 * per);
    expect(s.buildings[1].done).toBe(0);
    s = ticks(s, 12); // the road finishes during these ticks, the rest goes to the house
    expect(s.roads.edges[idB].done).toBe(20);
    expect(s.buildings[1].done).toBeCloseTo(17 * per - 20);
    expect(s.buildings[1].state).toBe("building");
  });
  it("buildings are served lowest id first and become active when done", () => {
    const base = ticks(world(straight(), "res"), 1).buildings[1];
    const two = { 1: { ...base, labor: 10 }, 2: { ...base, id: 2, labor: 10 } };
    const a = advanceBuildings(two, 15);
    expect(a[1]).toMatchObject({ state: "active", done: 10 });
    expect(a[2]).toMatchObject({ state: "building", done: 5 });
    expect(advanceBuildings(a, 0)).toBe(a);
    expect(advanceBuildings({ 1: { ...base, state: "active", done: base.labor } }, 5)).toEqual({ 1: { ...base, state: "active", done: base.labor } });
  });
  it("workforce grows with active houses", () => {
    let s = ticks(world(straight(), "res"), 1);
    const b = s.buildings[1];
    expect(workforce(s.buildings)).toBe(10);
    s = {
      ...s,
      gameMinutes: at7,
      lastSpawn: { res: at7, craft: at7, trade: at7 },
      buildings: { 1: { ...b, state: "active", done: b.labor }, 2: { ...b, id: 2 } },
    };
    expect(workforce(s.buildings)).toBe(11);
    s = step(s);
    expect(s.buildings[2].done).toBeCloseTo((11 * BASE_TICK) / 60);
  });
});

describe("reconcile", () => {
  // Zone only the first 40 m of the left side, so the lot is far from a crossing road at x = 120.
  const left = (c: ZoneCell) => (c.side === 1 && c.i < 5 ? "res" : "none");
  const grown = () => ticks(world(straight(), left), 1);

  it("keeps a building whose surroundings are intact", () => {
    const s = grown();
    expect(reconcile(s.buildings, s.roads, s.zones.cells)).toBe(s.buildings);
  });
  it("removes it when its road is removed", () => {
    const s = grown();
    const g = removeEdge(s.roads, 3);
    const cells = regenerateCells(g, s.zones.cells, [], s.zones.terrain);
    expect(reconcile(s.buildings, g, cells)).toEqual({});
  });
  it("removes it when its zone is cleared, keeps it when only a little is", () => {
    const s = grown();
    const b = s.buildings[1];
    const lotCells = s.zones.cells.filter((c) => Math.hypot(c.cx - b.lot.cx, c.cy - b.lot.cy) < 14 && c.zone === "res");
    expect(lotCells.length).toBeGreaterThan(0);
    expect(reconcile(s.buildings, s.roads, allZones(s, "none"))).toEqual({});
    const one = paintCells(s.zones.cells, [lotCells[0].key], "none");
    expect(reconcile(s.buildings, s.roads, one)).toBe(s.buildings);
  });
  it("keeps it when an unrelated crossing road splits its edge", () => {
    const s = grown();
    const g = road(s.roads, [[120, -100], [120, 100]]);
    expect(Object.keys(g.edges).length).toBeGreaterThan(1);
    const cells = regenerateCells(g, s.zones.cells, [], landFor(g));
    expect(reconcile(s.buildings, g, cells)).toBe(s.buildings);
  });
});

describe("determinism", () => {
  it("one advanceTo call equals many random-sized ones, with growth happening", () => {
    const start = world(road(emptyRoads(), [[0, 0], [160, 0]]), (c) => (c.side === 1 ? (c.i < 10 ? "res" : "craft") : "trade"));
    const end = NOW + 14 * 3600 * 1000;
    let t = NOW;
    let s = start;
    let seed = 11;
    while (t < end) {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      t += seed % 5000;
      s = advanceTo(s, t);
    }
    const once = advanceTo(start, t);
    expect(s).toEqual(once);
    expect(list(once).length).toBeGreaterThan(0);
    expect(list(once).some((b) => b.done > 0)).toBe(true);
    expect(once.gameMinutes).toBeGreaterThanOrEqual(14 * 60 - BASE_TICK);
    expect(TICK_MS).toBe(10_000);
  });
});

describe("save", () => {
  const city: City = { name: "Череповец", lat: 59.12, lng: 37.9, foundedAt: NOW - 1000 };
  const withSim = (extra: Record<string, unknown>) => ({
    version: 3,
    city,
    sim: { realTime: NOW, gameMinutes: 5, roads: emptyRoads(), ...extra },
  });

  it("a save without growth fields loads with defaults", () => {
    const s = parseSaveV3(withSim({}), NOW)!;
    expect(s.sim).toMatchObject(emptyGrowth(seedOf(city.foundedAt)));
    expect(s.sim.zones).toEqual(emptyZones());
  });
  it("round-trips buildings and the generator", () => {
    const sim = ticks(world(straight(), "res"), 8);
    expect(list(sim).length).toBeGreaterThan(0);
    const raw = JSON.parse(JSON.stringify(sim)) as Record<string, unknown>;
    const s = parseSaveV3(withSim({ ...raw, roads: sim.roads, realTime: NOW, gameMinutes: 5 }), NOW)!;
    expect(s.sim.buildings).toEqual(sim.buildings);
    expect(s.sim.nextBuildingId).toBe(sim.nextBuildingId);
    expect(s.sim.rng).toBe(sim.rng);
    expect(s.sim.lastSpawn).toEqual(sim.lastSpawn);
  });
  it("broken buildings reset the buildings, not the town", () => {
    const sim = ticks(world(straight(), "res"), 1);
    const b = sim.buildings[1];
    const roads = sim.roads;
    const bad: unknown[] = [
      { 1: { ...b, template: "palace" } },
      { 1: { ...b, state: "ruined" } },
      { 1: { ...b, done: b.labor + 1 } },
      { 1: { ...b, footprint: b.footprint.slice(0, 3) } },
      { 1: { ...b, id: 2 } },
      { 1: { ...b, zone: "trade" } },
      { 1: { ...b, side: 0 } },
      { 1: { ...b, lot: { ...b.lot, w: 0 } } },
      { 5: { ...b, id: 5 } }, // id beyond nextBuildingId
      [],
      "x",
    ];
    for (const buildings of bad) {
      const s = parseSaveV3(withSim({ roads, buildings, nextBuildingId: 2, rng: 5, lastSpawn: { res: 0, craft: 0, trade: 0 } }), NOW)!;
      expect(s).not.toBeNull();
      expect(s.sim.buildings).toEqual({});
      expect(s.sim.nextBuildingId).toBe(1);
      expect(s.sim.roads).toEqual(roads);
    }
    const noNext = parseSaveV3(withSim({ roads, buildings: { 1: b } }), NOW)!;
    expect(noNext.sim.buildings).toEqual({});
    const badRng = parseSaveV3(withSim({ rng: -3, lastSpawn: { res: "x" } }), NOW)!;
    expect(badRng.sim).toMatchObject(emptyGrowth(seedOf(city.foundedAt)));
  });
});
