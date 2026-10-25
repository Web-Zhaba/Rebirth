import { describe, expect, it } from "vitest";
import { step } from "./clock";
import { BUILDINGS } from "./buildings";
import { dailyServices } from "./coverage";
import { activeGoals, allUnlocked, checkGoals, FEAST_MOOD, goalStep, goalViews, GOALS, initialGoals, isUnlocked, lockReason, migrateGoals, parseGoals, sownHa } from "./goals";
import { emptyGrowth } from "./growth";
import { Handler, toSnapshot, type Storage } from "./handler";
import { FIELD } from "./fields";
import { addRoad, emptyRoads } from "./roads";
import { parseSave } from "./save";
import { YEAR_DAYS } from "./time";
import type { Building, City, Resident, RoadGraph, SaveV4, SimState, TerrainInfo, ZoneType } from "./types";
import { emptyZones, qkey, regenerateCells } from "./zones";
import type { Cmd, FromWorker } from "./protocol";

const NOW = 1_800_000_000_000;
const meadow: TerrainInfo = { land: "meadow", slope: 0 };
const city: City = { name: "Тест", lat: 59, lng: 37, foundedAt: NOW - 1e6 };
const SPRING = (1 - 1) * YEAR_DAYS * 1440 + 10 * 1440 + 12 * 60;

function bld(id: number, template: string, state: Building["state"] = "active", x = id * 20): Building {
  const t = BUILDINGS[template];
  return {
    id,
    template,
    zone: t.zone,
    lot: { cx: x, cy: 10, angle: 0, w: t.w, d: t.d },
    side: 1,
    footprint: [[x, 5], [x + 1, 5], [x + 1, 6], [x, 6]],
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

function town(bs: Building[] = [], gm = SPRING): SimState {
  const buildings: Record<number, Building> = {};
  for (const b of bs) buildings[b.id] = b;
  return { realTime: NOW, gameMinutes: gm, roads: emptyRoads(), zones: emptyZones(), ...emptyGrowth(7, gm), buildings, nextBuildingId: bs.length + 1 };
}

const withResidents = (s: SimState, n: number): SimState => {
  const residents: Record<number, Resident> = {};
  for (let i = 1; i <= n; i++) residents[i] = { id: i, first: "Иван", last: "Тестов", sex: "m", born: -1e6, household: 1, spouse: null, job: null, commute: null, idleDays: 0, literate: false, school: 0 };
  return { ...s, residents, nextPersonId: n + 1, nextHouseholdId: 2, households: { 1: { id: 1, last: "Тестов", home: null, members: Object.keys(residents).map(Number), arrived: 0, founder: true, mood: 50 } } };
};

// The goals before `id` in the chain are done (their rewards are not paid), so `id` is active.
const upTo = (s: SimState, id: string): SimState => ({ ...s, goals: { ...s.goals, done: GOALS.slice(0, GOALS.findIndex((g) => g.id === id)).map((g) => g.id) } });
const ids = (s: Pick<SimState, "goals">) => activeGoals(s.goals).map((g) => g.id);
const FIELD2 = { id: 1, pts: [[0, 40], [100, 40], [100, 240], [0, 240]] as [number, number][], area: 20_000 };
const sown2 = (base: SimState): SimState => ({ ...base, zones: { ...base.zones, fields: [FIELD2] }, prod: { ...base.prod, fields: { 1: { year: 1, sowH: FIELD.sowHoursHa * 2, harvH: 0, reaped: 0 } } } });

describe("saved goals", () => {
  it("a paid goal opens its unlocks even when the save predates them", () => {
    const g = parseGoals({ done: ["izbas2", "sow2"], unlocks: ["sawpit", "barn", "fisher"], families: 1, notebook: false, feast: false });
    expect(g!.unlocks).toEqual(expect.arrayContaining(["hunter", "garden", "fisher"]));
    expect(isUnlocked(g!, "hunter")).toBe(true);
  });
});

describe("goals chain", () => {
  it("starts with the first three goals and everything else locked", () => {
    const s = town();
    expect(ids(s)).toEqual(["izbas2", "logs20", "sow2"]);
    expect(s.goals).toEqual(initialGoals());
    for (const t of ["sawpit", "barn", "quarry", "fisher", "market", "chapel", "school", "healer", "craft", "trade"]) expect(lockReason(s, t)).toMatch(/^Откроется: /);
    for (const t of ["path", "dirt", "bulldoze", "res", "field", "clear", "clearing", "gumno", "woodcutter", "well", "dig"]) expect(lockReason(s, t)).toBeNull();
    expect(lockReason(s, "sawpit")).toBe("Откроется: Построить 2 дома");
  });

  it("shows progress of the active goals", () => {
    const v = goalViews(town([bld(1, "izba")]));
    expect(v.map((g) => [g.id, g.value, g.target])).toEqual([["izbas2", 1, 2], ["logs20", 20, 20], ["sow2", 0, 2]]);
    expect(v[1].hint).toBe("нужна лесозаготовка или вырубка");
  });

  it("2 izbas unlock the sawpit and the barn, and the chain fills the slot", () => {
    let s = town([bld(1, "izba"), bld(2, "izba")]);
    s = checkGoals(s);
    expect(s.goals.done).toEqual(["izbas2"]);
    expect(isUnlocked(s.goals, "sawpit") && isUnlocked(s.goals, "barn")).toBe(true);
    expect(isUnlocked(s.goals, "quarry")).toBe(false);
    expect(ids(s)).toEqual(["logs20", "sow2", "dig"]);
    expect(s.chronicle.at(-1)).toMatchObject({ kind: "goal:izbas2" });
    expect(s.chronicle.at(-1)!.text).toContain("открыто: лесопилка, склад");
    expect(s.events.map((e) => e.kind)).toEqual(["goal", "unlock"]);
    expect(checkGoals(s)).toBe(s); // nothing more to pay
  });

  it("is checked in the tick a building finishes, with the building's position", () => {
    const prev = town([bld(1, "izba"), bld(2, "izba", "building")]);
    const next = { ...prev, buildings: { ...prev.buildings, 2: { ...prev.buildings[2], state: "active" as const } } };
    const s = goalStep(prev, next);
    expect(s.goals.done).toEqual(["izbas2"]);
    expect(s.events[0].pos).toEqual([40, 10]);
  });

  it("stock of logs counts once the town makes its own", () => {
    expect(checkGoals(town()).goals.done).not.toContain("logs20"); // the founding stock alone does not
    const s = checkGoals(town([bld(1, "woodcutter")]));
    expect(s.goals.done).toEqual(["logs20"]);
    expect(isUnlocked(s.goals, "quarry") && isUnlocked(s.goals, "zone:craft")).toBe(true);
    const poor = checkGoals({ ...town([bld(1, "woodcutter")]), stock: { ...town().stock, logs: 19 } });
    expect(poor.goals.done).toEqual([]);
  });

  it("2 ha sown unlocks the fisher and brings a family into a vacant house", () => {
    let s = sown2(town([bld(1, "gumno"), bld(2, "izba")]));
    expect(sownHa(s)).toBeCloseTo(2);
    s = checkGoals(s);
    expect(s.goals.done).toContain("sow2");
    expect(isUnlocked(s.goals, "fisher")).toBe(true);
    expect(s.goals.families).toBe(0);
    expect(s.incoming).toHaveLength(1);
    expect(s.incoming[0].house).toBe(2);
  });

  it("the family waits for a house when none is vacant", () => {
    let s = checkGoals(sown2(town([bld(1, "gumno")])));
    expect(s.goals.families).toBe(1);
    expect(s.incoming).toEqual([]);
    const prev = { ...s, gameMinutes: s.gameMinutes - 1440 };
    s = goalStep(prev, { ...s, buildings: { ...s.buildings, 2: bld(2, "izba") } }); // a new day with a vacant house
    expect(s.goals.families).toBe(0);
    expect(s.incoming).toHaveLength(1);
  });

  it("a finished dig site opens the notebook", () => {
    const s = checkGoals(upTo(town([bld(1, "dig")]), "dig"));
    expect(s.goals.done).toContain("dig");
    expect(s.goals.notebook).toBe(true);
    expect(s.events.some((e) => e.kind === "unlock" && e.text.includes("статья"))).toBe(true);
    expect(checkGoals(upTo(town([bld(1, "dig", "building")]), "dig")).goals.notebook).toBe(false);
  });

  it("25 residents open the trade zone and the market; 50 the school and the healer", () => {
    let s = checkGoals(upTo(withResidents(town(), 25), "pop25"));
    expect(s.goals.done.at(-1)).toBe("pop25");
    expect(isUnlocked(s.goals, "zone:trade") && isUnlocked(s.goals, "market")).toBe(true);
    expect(isUnlocked(s.goals, "school")).toBe(false);
    s = checkGoals(withResidents(s, 50));
    expect(s.goals.done).toContain("pop50");
    expect(isUnlocked(s.goals, "school") && isUnlocked(s.goals, "healer")).toBe(true);
  });

  it("the first harvest opens the chapel, lifts the mood once and leaves the feast flag", () => {
    const base = withResidents(town(), 3);
    let s = checkGoals({ ...upTo(base, "harvest"), chronicle: [{ at: 1, kind: "harvest", text: "Урожай собран" }] });
    expect(s.goals.done).toContain("harvest");
    expect(isUnlocked(s.goals, "chapel")).toBe(true);
    expect(s.goals.feast).toBe(true);
    expect(s.households[1].mood).toBe(50 + FEAST_MOOD);
    expect(checkGoals(s).households[1].mood).toBe(50 + FEAST_MOOD); // once
    const high = checkGoals({ ...upTo(s, "harvest"), households: { 1: { ...s.households[1], mood: 95 } } });
    expect(high.households[1].mood).toBe(100);
  });

  it("5 craft buildings allow izba upgrades", () => {
    const s = checkGoals(upTo(town([1, 2, 3, 4, 5].map((i) => bld(i, "smithy"))), "craft5"));
    expect(s.goals.done).toContain("craft5");
    expect(isUnlocked(s.goals, "upgrade")).toBe(true);
  });

  it("izbas are not upgraded before the unlock", () => {
    const s0 = town([bld(1, "izba")]);
    const s = dailyServices({ ...s0, buildings: { 1: { ...s0.buildings[1], streak: 99 } } });
    expect(s.buildings[1].upgrade).toBeUndefined();
    expect(s.buildings[1].streak).toBe(99);
  });

  it("runs through the real tick on the day change", () => {
    const s = step(town([bld(1, "izba"), bld(2, "izba")], 1080 - 10));
    expect(s.goals.done).toContain("izbas2");
  });

  it("the snapshot carries the three goal views", () => {
    expect(toSnapshot(town()).goalViews.map((g) => g.id)).toEqual(["izbas2", "logs20", "sow2"]);
  });
});

// ---------- enforcement ----------

describe("locks", () => {
  const road = (): RoadGraph => {
    const r = addRoad(emptyRoads(), [[0, 0], [160, 0]], "dirt", 1, [0]);
    if (!r.ok) throw new Error(r.reason);
    return r.graph;
  };
  function world(goals = initialGoals()): SimState {
    const g = road();
    const terrain: Record<string, TerrainInfo> = {};
    for (const c of regenerateCells(g, [], [], {})) terrain[qkey(c.cx, c.cy)] = meadow;
    const cells = regenerateCells(g, [], [], terrain);
    return { realTime: NOW, gameMinutes: 0, roads: g, zones: { ...emptyZones(), cells, terrain, rev: 1 }, ...emptyGrowth(42), goals };
  }
  async function boot(s: SimState) {
    const save: SaveV4 = { version: 4, city, sim: s };
    let stored: unknown = save;
    const storage: Storage = { get: async () => stored, put: async (v) => void (stored = v), clear: async () => void (stored = undefined) };
    const out: FromWorker[] = [];
    const h = new Handler(storage, (m) => out.push(m));
    await h.handle({ t: "load", legacy: null, now: NOW });
    const send = async (cmd: Cmd) => {
      out.length = 0;
      await h.handle({ t: "cmd", id: 1, cmd });
      return out.find((m) => m.t === "cmdResult") as { ok: boolean; reason?: string };
    };
    return { send };
  }
  const site = { forest: 0, water: 0, rock: 0 };

  it("refuses placing a locked template and painting a locked zone, in Russian", async () => {
    const s = world();
    const e = Number(Object.keys(s.roads.edges)[0]);
    const { send } = await boot(s);
    expect(await send({ type: "placeBuilding", template: "barn", edge: e, side: 1, i: 3, site })).toMatchObject({ ok: false, reason: "Откроется: Построить 2 дома" });
    const keys = s.zones.cells.slice(0, 2).map((c) => c.key);
    expect(await send({ type: "paintZones", keys, zone: "craft" })).toMatchObject({ ok: false, reason: "Откроется: Накопить 20 м³ брёвен" });
    expect(await send({ type: "paintZones", keys, zone: "trade" })).toMatchObject({ ok: false, reason: "Откроется: 25 жителей" });
    expect((await send({ type: "paintZones", keys, zone: "res" })).ok).toBe(true);
    expect((await send({ type: "paintZones", keys, zone: "none" })).ok).toBe(true);
    expect((await send({ type: "placeBuilding", template: "well", edge: e, side: 1, i: 3, site })).ok).toBe(true);
  });

  it("accepts them after the unlock", async () => {
    const s = world({ ...initialGoals(), unlocks: ["barn", "zone:craft"] });
    const e = Number(Object.keys(s.roads.edges)[0]);
    const { send } = await boot(s);
    const keys = s.zones.cells.slice(0, 2).map((c) => c.key);
    expect((await send({ type: "paintZones", keys, zone: "craft" })).ok).toBe(true);
    expect((await send({ type: "placeBuilding", template: "barn", edge: e, side: 1, i: 3, site })).ok).toBe(true);
  });

  it("zones that are still locked do not grow", () => {
    const paint = (s: SimState, zone: ZoneType): SimState => ({ ...s, zones: { ...s.zones, cells: s.zones.cells.map((c) => (!c.block ? { ...c, zone } : c)) } });
    const count = (s: SimState) => Object.values(s.buildings).length;
    const open = paint({ ...world({ ...initialGoals(), unlocks: ["zone:craft"] }), buildings: { 1: bld(1, "izba") }, nextBuildingId: 2 }, "craft"); // craft demand needs a finished house
    expect(count(step(open))).toBe(2);
    expect(count(step({ ...open, goals: initialGoals() }))).toBe(1);
    expect(count(step(paint(world(), "res")))).toBe(1); // residential zones are open from the start
  });
});

// ---------- old towns ----------

describe("migration and save", () => {
  const old = (sim: SimState) => JSON.parse(JSON.stringify({ version: 4, city, sim: { ...sim, goals: undefined } }));

  it("an old town gets the unlocks its buildings prove and its met goals silently", () => {
    const s0 = withResidents(town([bld(1, "izba"), bld(2, "izba"), bld(3, "sawpit"), bld(4, "market"), bld(5, "smithy"), bld(6, "dig")]), 30);
    const sim = parseSave(old({ ...s0, chronicle: [{ at: 1, kind: "harvest", text: "Урожай собран" }] }), NOW + 1)!.sim;
    for (const k of ["sawpit", "barn", "market", "zone:craft", "zone:trade", "chapel"]) expect(isUnlocked(sim.goals, k)).toBe(true);
    expect(sim.goals.done).toEqual(expect.arrayContaining(["izbas2", "dig", "pop25", "harvest"]));
    expect(sim.goals.notebook).toBe(true);
    expect(sim.goals.families).toBe(0); // no family, no feast for a goal met long ago
    expect(sim.goals.feast).toBe(false);
    expect(sim.chronicle.filter((e) => e.kind.startsWith("goal:"))).toEqual([]);
    expect(sim.events).toEqual([]);
    expect(isUnlocked(sim.goals, "school")).toBe(false);
    expect(ids(sim)).toEqual(["logs20", "sow2", "pop50"]);
  });

  it("a bare old town starts at the first goals", () => {
    expect(parseSave(old(town()), NOW + 1)!.sim.goals).toEqual(initialGoals());
  });

  it("counts painted zones and rebuilt izbas as proof", () => {
    const s = town([{ ...bld(1, "izba"), level: 2 }]);
    const cell = { key: "k", edge: 1, side: 1 as const, i: 0, depth: 0, cx: 0, cy: 0, angle: 0, zone: "trade" as const, block: null };
    const g = migrateGoals({ ...s, zones: { ...s.zones, cells: [cell] } });
    expect(g.unlocks).toEqual(expect.arrayContaining(["upgrade", "zone:trade"]));
  });

  it("round-trips through the save and repairs garbage", () => {
    const g = { done: ["izbas2", "nope"], unlocks: ["sawpit", "barn", "bogus"], families: 2, notebook: true, feast: true };
    const raw = { version: 4, city, sim: { ...JSON.parse(JSON.stringify(town())), goals: g } };
    const sim = parseSave(raw, NOW + 1)!.sim;
    expect(sim.goals).toEqual({ done: ["izbas2"], unlocks: ["sawpit", "barn", "hunter"], families: 2, notebook: true, feast: true });
    const again = parseSave(JSON.parse(JSON.stringify({ version: 4, city, sim })), NOW + 1)!.sim;
    expect(again.goals).toEqual(sim.goals);
  });

  it("the goal and unlock event kinds survive a save", () => {
    const s = { ...town(), events: [{ at: 1, kind: "goal" as const, text: "a" }, { at: 2, kind: "unlock" as const, text: "b", pos: [1, 2] as [number, number] }] };
    const sim = parseSave(JSON.parse(JSON.stringify({ version: 4, city, sim: s })), NOW + 1)!.sim;
    expect(sim.events.map((e) => e.kind)).toEqual(["goal", "unlock"]);
    expect(sim.events[1].pos).toEqual([1, 2]);
  });

  it("the goal table is consistent", () => {
    expect(GOALS).toHaveLength(8);
    expect(allUnlocked().done).toHaveLength(8);
    const all = GOALS.flatMap((g) => g.unlocks);
    expect(new Set(all).size).toBe(all.length);
  });
});
