import { YEAR_MIN } from "./time";
import { describe, expect, it } from "vitest";
import { advanceTo, BASE_TICK, step, TICK_MS } from "./clock";
import { BUILDINGS } from "./buildings";
import { advanceBuildings, demand, emptyGrowth, nextRandom, reconcile, seedOf, townStats } from "./growth";
import { builderCount, peopleStats } from "./people";
import { addRoad, emptyRoads, removeEdge } from "./roads";
import { parseSave } from "./save";
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
  it("founders in tents: houses wanted, no other buildings", () => {
    const s = world(emptyRoads(), () => "none");
    expect(peopleStats(s)).toMatchObject({ pop: 10, tents: 3, households: 3 });
    const d = demand(s);
    expect(d.res).toBeCloseTo(1.5 + 3);
    // nobody is busy building anything, so the founders count as unemployed
    expect(d.craft).toBeCloseTo((0.2 * 10) / 3 + peopleStats(s).unemployed / 6);
    expect(d.trade).toBeLessThan(1);
  });
  it("vacant and unfinished houses cut res demand, vacancies raise it", () => {
    const s = ticks(world(straight(), "res"), 1);
    const b = list(s)[0];
    const planned = demand(s);
    expect(planned.res).toBeCloseTo(1.5 + 3 - 1); // one unfinished house
    const active = { ...s, buildings: { 1: { ...b, state: "active" as const } } };
    expect(demand(active).res).toBeCloseTo(1.5 + 3 - 1); // one vacant house
    const shop = { ...b, id: 2, zone: "trade" as const, template: "shop", state: "active" as const };
    expect(demand({ ...active, buildings: { ...active.buildings, 2: shop } }).res).toBeCloseTo(1.5 + 3 - 1 + 1); // 2 vacancies / 2
    expect(townStats(active.buildings)).toMatchObject({ houseCap: BUILDINGS[b.template].residents, unfinishedHouses: 0 });
  });
});

describe("spawning", () => {
  it("no spawn without demand", () => {
    const s = ticks({ ...world(straight(), "craft"), residents: {}, households: {} }, 20);
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
    const g = road(s.roads, [[0, 0], [0, -40]], 10); // unbuilt, starts at the founding point
    const idB = Math.max(...Object.keys(g.edges).map(Number));
    s = { ...s, roads: g, gameMinutes: at7, lastSpawn: { res: at7, craft: at7, trade: at7 } };
    const per = (builderCount(s) * BASE_TICK) / 60;
    expect(builderCount(s)).toBe(6); // the adults of the founding households
    s = ticks(s, 5);
    expect(s.roads.edges[idB].done).toBeCloseTo(5 * per);
    expect(s.buildings[1].done).toBe(0);
    s = ticks(s, 12); // the road finishes during these ticks, the rest goes to the house
    expect(s.roads.edges[idB].done).toBe(10);
    expect(s.buildings[1].done).toBeCloseTo(17 * per - 10);
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
  it("construction speed follows the number of jobless adults", () => {
    let s = ticks(world(straight(), "res"), 1);
    const b = s.buildings[1];
    s = { ...s, gameMinutes: at7, lastSpawn: { res: at7, craft: at7, trade: at7 }, buildings: { 1: b } };
    expect(builderCount(s)).toBe(6);
    expect(step(s).buildings[1].done).toBeCloseTo((6 * BASE_TICK) / 60);
    // two adults get regular jobs: fewer hands on the site
    const adults = Object.values(s.residents).filter((r) => r.born < -16 * YEAR_MIN + at7);
    const busy = { ...s.residents };
    for (const r of adults.slice(0, 2)) busy[r.id] = { ...r, job: 99, commute: 5 };
    const s2 = { ...s, residents: busy };
    expect(builderCount(s2)).toBe(4);
    expect(step(s2).buildings[1].done).toBeCloseTo((4 * BASE_TICK) / 60);
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
    const end = NOW + 5 * 24 * 60 * 1000; // five game days: births, deaths, migration all get a chance
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
    expect(once.gameMinutes).toBeGreaterThanOrEqual(5 * 24 * 60 - BASE_TICK);
    expect(once.rng).not.toBe(start.rng);
    expect(TICK_MS).toBe(10_000);
  });
});

describe("save", () => {
  const city: City = { name: "Череповец", lat: 59.12, lng: 37.9, foundedAt: NOW - 1000 };
  const withSim = (extra: Record<string, unknown>) => ({
    version: 4,
    city,
    sim: { realTime: NOW, gameMinutes: 5, roads: emptyRoads(), ...extra },
  });

  it("a save without growth fields loads with defaults", () => {
    const s = parseSave(withSim({}), NOW)!;
    expect(s.sim).toMatchObject(emptyGrowth(seedOf(city.foundedAt), 5));
    expect(Object.keys(s.sim.residents)).toHaveLength(10);
    expect(s.sim.zones).toEqual(emptyZones());
  });
  it("round-trips buildings and the generator", () => {
    const sim = ticks(world(straight(), "res"), 8);
    expect(list(sim).length).toBeGreaterThan(0);
    const raw = JSON.parse(JSON.stringify(sim)) as Record<string, unknown>;
    const s = parseSave(withSim({ ...raw, roads: sim.roads, realTime: NOW, gameMinutes: 5 }), NOW)!;
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
      const s = parseSave(withSim({ roads, buildings, nextBuildingId: 2, rng: 5, lastSpawn: { res: 0, craft: 0, trade: 0 } }), NOW)!;
      expect(s).not.toBeNull();
      expect(s.sim.buildings).toEqual({});
      expect(s.sim.nextBuildingId).toBe(1);
      expect(s.sim.roads).toEqual(roads);
    }
    const noNext = parseSave(withSim({ roads, buildings: { 1: b } }), NOW)!;
    expect(noNext.sim.buildings).toEqual({});
    const badRng = parseSave(withSim({ rng: -3, lastSpawn: { res: "x" } }), NOW)!;
    expect(badRng.sim).toMatchObject(emptyGrowth(seedOf(city.foundedAt), 5));
  });
});
