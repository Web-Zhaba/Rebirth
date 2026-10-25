import { describe, expect, it } from "vitest";
import { allocateClearings, allocateLabor, BUILDINGS, CREW } from "./buildings";
import { BASE_TICK, step } from "./clock";
import { CLEARING, clearedAt, clearingLabor, clearingLogs, isCleared, landOver, nextClearingId, validateClearing } from "./clearing";
import { advanceClearings, emptyGrowth, seedOf } from "./growth";
import { Handler, type Storage } from "./handler";
import { builderCount } from "./people";
import type { Cmd, FromWorker } from "./protocol";
import { addRoad, emptyRoads } from "./roads";
import { parseSave } from "./save";
import type { Building, City, Clearing, Field, RoadGraph, SaveV4, SimState, TerrainInfo } from "./types";
import { emptyZones, qkey, qpoint } from "./zones";

const NOW = 1_800_000_000_000;
const city: City = { name: "Тест", lat: 59.12, lng: 37.9, foundedAt: NOW - 1000 };

const road = (labor = 0): RoadGraph => {
  const r = addRoad(emptyRoads(), [[0, 0], [240, 0]], "dirt", 1, [labor]);
  if (!r.ok) throw new Error(r.reason);
  return r.graph;
};
const box = (x0: number, y0: number, w: number, h: number): [number, number][] => [[x0, y0], [x0 + w, y0], [x0 + w, y0 + h], [x0, y0 + h]];
const clearing = (id: number, pts = box(20, -150, 50, 100), forest = 0.8, done = 0): Clearing => {
  const area = 5000;
  return { id, pts, area, forest, labor: clearingLabor(area, forest), done };
};
const NOON = 360; // 12:00, work hours
const state = (clearings: Clearing[], roads = road(), gm = NOON): SimState => ({ realTime: NOW, gameMinutes: gm, roads, zones: emptyZones(), ...emptyGrowth(seedOf(city.foundedAt), gm), clearings });
const site = (id: number, labor = 1e6): Building => {
  const t = BUILDINGS.izba;
  return {
    id,
    template: "izba",
    zone: "res",
    lot: { cx: 0, cy: 0, angle: 0, w: t.w, d: t.d },
    side: 1,
    footprint: [[0, 0], [1, 0], [1, 1], [0, 1]],
    height: t.height,
    state: "building",
    labor,
    done: 0,
    created: 0,
    paid: true,
    level: 1,
    streak: 0,
  };
};

describe("clearing math", () => {
  it("labor is 6.25 person-h per 100 m2 of forest and 0.5 per 100 m2 of the rest", () => {
    expect(clearingLabor(5000, 1)).toBeCloseTo(312.5);
    expect(clearingLabor(5000, 0)).toBeCloseTo(25);
    expect(clearingLabor(5000, 0.8)).toBeCloseTo(255);
  });
  it("logs are 2.5 m3 per 100 m2 of forest, about 250 m3 per ha", () => {
    expect(clearingLogs(10_000, 1)).toBeCloseTo(250);
    expect(clearingLogs(5000, 0.8)).toBeCloseTo(100);
    expect(clearingLogs(5000, 0)).toBe(0);
  });
  it("logs are credited in proportion to the labor done, and sum to the whole at the end", () => {
    const c = clearing(1);
    let s = state([c]);
    const logs0 = s.stock.logs;
    s = advanceClearings(s, new Map([[1, c.labor / 4]]));
    expect(s.stock.logs - logs0).toBeCloseTo(25);
    expect(isCleared(s.clearings[0])).toBe(false);
    s = advanceClearings(s, new Map([[1, c.labor]])); // more than is left
    expect(s.clearings[0].done).toBe(c.labor);
    expect(s.stock.logs - logs0).toBeCloseTo(100);
    expect(s.events[s.events.length - 1]).toMatchObject({ kind: "clearing" });
    expect(advanceClearings(s, new Map([[1, 5]])).stock.logs).toBeCloseTo(s.stock.logs); // finished: nothing more
  });
});

describe("allocation: roads, clearings, buildings", () => {
  const bs = { 1: site(1), 2: site(2) };
  const cs = [clearing(1)];
  it("a crew each in order, clearings before buildings", () => {
    const a = allocateLabor(bs, 25, 10, cs);
    const c = allocateClearings(bs, cs, 25, 10);
    expect([c.get(1), a.get(1), a.get(2)]).toEqual([10, 10, 5]);
    expect(allocateLabor(bs, 15, 10, cs).get(2)).toBeUndefined(); // the clearing and the first building take all of it
    expect(allocateLabor(bs, 15, 10, cs).get(1)).toBe(5);
    expect(allocateClearings(bs, cs, 15, 10).get(1)).toBe(10);
  });
  it("what the crews leave goes to the first site that still has work, never wasted", () => {
    const a = allocateLabor(bs, 100, 10, cs);
    const c = allocateClearings(bs, cs, 100, 10);
    expect(c.get(1)).toBe(80);
    expect(a.get(1)).toBe(10);
    expect(a.get(2)).toBe(10);
    expect([...a.values(), ...c.values()].reduce((x, y) => x + y, 0)).toBeCloseTo(100);
  });
  it("only clearings remain: they take what a crew can, then the rest", () => {
    expect(allocateClearings({}, cs, 25, 10).get(1)).toBe(25);
  });
  it("in a tick roads come first, then clearings, then buildings", () => {
    const hours = (builderCount(state([])) * BASE_TICK) / 60;
    const crew = (CREW * BASE_TICK) / 60;
    expect(hours).toBeGreaterThan(crew);
    // an unfinished road swallows everything
    const busy = { ...state([clearing(1)], road(1e6)), buildings: { 1: site(1) } };
    const a = step(busy);
    expect(a.clearings[0].done).toBe(0);
    expect(a.buildings[1].done).toBe(0);
    // a built road: the clearing takes its crew first, the building gets what is left
    const s = { ...state([clearing(1)]), buildings: { 1: site(1) } };
    const b = step(s);
    expect(b.clearings[0].done).toBeCloseTo(crew);
    expect(b.buildings[1].done).toBeCloseTo(hours - crew);
    expect(b.stock.logs).toBeGreaterThan(s.stock.logs);
  });
  it("a clearing is construction work: the unemployed are builders, not idle", () => {
    expect(builderCount(state([clearing(1)]))).toBeGreaterThanOrEqual(builderCount(state([])));
    const s = step(state([clearing(1)]));
    expect(s.clearings[0].done).toBeGreaterThan(0);
  });
});

describe("validation", () => {
  const g = road();
  it("accepts a clearing near a built road and returns it counter-clockwise", () => {
    const v = validateClearing([...box(20, -150, 50, 100)].reverse(), 0.8, g, [], []);
    expect(v).toMatchObject({ ok: true, area: 5000 });
    if (v.ok) expect(v.labor).toBeCloseTo(255);
  });
  it("rejects more than 5 ha", () => {
    expect(validateClearing(box(20, -300, 300, 200), 1, g, [], [])).toMatchObject({ ok: false });
    expect(validateClearing(box(20, -150, 250, 200), 1, g, [], [])).toMatchObject({ ok: true }); // exactly 5 ha
    expect(validateClearing(box(20, -150, 251, 200), 1, g, [], [])).toMatchObject({ ok: false });
    expect(CLEARING.maxArea).toBe(50_000);
  });
  it("rejects overlap with a field or another clearing", () => {
    const field: Field = { id: 1, pts: box(40, -120, 100, 50), area: 5000 };
    expect(validateClearing(box(20, -150, 50, 100), 0.8, g, [field], [])).toMatchObject({ ok: false });
    expect(validateClearing(box(20, -150, 50, 100), 0.8, g, [], [clearing(1, box(60, -100, 50, 50))])).toMatchObject({ ok: false });
    expect(validateClearing(box(20, -150, 50, 100), 0.8, g, [], [clearing(1, box(100, -150, 50, 100))])).toMatchObject({ ok: true });
  });
  it("rejects a centroid more than 300 m from a built road node, or a road not built yet", () => {
    expect(validateClearing(box(20, -450, 50, 100), 0.8, g, [], [])).toMatchObject({ ok: false });
    expect(validateClearing(box(20, -150, 50, 100), 0.8, road(10), [], [])).toMatchObject({ ok: false });
  });
  it("rejects a self-intersecting outline and a bad forest share", () => {
    expect(validateClearing([[20, -150], [70, -50], [70, -150], [20, -50]], 0.8, g, [], [])).toMatchObject({ ok: false });
    expect(validateClearing(box(20, -150, 50, 100), 1.5, g, [], [])).toMatchObject({ ok: false });
  });
  it("ids go on from the largest", () => {
    expect(nextClearingId([])).toBe(1);
    expect(nextClearingId([clearing(3), clearing(1)])).toBe(4);
  });
});

describe("cleared land is meadow", () => {
  it("only inside a finished clearing, and only forest changes", () => {
    const done = clearing(1, box(0, 0, 50, 100), 0.8, 1e9);
    const open = clearing(2, box(100, 0, 50, 100));
    done.done = done.labor;
    expect(clearedAt(10, 10, [done, open])).toBe(true);
    expect(clearedAt(110, 10, [done, open])).toBe(false);
    expect(landOver("forest", 10, 10, [done])).toBe("meadow");
    expect(landOver("forest", 110, 10, [done, open])).toBe("forest");
    expect(landOver("forest", 60, 10, [done])).toBe("forest");
    expect(landOver("water", 10, 10, [done])).toBe("water");
  });
  it("finishing turns sampled forest inside into meadow, bumps rev and leaves the rest", () => {
    const forest: TerrainInfo = { land: "forest", slope: 2 };
    const terrain: Record<string, TerrainInfo> = {
      [qkey(40, -100)]: forest,
      [qkey(300, -100)]: forest,
      [qkey(45, -120)]: { land: "water", slope: 0 },
    };
    let s = state([clearing(1, box(20, -150, 50, 100), 0.8, 0)]);
    s = { ...s, zones: { ...s.zones, terrain, rev: 5 } };
    const half = advanceClearings(s, new Map([[1, 10]]));
    expect(half.zones).toBe(s.zones); // not finished yet: untouched
    const fin = advanceClearings(s, new Map([[1, 1000]]));
    expect(fin.zones.terrain[qkey(40, -100)].land).toBe("meadow");
    expect(fin.zones.terrain[qkey(300, -100)].land).toBe("forest");
    expect(fin.zones.terrain[qkey(45, -120)].land).toBe("water");
    expect(fin.zones.rev).toBe(6);
  });
});

describe("save", () => {
  const save = (clearings: unknown): unknown => {
    const s = state([]);
    return { version: 4, city, sim: { ...s, clearings } };
  };
  it("round-trips clearings", () => {
    const v = save([clearing(1), clearing(2, box(100, -150, 50, 100), 0.5, 40)]) as SaveV4;
    expect(parseSave(v, NOW)?.sim.clearings).toEqual(v.sim.clearings);
  });
  it("defaults to none and drops broken entries", () => {
    const { clearings: _c, ...rest } = state([]);
    expect(parseSave({ version: 4, city, sim: rest }, NOW)?.sim.clearings).toEqual([]);
    const ok = clearing(1);
    const broken = [{ ...clearing(2), forest: 2 }, { ...clearing(3), pts: [[0, 0]] }, { ...clearing(4), labor: 0 }, { ...ok }, { ...ok }];
    expect(parseSave(save(broken), NOW)?.sim.clearings).toEqual([ok]);
    expect(parseSave(save("x"), NOW)?.sim.clearings).toEqual([]);
  });
});

describe("handler", () => {
  function setup(sim: SimState, sampler?: ConstructorParameters<typeof Handler>[2]) {
    let stored: unknown = { version: 4, city, sim };
    const storage: Storage = { get: async () => stored, put: async (s) => void (stored = s), clear: async () => void (stored = undefined) };
    const out: FromWorker[] = [];
    const h = new Handler(storage, (m) => out.push(m), sampler);
    let id = 0;
    return {
      h,
      get: () => stored as SaveV4,
      load: () => h.handle({ t: "load", legacy: null, now: NOW }),
      cmd: async (cmd: Cmd) => {
        const n = ++id;
        await h.handle({ t: "cmd", id: n, cmd });
        return out.find((m) => m.t === "cmdResult" && m.id === n) as Extract<FromWorker, { t: "cmdResult" }>;
      },
    };
  }

  it("adds a clearing with its labor and rejects bad ones", async () => {
    const t = setup(state([]));
    await t.load();
    const bad = await t.cmd({ type: "addClearing", pts: box(20, -450, 50, 100), forest: 0.8 });
    expect(bad.ok).toBe(false);
    const ok = await t.cmd({ type: "addClearing", pts: box(20, -150, 50, 100), forest: 0.8 });
    expect(ok.ok).toBe(true);
    expect(t.get().sim.clearings).toMatchObject([{ id: 1, area: 5000, forest: 0.8, done: 0 }]);
    expect(t.get().sim.clearings[0].labor).toBeCloseTo(255);
    expect((await t.cmd({ type: "addClearing", pts: box(30, -140, 20, 30), forest: 0.8 })).ok).toBe(false); // overlaps the first
  });

  it("terrain sampled later is meadow inside a finished clearing", async () => {
    const done = clearing(1, box(0, -40, 100, 80));
    done.done = done.labor;
    const t = setup(state([done]), async () => ({ land: "forest", slope: 0 }));
    await t.load();
    await t.h.idle();
    const lands = Object.entries(t.get().sim.zones.terrain).map(([k, v]) => [qpoint(k)[0], v.land] as const);
    expect(lands.filter(([x]) => x > 5 && x < 95).length).toBeGreaterThan(0);
    expect(lands.filter(([x]) => x > 5 && x < 95).every(([, land]) => land === "meadow")).toBe(true);
    expect(lands.filter(([x]) => x > 105).every(([, land]) => land === "forest")).toBe(true);
  });

  it("removing a clearing in work keeps the logs it made; a finished one cannot be removed", async () => {
    const part = clearing(1, box(20, -150, 50, 100), 0.8, 0);
    const worked = advanceClearings(state([part]), new Map([[1, part.labor / 2]]));
    const done = clearing(2, box(100, -150, 50, 100));
    done.done = done.labor;
    const t = setup({ ...worked, clearings: [...worked.clearings, done] });
    await t.load();
    const logs = t.get().sim.stock.logs;
    expect(logs).toBeGreaterThan(60);
    expect((await t.cmd({ type: "removeClearing", id: 1 })).ok).toBe(true);
    expect(t.get().sim.clearings.map((c) => c.id)).toEqual([2]);
    expect(t.get().sim.stock.logs).toBe(logs);
    expect((await t.cmd({ type: "removeClearing", id: 1 })).ok).toBe(false);
    expect((await t.cmd({ type: "removeClearing", id: 2 })).ok).toBe(false);
  });
});
