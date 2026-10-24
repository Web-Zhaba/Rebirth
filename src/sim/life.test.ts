import { describe, expect, it } from "vitest";
import { BUILDINGS } from "./buildings";
import { emptyGrowth } from "./growth";
import { Handler, type Storage } from "./handler";
import { CART_SPEED, computeLife, HOME_AT, LOAD, MAX_CARTS, MAX_WALKERS, TO_WORK, WORK_FROM, WORK_TO } from "./life";
import { WALK_SPEED } from "./people";
import type { FromWorker } from "./protocol";
import { addRoad, emptyRoads } from "./roads";
import { YEAR_MIN } from "./time";
import type { Building, City, Household, Resident, RoadGraph, SimState } from "./types";
import { emptyZones } from "./zones";
import type { Trip } from "../map/lifeLayer";

const NOW = 1_800_000_000_000;
const GM = 1080;

const lay = (g: RoadGraph, pts: [number, number][], labor = 0): RoadGraph => {
  const r = addRoad(g, pts, "dirt", 1, pts.slice(1).map(() => labor));
  if (!r.ok) throw new Error(r.reason);
  return r.graph;
};
// A built road along the x axis with a node every 100 m.
const roadAlong = (len = 3000): RoadGraph => lay(emptyRoads(), Array.from({ length: len / 100 + 1 }, (_, i): [number, number] => [i * 100, 0]));
// A built grid of n x n streets, 100 m apart.
function grid(n: number): RoadGraph {
  let g = emptyRoads();
  for (let i = 0; i < n; i++) {
    g = lay(g, [[0, i * 100], [(n - 1) * 100, i * 100]]);
    g = lay(g, [[i * 100, 0], [i * 100, (n - 1) * 100]]);
  }
  return g;
}

// A building whose door (lot front) is at (x, y + 3).
function building(id: number, template: string, x: number, y = 0, state: Building["state"] = "active"): Building {
  const t = BUILDINGS[template];
  return {
    id,
    template,
    zone: t.zone,
    lot: { cx: x, cy: y + 3 + 4 * t.d, angle: 0, w: t.w, d: t.d },
    side: 1,
    footprint: [[x, y + 5], [x + 1, y + 5], [x + 1, y + 6], [x, y + 6]],
    height: t.height,
    state,
    labor: t.labor,
    done: state === "active" ? t.labor : 0,
    created: 0,
    paid: true,
    level: 1,
    streak: 0,
  };
}

interface Home {
  home: number | null;
  jobs: (number | null)[]; // one adult per entry
}

function town(bs: Building[], homes: Home[], roads: RoadGraph = roadAlong()): SimState {
  const buildings: Record<number, Building> = {};
  for (const b of bs) buildings[b.id] = b;
  const residents: Record<number, Resident> = {};
  const households: Record<number, Household> = {};
  let pid = 1;
  homes.forEach((sp, i) => {
    const members: number[] = [];
    for (const job of sp.jobs) {
      const id = pid++;
      residents[id] = { id, first: "Иван", last: "Тестов", sex: "m", born: GM - 30 * YEAR_MIN, household: i + 1, spouse: null, job, commute: job === null ? null : 5, idleDays: 0, literate: false, school: 0 };
      members.push(id);
    }
    households[i + 1] = { id: i + 1, last: "Тестов", home: sp.home, members, arrived: 0, founder: false, mood: 60 };
  });
  return {
    realTime: NOW,
    gameMinutes: GM,
    roads,
    zones: emptyZones(),
    ...emptyGrowth(7, GM),
    buildings,
    nextBuildingId: bs.length + 1,
    residents,
    households,
    nextPersonId: pid,
    nextHouseholdId: homes.length + 1,
    events: [],
  };
}

const walks = (trips: Trip[]) => trips.filter((t) => t.kind === "walk");
const carts = (trips: Trip[]) => trips.filter((t) => t.kind === "cart");
const edgeBetween = (g: RoadGraph, x0: number, x1: number) =>
  Object.values(g.edges).find((e) => [g.nodes[e.a].x, g.nodes[e.b].x].sort((p, q) => p - q).join() === [x0, x1].join())!.id;

describe("walkers", () => {
  it("arrive by 07:00 and leave from 19:00", () => {
    const bs = [...Array.from({ length: 30 }, (_, i) => building(i + 1, "izba", 100 + i * 100)), building(100, "smithy", 3000), building(101, "shop", 2000)];
    const s = town(bs, Array.from({ length: 30 }, (_, i) => ({ home: i + 1, jobs: [i % 2 ? 100 : 101] })));
    const w = walks(computeLife(s).trips);
    expect(w).toHaveLength(60);
    for (const t of w) {
      expect(t.speed).toBeCloseTo(WALK_SPEED, 9);
      const len = t.pts.slice(1).reduce((a, p, i) => a + Math.hypot(p[0] - t.pts[i][0], p[1] - t.pts[i][1]), 0);
      if (t.id % 2 === 0) {
        expect(t.depart).toBeGreaterThanOrEqual(TO_WORK);
        expect(t.depart).toBeLessThan(TO_WORK + 60);
        expect(t.depart + len / t.speed).toBeLessThanOrEqual(WORK_FROM + 1e-6);
      } else {
        expect(t.depart).toBeGreaterThanOrEqual(HOME_AT);
        expect(t.depart).toBeLessThan(HOME_AT + 60);
      }
    }
    // the way back is the way there reversed
    const out = w.find((t) => t.id === 2)!;
    const back = w.find((t) => t.id === 3)!;
    expect(back.pts).toEqual([...out.pts].reverse());
    expect(out.pts[0][1]).toBeCloseTo(3, 6); // starts at the door
  });
  it("sends at most 300 commuters but counts them all in the traffic", () => {
    const bs = [...Array.from({ length: 100 }, (_, i) => building(i + 1, "izba", 100 + (i % 20) * 100)), building(200, "smithy", 2500)];
    const s = town(bs, Array.from({ length: 100 }, (_, i) => ({ home: i + 1, jobs: [200, 200, 200, 200] })));
    const l = computeLife(s);
    expect(walks(l.trips)).toHaveLength(MAX_WALKERS * 2);
    expect(new Set(walks(l.trips).map((t) => t.id >> 1)).size).toBe(MAX_WALKERS);
    // all 400 commuters pass the last edge before the smithy, from every home
    expect(l.traffic[edgeBetween(s.roads, 2400, 2500)]).toBe(400);
  });
  it("skips commuters without a finished home", () => {
    const bs = [building(1, "izba", 100), building(2, "izba", 200, 0, "building"), building(3, "smithy", 1000)];
    const s = town(bs, [{ home: 1, jobs: [3, null] }, { home: 2, jobs: [3] }, { home: null, jobs: [3] }]);
    expect(walks(computeLife(s).trips)).toHaveLength(2);
  });
});

describe("traffic", () => {
  it("counts commuters per edge, both directions, each once", () => {
    const bs = [building(1, "izba", 100), building(2, "izba", 200), building(3, "smithy", 1000), building(4, "shop", 100), building(5, "izba", 1000)];
    // A: 100 -> 1000, B: 200 -> 1000, C: 1000 -> 100 (the other way)
    const s = town(bs, [{ home: 1, jobs: [3] }, { home: 2, jobs: [3] }, { home: 5, jobs: [4] }]);
    const { traffic } = computeLife(s);
    const e = (a: number, b: number) => traffic[edgeBetween(s.roads, a, b)] ?? 0;
    expect(e(100, 200)).toBe(2); // A and C
    expect(e(200, 300)).toBe(3); // A, B and C
    expect(e(900, 1000)).toBe(3);
    expect(e(1000, 1100)).toBe(0);
    expect(e(0, 100)).toBe(0);
  });
  it("ignores unbuilt edges", () => {
    const g = lay(roadAlong(300), [[300, 0], [400, 0]], 50);
    const s = town([building(1, "izba", 100), building(2, "smithy", 400)], [{ home: 1, jobs: [2] }], g);
    const { traffic } = computeLife(s);
    expect(edgeBetween(g, 300, 400) in traffic).toBe(false);
    expect(Object.keys(traffic)).toHaveLength(2); // 100..200 and 200..300; the work door steps onto node 300
  });
});

describe("carts", () => {
  const withMade = (id: number, template: string, made: number, x = 500): SimState => {
    const s = town([building(id, template, x)], []);
    return { ...s, prod: { ...s.prod, yesterday: { [id]: made } } };
  };
  it("one cart per load, producer to camp at 3 km/h", () => {
    const cases: [string, number, number][] = [["woodcutter", 11, 3], ["sawpit", 4, 2], ["quarry", 9.5, 4], ["fisher", 501, 2], ["pottery", 20, 1], ["smithy", 41, 3]];
    for (const [template, made, n] of cases) {
      const t = carts(computeLife(withMade(1, template, made)).trips);
      expect(t, template).toHaveLength(n);
      for (const c of t) {
        expect(c.speed).toBeCloseTo(CART_SPEED, 9);
        expect(c.depart).toBeGreaterThanOrEqual(WORK_FROM);
        expect(c.depart).toBeLessThan(WORK_TO);
        expect(c.pts[0][0]).toBe(500);
        expect(c.pts[c.pts.length - 1]).toEqual([0, 0]);
      }
    }
    expect(LOAD).toEqual({ logs: 5, planks: 2, stone: 3, food: 500, wares: 20 });
  });
  it("caps at 6 carts a producer and sends none when nothing was made", () => {
    expect(carts(computeLife(withMade(1, "woodcutter", 10_000)).trips)).toHaveLength(MAX_CARTS);
    expect(carts(computeLife(withMade(1, "woodcutter", 0)).trips)).toHaveLength(0);
    expect(carts(computeLife(withMade(1, "barn", 100)).trips)).toHaveLength(0); // stores, makes nothing
    expect(carts(computeLife(withMade(1, "gumno", 1200)).trips)).toHaveLength(3); // harvest: 3 loads of grain
  });
  it("departures are spread over the work hours", () => {
    const d = carts(computeLife(withMade(1, "woodcutter", 30)).trips).map((c) => c.depart);
    expect(d).toEqual([WORK_FROM + 60, WORK_FROM + 180, WORK_FROM + 300, WORK_FROM + 420, WORK_FROM + 540, WORK_FROM + 660]);
  });
});

describe("lights", () => {
  it("only occupied houses and staffed workplaces", () => {
    const bs = [
      building(1, "izba", 100), // occupied
      building(2, "izba", 200), // vacant
      building(3, "izba", 300, 0, "building"), // household, but not finished
      building(4, "smithy", 400), // staffed
      building(5, "shop", 500), // nobody works there
    ];
    const s = town(bs, [{ home: 1, jobs: [4] }, { home: 3, jobs: [null] }, { home: null, jobs: [null] }]);
    const { lights } = computeLife(s);
    expect(lights.filter((l) => l.kind === "house")).toEqual([{ x: 100.5, y: 5.5, kind: "house" }]);
    expect(lights.filter((l) => l.kind === "work")).toEqual([{ x: 400.5, y: 5.5, kind: "work" }]);
  });
});

describe("cost and purity", () => {
  it("2000 residents are routed well under 100 ms and the state is untouched", () => {
    const n = 20;
    const homes: Building[] = [];
    const jobs: Building[] = [];
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) if ((i + j) % 2 === 0) homes.push(building(homes.length + 1, "izba", j * 100, i * 100));
    for (let k = 0; k < 20; k++) jobs.push(building(1000 + k, "smithy", ((k * 7) % n) * 100, ((k * 3) % n) * 100));
    const specs: Home[] = homes.map((b, i) => ({ home: b.id, jobs: Array.from({ length: i < 100 ? 10 : 0 }, (_, k) => jobs[(i + k) % jobs.length].id) }));
    const more = town([...homes, ...jobs], specs, grid(n));
    expect(Object.keys(more.residents)).toHaveLength(1000);
    const big = town([...homes, ...jobs], [...specs, ...specs.map((p, i) => ({ ...p, home: homes[(i + 1) % homes.length].id }))], grid(n));
    expect(Object.keys(big.residents)).toHaveLength(2000);
    const before = JSON.stringify(big);
    computeLife(big); // warm up
    let best = Infinity;
    let life = computeLife(big);
    for (let k = 0; k < 3; k++) {
      const t0 = performance.now();
      life = computeLife(big);
      best = Math.min(best, performance.now() - t0);
    }
    expect(best).toBeLessThan(100);
    expect(JSON.stringify(big)).toBe(before);
    expect(walks(life.trips).length).toBe(MAX_WALKERS * 2);
    console.log(`life: ${best.toFixed(1)} ms, ${life.trips.length} trips, ~${Math.round(JSON.stringify(life).length / 1024)} KiB json`);
  });
  it("is deterministic", () => {
    const s = town([building(1, "izba", 100), building(2, "smithy", 900)], [{ home: 1, jobs: [2, 2, 2] }]);
    expect(computeLife(s)).toEqual(computeLife(s));
  });
});

describe("handler: life message", () => {
  const city: City = { name: "Череповец", lat: 59.12, lng: 37.9, foundedAt: NOW - 1000 };
  function setup(initial?: unknown) {
    let stored: unknown = initial;
    const storage: Storage = { get: async () => stored, put: async (s) => void (stored = s), clear: async () => void (stored = undefined) };
    const out: FromWorker[] = [];
    return { h: new Handler(storage, (m) => out.push(m)), out, get: () => stored as { sim: Record<string, unknown> } };
  }
  const lives = (out: FromWorker[]) => out.filter((m) => m.t === "life");

  it("posts after load, then once per new game day, and stores nothing of it", async () => {
    const { h, out, get } = setup();
    await h.handle({ t: "found", city, now: NOW });
    expect(lives(out)).toHaveLength(0);
    h.tick(NOW + 10_000);
    expect(lives(out)).toHaveLength(1);
    h.tick(NOW + 20_000);
    expect(lives(out)).toHaveLength(1); // same day
    for (let k = 3; k <= 120; k++) h.tick(NOW + k * 10_000); // crosses 00:00 of day 2 (18 h after the 06:00 start)
    expect(lives(out)).toHaveLength(2);
    expect((lives(out)[1] as Extract<FromWorker, { t: "life" }>).day).toBe(1);
    await h.handle({ t: "flush" });
    expect(Object.keys(get().sim)).not.toContain("life");
    expect(Object.keys(get().sim)).not.toContain("trips");

    const again = setup(get());
    await again.h.handle({ t: "load", legacy: null, now: NOW + 1_300_000 });
    const msgs = again.out.map((m) => m.t);
    expect(msgs.slice(0, msgs.indexOf("loaded")).every((t) => t === "progress")).toBe(true);
    expect(msgs).toContain("life");
    expect(msgs.indexOf("life")).toBeGreaterThan(msgs.indexOf("loaded"));
  });
});
