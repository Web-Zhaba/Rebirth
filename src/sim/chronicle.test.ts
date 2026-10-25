import { describe, expect, it } from "vitest";
import { summarize, newTally, observe } from "./away";
import { addChronicle, CHRONICLE_CAP, recordChronicle } from "./chronicle";
import { advanceTo, BASE_TICK, OFFLINE, step, TICK_MS } from "./clock";
import { emptyGrowth, seedOf } from "./growth";
import { Handler, type Storage } from "./handler";
import type { FromWorker } from "./protocol";
import { addRoad, emptyRoads } from "./roads";
import { parseSave } from "./save";
import { YEAR_MIN } from "./time";
import type { Building, City, Resident, SaveV4, SimState, TerrainInfo } from "./types";
import { emptyZones, qkey, regenerateCells } from "./zones";

const NOW = 1_800_000_000_000;
const city: City = { name: "Череповец", lat: 59.12, lng: 37.9, foundedAt: NOW - 1000 };
const meadow: TerrainInfo = { land: "meadow", slope: 0 };

// A short zoned road: houses, workshops and shops grow on it by themselves.
function grower(realTime = NOW): SimState {
  const r = addRoad(emptyRoads(), [[0, 0], [240, 0]], "dirt", 1, [0]);
  if (!r.ok) throw new Error(r.reason);
  const terrain: Record<string, TerrainInfo> = {};
  for (const c of regenerateCells(r.graph, [], [], {})) terrain[qkey(c.cx, c.cy)] = meadow;
  const cells = regenerateCells(r.graph, [], [], terrain).map((c) => (c.block ? c : { ...c, zone: c.i < 14 ? ("res" as const) : c.i < 22 ? ("craft" as const) : ("trade" as const) }));
  return { realTime, gameMinutes: 0, roads: r.graph, zones: { ...emptyZones(), cells, terrain, rev: 1 }, ...emptyGrowth(seedOf(city.foundedAt)) };
}

function setup(initial: unknown) {
  let stored: unknown = initial;
  const storage: Storage = { get: async () => stored, put: async (s) => void (stored = s), clear: async () => void (stored = undefined) };
  const out: FromWorker[] = [];
  return { h: new Handler(storage, (m) => out.push(m)), out, get: () => stored as SaveV4 };
}

const bld = (id: number, template: string, state: Building["state"], level = 1, zone: Building["zone"] = "placed"): Building => ({
  id,
  template,
  zone,
  lot: { cx: 0, cy: 0, angle: 0, w: 1, d: 1 },
  side: 1,
  footprint: [[0, 0], [1, 0], [1, 1], [0, 1]],
  height: 4,
  state,
  labor: 10,
  done: 10,
  created: 0,
  paid: true,
  level,
  streak: 0,
});

const base = (): SimState => ({ realTime: NOW, gameMinutes: 1000, roads: emptyRoads(), zones: emptyZones(), ...emptyGrowth(1, 1000) });
const kindsOf = (s: SimState) => s.chronicle.map((e) => e.kind);

describe("chronicle triggers", () => {
  it("population milestones fire once each, on crossing", () => {
    const s = base();
    const withExtra = (n: number): SimState => {
      const residents: Record<number, Resident> = { ...s.residents };
      const proto = Object.values(s.residents)[0];
      for (let i = 0; i < n; i++) residents[1000 + i] = { ...proto, id: 1000 + i };
      return { ...s, residents };
    };
    const a = recordChronicle(s, withExtra(20)); // 10 + 20 = 30 crosses 25
    expect(kindsOf(a)).toEqual(["pop:25"]);
    expect(a.chronicle[0].text).toBe("Население достигло 25 человек");
    // growing without crossing a milestone adds nothing
    expect(kindsOf(recordChronicle(withExtra(20), { ...withExtra(25), chronicle: a.chronicle }))).toEqual(["pop:25"]);
    // a dip below and a new rise past 25 does not repeat the entry
    const again = recordChronicle(withExtra(5), { ...withExtra(20), chronicle: a.chronicle });
    expect(again.chronicle).toHaveLength(1);
    // several milestones in one jump
    expect(kindsOf(recordChronicle(s, withExtra(300)))).toEqual(["pop:25", "pop:50", "pop:100", "pop:250"]);
  });

  it("first house, first building of a template, first level-2 house", () => {
    const s = base();
    const planned = { ...s, buildings: { 1: bld(1, "izba", "building", 1, "res"), 2: bld(2, "smithy", "building", 1, "craft"), 3: bld(3, "izba", "building", 1, "res") } };
    const one = { ...planned, buildings: { ...planned.buildings, 1: bld(1, "izba", "active", 1, "res"), 2: bld(2, "smithy", "active", 1, "craft") } };
    const a = recordChronicle(planned, one);
    expect(kindsOf(a)).toEqual(["house", "built:smithy"]);
    expect(a.chronicle[1].text).toBe("Построена первая кузница");
    // a second house: nothing new
    const two = { ...a, buildings: { ...a.buildings, 3: bld(3, "izba", "active", 1, "res") } };
    expect(recordChronicle(a, two)).toBe(two);
    const up = { ...two, buildings: { ...two.buildings, 1: bld(1, "izba", "active", 2, "res") } };
    const b = recordChronicle(two, up);
    expect(kindsOf(b)).toEqual(["house", "built:smithy", "level2"]);
    const up2 = { ...b, buildings: { ...b.buildings, 3: bld(3, "izba", "active", 2, "res") } };
    expect(recordChronicle(b, up2)).toBe(up2);
  });

  it("first literate resident", () => {
    const s = base();
    const ids = Object.keys(s.residents).map(Number);
    const lit = { ...s, residents: { ...s.residents, [ids[0]]: { ...s.residents[ids[0]], literate: true } } };
    const a = recordChronicle(s, lit);
    expect(kindsOf(a)).toEqual(["literate"]);
    const lit2 = { ...a, residents: { ...a.residents, [ids[1]]: { ...a.residents[ids[1]], literate: true } } };
    expect(recordChronicle(a, lit2)).toBe(lit2);
  });

  it("harvest with tonnes, famine start and end", () => {
    const s = base();
    const ev = { at: 1000, kind: "farm" as const, text: "Урожай собран: 2,3 т" };
    const harvested = recordChronicle(s, { ...s, events: [...s.events, ev] });
    expect(harvested.chronicle).toEqual([{ at: 1000, kind: "harvest", text: "Урожай собран: 2,3 т" }]);
    const other = recordChronicle(s, { ...s, events: [...s.events, { at: 1000, kind: "farm", text: "Началась уборка урожая" }] });
    expect(other.chronicle).toEqual([]);
    const hungry = { ...s, prod: { ...s.prod, flags: { ...s.prod.flags, hungry: true } } };
    const a = recordChronicle(s, hungry);
    expect(kindsOf(a)).toEqual(["famine"]);
    const b = recordChronicle(hungry, { ...a, prod: { ...a.prod, flags: { ...a.prod.flags, hungry: false } } });
    expect(kindsOf(b)).toEqual(["famine", "famineEnd"]);
  });

  it("new year", () => {
    const s = { ...base(), gameMinutes: YEAR_MIN - 360 - BASE_TICK }; // 23:50 on the last day of year 1
    const next = { ...s, gameMinutes: s.gameMinutes + BASE_TICK };
    const a = recordChronicle(s, next);
    expect(a.chronicle).toEqual([{ at: next.gameMinutes, kind: "year", text: "Наступил 2-й год" }]);
    const later = { ...a, gameMinutes: a.gameMinutes + BASE_TICK };
    expect(recordChronicle(a, later)).toBe(later);
  });

  it("is capped at 1000 and addChronicle drops the oldest", () => {
    let list = addChronicle([], 0, "find", "e0");
    for (let i = 1; i < CHRONICLE_CAP + 5; i++) list = addChronicle(list, i, "find", `e${i}`);
    expect(list).toHaveLength(CHRONICLE_CAP);
    expect(list[0].text).toBe("e5");
    expect(list[list.length - 1].text).toBe(`e${CHRONICLE_CAP + 4}`);
  });

  it("a growing town writes first-of-a-kind entries exactly once", () => {
    const s = advanceTo(grower(), NOW + 40 * 1440 * 1000);
    const k = kindsOf(s);
    expect(k).toContain("house");
    for (const kind of ["house", "literate", "level2"]) expect(k.filter((x) => x === kind).length).toBeLessThanOrEqual(1);
    const once = k.filter((x) => x.startsWith("built:") || x.startsWith("pop:"));
    expect(new Set(once).size).toBe(once.length);
  });
});

describe("save", () => {
  it("defaults to an empty chronicle and round-trips entries", () => {
    const s = grower();
    const save: SaveV4 = { version: 4, city, sim: s };
    const { chronicle: _c, ...noChronicle } = s;
    expect(parseSave({ ...save, sim: noChronicle }, NOW)!.sim.chronicle).toEqual([]);
    const entries = [{ at: 5, kind: "pop:25", text: "Население достигло 25 человек" }];
    const back = parseSave(JSON.parse(JSON.stringify({ ...save, sim: { ...s, chronicle: entries } })), NOW)!;
    expect(back.sim.chronicle).toEqual(entries);
    const broken = parseSave({ ...save, sim: { ...s, chronicle: [...entries, { at: "x" }, 5, null, { at: 1, kind: "k", text: 3 }] } }, NOW)!;
    expect(broken.sim.chronicle).toEqual(entries);
    expect(parseSave({ ...save, sim: { ...s, chronicle: "nope" } }, NOW)!.sim.chronicle).toEqual([]);
  });
  it("keeps the position of an event, drops a malformed one, loads events without it", () => {
    const s = grower();
    const events = [
      { at: 5, kind: "built", text: "Достроено: дом", pos: [1.5, -2] },
      { at: 6, kind: "shortage", text: "Не хватает брёвен", pos: [1, "x"] },
      { at: 7, kind: "birth", text: "Родился" },
    ];
    const back = parseSave(JSON.parse(JSON.stringify({ version: 4, city, sim: { ...s, events } })), NOW)!;
    expect(back.sim.events).toEqual([events[0], { at: 6, kind: "shortage", text: "Не хватает брёвен" }, events[2]]);
  });
});

describe("catch-up", () => {
  const GAP = 5 * 1440 * 1000; // five game days

  it("chunked catch-up through the handler equals a single advanceTo", async () => {
    const start = grower(NOW - GAP);
    const { h, out, get } = setup({ version: 4, city, sim: start });
    await h.handle({ t: "load", legacy: null, now: NOW });
    const loaded = out.find((m) => m.t === "loaded") as Extract<FromWorker, { t: "loaded" }>;
    const direct = advanceTo(start, NOW);
    const saved = get().sim;
    expect(saved.gameMinutes).toBe(direct.gameMinutes);
    expect(saved.realTime).toBe(direct.realTime);
    expect(saved.stock).toEqual(direct.stock);
    expect(saved.residents).toEqual(direct.residents);
    expect(saved.households).toEqual(direct.households);
    expect(saved.chronicle).toEqual(direct.chronicle);
    expect(saved.events).toEqual(direct.events);
    expect(Object.keys(saved.buildings)).toEqual(Object.keys(direct.buildings));
    expect(saved.rng).toBe(direct.rng);
    // progress: starts at 0, ends at total, one report per game day; no snapshots; one life at the end
    const progress = out.filter((m): m is Extract<FromWorker, { t: "progress" }> => m.t === "progress");
    expect(progress[0].done).toBe(0);
    expect(progress.at(-1)).toEqual({ t: "progress", done: progress[0].total, total: progress[0].total });
    expect(progress).toHaveLength(6); // 0 and one per day
    expect(out.filter((m) => m.t === "snapshot")).toHaveLength(0);
    expect(out.filter((m) => m.t === "life")).toHaveLength(1);
    const tags = out.map((m) => m.t);
    expect(tags.indexOf("loaded")).toBeGreaterThan(tags.lastIndexOf("progress"));
    expect(loaded.away?.gameMinutes).toBe(direct.gameMinutes - start.gameMinutes);
  });

  it("commands and queries arriving during catch-up wait and apply in order afterwards", async () => {
    const start = grower(NOW - GAP);
    const { h, out } = setup({ version: 4, city, sim: start });
    const p = h.handle({ t: "load", legacy: null, now: NOW });
    const c1 = h.handle({ t: "cmd", id: 1, cmd: { type: "removeRoad", edgeId: 9999 } });
    const c2 = h.handle({ t: "cmd", id: 2, cmd: { type: "paintZones", keys: [], zone: "none" } });
    const q = h.handle({ t: "query", id: 3, q: { type: "building", id: 12345 } });
    await Promise.all([p, c1, c2, q]);
    const tags = out.map((m) => (m.t === "cmdResult" || m.t === "queryResult" ? `${m.t}${m.id}` : m.t));
    expect(tags.filter((t) => /Result/.test(t))).toEqual(["cmdResult1", "cmdResult2", "queryResult3"]);
    expect(tags.indexOf("cmdResult1")).toBeGreaterThan(tags.indexOf("loaded"));
    expect(out.find((m) => m.t === "cmdResult" && m.id === 1)).toMatchObject({ ok: false });
    expect(out.find((m) => m.t === "cmdResult" && m.id === 2)).toMatchObject({ ok: true });
  });

  it("away summary counts people, buildings, goods and chronicle of the period", () => {
    const start = grower(NOW - GAP);
    const tally = newTally();
    const end = advanceTo(start, NOW, OFFLINE, Infinity, (p, n) => observe(tally, p, n));
    const a = summarize(tally, start, end, GAP);
    expect(a.gameMinutes).toBe(end.gameMinutes - start.gameMinutes);
    expect(a.popBefore).toBe(14);
    expect(a.popAfter).toBe(Object.keys(end.residents).length);
    // exact: every person is a founder, a birth or an arrival, minus deaths and departures
    expect(a.popAfter).toBe(a.popBefore + a.births + a.arrivals - a.deaths - a.departures);
    expect(a.built).toBe(Object.values(end.buildings).filter((b) => b.state === "active").length);
    expect(a.chronicle).toEqual(end.chronicle.filter((e) => e.at > start.gameMinutes));
    expect(Object.values(a.produced).every((n) => n >= 0)).toBe(true);
  });

  it("counts goods made by producers", () => {
    const s = base();
    const t = newTally();
    const next = { ...s, buildings: { 5: bld(5, "woodcutter", "active"), 6: bld(6, "pottery", "active") }, prod: { ...s.prod, today: { 5: 3, 6: 2 } } };
    observe(t, { ...next, prod: { ...s.prod, today: { 5: 1 } } }, next);
    expect(t.produced).toMatchObject({ logs: 2, wares: 2, food: 0 });
  });

  it("a tab returning after a long gap catches up with progress, one snapshot, one life and a summary", async () => {
    const { h, out } = setup(undefined);
    await h.handle({ t: "found", city, now: NOW });
    out.length = 0;
    h.tick(NOW + 3 * 1440 * 1000);
    h.tick(NOW + 3 * 1440 * 1000 + 1000); // ignored while catching up
    await h.idle();
    const tags = out.map((m) => m.t);
    expect(tags.filter((t) => t === "progress")).toHaveLength(4);
    expect(tags.filter((t) => t === "snapshot")).toHaveLength(1);
    expect(tags.filter((t) => t === "life")).toHaveLength(1);
    const away = out.find((m) => m.t === "away") as Extract<FromWorker, { t: "away" }>;
    expect(away.away.gameMinutes).toBe(3 * 1440);
    const snap = out.find((m) => m.t === "snapshot") as Extract<FromWorker, { t: "snapshot" }>;
    expect(snap.sim).not.toHaveProperty("chronicle");
  });

  it("snapshots carry the chronicle only when it changed", async () => {
    const { h, out } = setup(undefined);
    await h.handle({ t: "found", city, now: NOW });
    out.length = 0;
    h.tick(NOW + TICK_MS);
    h.tick(NOW + 2 * TICK_MS);
    const snaps = out.filter((m): m is Extract<FromWorker, { t: "snapshot" }> => m.t === "snapshot");
    expect(snaps).toHaveLength(2);
    expect(snaps.every((m) => m.chronicle === undefined)).toBe(true);
  });
});

it("step leaves the chronicle identity alone when nothing happens", () => {
  const s = base();
  expect(step(s).chronicle).toBe(s.chronicle);
});
