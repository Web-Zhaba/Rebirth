import { describe, expect, it } from "vitest";
import { BUILDINGS } from "./buildings";
import { DIG, digDone, digInfos, growDig, onOldFoundation, radiusOf, recordFinds, revealedArea, type FindsCmd } from "./excavation";
import { step } from "./clock";
import { emptyGrowth, makeBuilding } from "./growth";
import { Handler, type Storage } from "./handler";
import type { FromWorker } from "./protocol";
import { addRoad, emptyRoads } from "./roads";
import { parseSave } from "./save";
import { PACE, payMaterials, produceStep } from "./production";
import type { Building, City, Resident, SaveV4, SimState, ZoneCell } from "./types";
import { emptyZones } from "./zones";

const NOW = 1_800_000_000_000;
const NOON = 100 * 1440 + 12 * 60 - 360; // inside work hours
const city: City = { name: "Череповец", lat: 59.12, lng: 37.9, foundedAt: NOW - 1000 };

const cell = (cx: number): ZoneCell => ({ key: `1:1:${cx}:0`, edge: 1, side: 1, i: 0, depth: 0, cx, cy: 4, angle: 0, zone: "none", block: null });
const dig = (id = 1, state: Building["state"] = "active"): Building => ({ ...makeBuilding(BUILDINGS.dig, cell(10), cell(10), id, 0), state, done: state === "active" ? 30 : 0, paid: true });

function town(bs: Building[], diggers = 0, gm = NOON): SimState {
  const g = emptyGrowth(3, gm);
  const residents: Record<number, Resident> = {};
  for (let i = 1; i <= diggers; i++) {
    residents[i] = { id: i, first: "Иван", last: "Тестов", sex: "m", born: gm - 30 * 360 * 1440, household: 1, spouse: null, job: bs[0].id, commute: 5, idleDays: 0, literate: false, school: 0 };
  }
  const buildings: Record<number, Building> = {};
  for (const b of bs) buildings[b.id] = b;
  return { realTime: NOW, gameMinutes: gm, roads: emptyRoads(), zones: emptyZones(), ...g, residents: diggers ? residents : g.residents, buildings, nextBuildingId: 99 };
}

const square = (x: number, y: number, s: number): [number, number][] => [[x, y], [x + s, y], [x + s, y + s], [x, y + s]];
const found = (id: string, area = 100) => ({ id, ring: square(0, 0, Math.sqrt(area)), area });
const cmd = (o: Partial<FindsCmd> = {}): FindsCmd => ({ digId: 1, foundations: [], pois: [], streets: [], ...o });

describe("dig site", () => {
  it("is a 6 x 6 placed building with 3 jobs, 30 h of labor and its own materials", () => {
    const t = BUILDINGS.dig;
    expect([t.zone, t.along, t.deep, t.w, t.d, t.jobs, t.labor]).toEqual(["placed", 6, 6, 1, 1, 3, 30]);
    expect(t.materials).toEqual({ logs: 2, planks: 0.5, stone: 0 });
    expect(dig().radius).toBe(DIG.startRadius);
  });
  it("starts at 15 m and grows by 40 m2 × PACE per digger-hour", () => {
    expect(DIG.areaPerHour).toBe(40 * PACE);
    expect(radiusOf(dig())).toBe(15);
    const s = produceStep(town([dig()], 3), 1);
    const r = radiusOf(s.buildings[1]);
    expect(revealedArea(r) - revealedArea(15)).toBeCloseTo(3 * DIG.areaPerHour);
    expect(growDig(15, 1)).toBeCloseTo(Math.sqrt(225 + DIG.areaPerHour / Math.PI));
  });
  it("does not grow without diggers or before it is finished", () => {
    const s = town([dig()], 0);
    expect(produceStep(s, 1).buildings[1].radius).toBe(15);
    const w = town([dig(1, "building")], 3);
    expect(produceStep(w, 1).buildings[1].radius).toBe(15);
  });
  it("scales with the artel draft (scale argument) and stops at 120 m", () => {
    const half = produceStep(town([dig()], 3), 1, 0.5);
    expect(revealedArea(radiusOf(half.buildings[1])) - revealedArea(15)).toBeCloseTo(3 * DIG.areaPerHour * 0.5);
    const s = produceStep(town([dig()], 3), 1e6);
    expect(s.buildings[1].radius).toBe(DIG.maxRadius);
    expect(digDone(s.buildings[1])).toBe(true);
  });
  it("a finished site goes away on its own; its disc and finds stay", () => {
    const done = { ...dig(), radius: DIG.maxRadius };
    const found1 = recordFinds(town([done]), cmd({ foundations: [found("a")] }));
    if (!found1.ok) throw new Error(found1.reason);
    const s = step(found1.sim);
    expect(s.buildings[1]).toBeUndefined();
    expect(s.finds.revealed).toEqual([{ digId: 1, x: done.lot.cx, y: done.lot.cy, r: DIG.maxRadius }]);
    expect(s.finds.foundations).toHaveLength(1);
    expect(digInfos(s)).toEqual([{ id: 1, x: done.lot.cx, y: done.lot.cy, r: DIG.maxRadius, foundations: 1, pois: 0, streets: 0 }]);
    expect(s.events.some((e) => e.kind === "built" && e.text.includes("Раскоп завершён"))).toBe(true);
  });
  it("a finished site's workers go back to the artel at once", () => {
    const s = step(town([{ ...dig(), radius: DIG.maxRadius }], 3));
    expect(Object.values(s.buildings)).toEqual([]);
    expect(produceStep(town([dig()], 3), 1e6).buildings[1].radius).toBe(DIG.maxRadius);
  });
  it("a working site's disc is in the snapshot too; its finds are recorded while it works", () => {
    const s = town([dig()]);
    expect(digInfos(s)).toEqual([expect.objectContaining({ id: 1, r: DIG.startRadius })]);
    expect(recordFinds(s, cmd({ foundations: [found("a")] })).ok).toBe(true);
  });
  it("the snapshot exposes the disc and the finds of each dig", () => {
    let s = town([dig(), dig(2, "building")]);
    const r = recordFinds(s, cmd({ foundations: [found("a")], pois: [{ id: "p", name: "Храм", cls: "place_of_worship", x: 1, y: 1 }] }));
    if (!r.ok) throw new Error(r.reason);
    s = r.sim;
    const d = digInfos(s);
    expect(d).toHaveLength(1);
    expect(d[0]).toMatchObject({ id: 1, x: s.buildings[1].lot.cx, y: s.buildings[1].lot.cy, r: 15, foundations: 1, pois: 1, streets: 0 });
  });
});

describe("recordFinds", () => {
  const rec = (s: SimState, c: FindsCmd) => {
    const r = recordFinds(s, c);
    if (!r.ok) throw new Error(r.reason);
    return r.sim;
  };
  it("stores finds, salvages min(20 t, 0.05 t per m2) and ignores recorded ids", () => {
    const s0 = town([dig()]);
    const s1 = rec(s0, cmd({ foundations: [found("a", 100), found("b", 1000)] }));
    expect(s1.finds.foundations.map((f) => f.id)).toEqual(["a", "b"]);
    expect(s1.stock.stone - s0.stock.stone).toBeCloseTo(5 + 20);
    const s2 = rec(s1, cmd({ foundations: [found("a", 100), found("c", 40)] }));
    expect(s2.finds.foundations.map((f) => f.id)).toEqual(["a", "b", "c"]);
    expect(s2.stock.stone - s1.stock.stone).toBeCloseTo(2);
    expect(recordFinds(s2, cmd({ foundations: [found("a")] }))).toEqual({ ok: true, sim: s2 });
    expect(s1.finds.foundations[0]).toMatchObject({ digId: 1, area: 100 });
  });
  it("writes one chronicle line per named place or street and one per batch of foundations", () => {
    const s = rec(
      town([dig()]),
      cmd({
        foundations: Array.from({ length: 12 }, (_, i) => found(`f${i}`, 30)),
        pois: [{ id: "p1", name: "Часовня Николая", cls: "place_of_worship", x: 2, y: 3 }],
        streets: [{ id: "s1", name: "Милютина" }, { id: "s2", name: "Милютина" }],
      }),
    );
    expect(s.chronicle.map((e) => e.text)).toEqual([
      "Раскоп: найдено место «Часовня Николая»",
      "Раскоп: найдена старая улица — Милютина",
      "Раскоп: открыто 12 фундаментов, +18 т камня",
    ]);
    expect(s.finds.streets).toHaveLength(1);
    const again = rec(s, cmd({ streets: [{ id: "s3", name: "Милютина" }] }));
    expect(again).toBe(s);
    const one = rec(town([dig()]), cmd({ foundations: [found("x", 90)] }));
    expect(one.chronicle[0].text).toBe("Раскоп: открыт 1 фундамент, +4,5 т камня");
  });
  it("rejects malformed commands without touching the state", () => {
    const s = town([dig()]);
    const bad: unknown[] = [
      cmd({ digId: 7 }),
      cmd({ digId: 1.5 }),
      cmd({ foundations: [{ id: "a", ring: [[0, 0], [1, 1]], area: 5 }] }),
      cmd({ foundations: [{ id: "a", ring: [[0, 0], [1, 0], [NaN, 1]], area: 5 }] }),
      cmd({ foundations: [{ id: "a", ring: square(0, 0, 2), area: -1 }] }),
      cmd({ foundations: Array.from({ length: 201 }, (_, i) => found(`f${i}`)) }),
      cmd({ pois: [{ id: "p", name: "", cls: "x", x: 0, y: 0 }] }),
      cmd({ streets: [{ id: "s", name: 5 as unknown as string }] }),
      { digId: 1, foundations: "no", pois: [], streets: [] },
      null,
    ];
    for (const c of bad) expect(recordFinds(s, c as FindsCmd).ok).toBe(false);
    expect(s.finds.foundations).toHaveLength(0);
  });
});

describe("rebuild on old foundations", () => {
  const planned = (fp: [number, number][]): Building => ({ ...makeBuilding(BUILDINGS.izba, cell(10), cell(10), 5, 0), footprint: fp });
  const stock = { food: 0, logs: 100, planks: 10, stone: 10, wares: 0 };
  const ring = { ring: square(0, 0, 10) };

  it("overlap test: a footprint corner in the ring, or the foundation centroid in the footprint", () => {
    expect(onOldFoundation(square(5, 5, 10), [ring])).toBe(true);
    expect(onOldFoundation(square(-20, -20, 50), [ring])).toBe(true);
    expect(onOldFoundation(square(30, 30, 5), [ring])).toBe(false);
    expect(onOldFoundation(square(5, 5, 10), [])).toBe(false);
  });
  it("needs no stone and 25 % less labor, and is marked", () => {
    const b = planned(square(5, 5, 6));
    const r = payMaterials({ 5: b }, stock, 1, [ring]);
    expect(r.stock.stone).toBe(10);
    expect(r.buildings[5].labor).toBeCloseTo(b.labor * 0.75);
    expect(r.buildings[5].onRuins).toBe(true);
    // no foundation: the stone is taken and the labor stays
    const plain = payMaterials({ 5: planned(square(50, 50, 6)) }, stock, 1, [ring]);
    expect(plain.stock.stone).toBe(10 - BUILDINGS.izba.materials.stone);
    expect(plain.buildings[5].labor).toBe(b.labor);
    expect(plain.buildings[5].onRuins).toBeUndefined();
  });
  it("hand work for missing logs is still counted, then reduced", () => {
    const r = payMaterials({ 5: planned(square(5, 5, 6)) }, { ...stock, logs: 0, planks: 0 }, 1, [ring]);
    const hand = BUILDINGS.izba.materials.logs * 4 + BUILDINGS.izba.materials.planks * 12;
    expect(r.buildings[5].labor).toBeCloseTo((BUILDINGS.izba.labor + hand) * 0.75);
  });
});

describe("saves", () => {
  const save = (sim: SimState): unknown => JSON.parse(JSON.stringify({ version: 4, city, sim } satisfies SaveV4));
  it("a new town has empty finds and an older save gets the default", () => {
    expect(emptyGrowth(1).finds).toEqual({ foundations: [], pois: [], streets: [], revealed: [] });
    const s = town([dig()]);
    const raw = save(s) as { sim: Record<string, unknown> };
    delete raw.sim.finds;
    const p = parseSave(raw, NOW)!;
    expect(p.sim.finds).toEqual({ foundations: [], pois: [], streets: [], revealed: [] });
    expect(p.sim.buildings[1].radius).toBe(15);
  });
  it("finds, the radius and the ruins mark survive a round trip", () => {
    let s = town([{ ...dig(), radius: 42.5 }]);
    const r = recordFinds(s, cmd({ foundations: [found("a")], pois: [{ id: "p", name: "Храм", cls: "x", x: 1.234, y: 2 }], streets: [{ id: "s", name: "Улица" }] }));
    if (!r.ok) throw new Error(r.reason);
    s = { ...r.sim, buildings: { ...r.sim.buildings, 7: { ...makeBuilding(BUILDINGS.izba, cell(30), cell(30), 7, 0), onRuins: true } } };
    const p = parseSave(save(s), NOW)!;
    expect(p.sim.finds).toEqual(s.finds);
    expect(p.sim.buildings[1].radius).toBe(42.5);
    expect(p.sim.buildings[7].onRuins).toBe(true);
  });
  it("a malformed finds record never loses the town; broken entries are dropped", () => {
    const s = town([dig()]);
    for (const junk of [7, "x", [], { foundations: 5, pois: null, streets: {} }]) {
      const raw = save(s) as { sim: Record<string, unknown> };
      raw.sim.finds = junk;
      const p = parseSave(raw, NOW);
      expect(p).not.toBeNull();
      expect(p!.sim.finds).toEqual({ foundations: [], pois: [], streets: [], revealed: [] });
    }
    const raw = save(s) as { sim: Record<string, unknown> };
    raw.sim.finds = { foundations: [{ id: "ok", ring: square(0, 0, 3), area: 9, digId: 1, at: 0 }, { id: "bad", ring: [[0, 0]], area: 1, digId: 1, at: 0 }], pois: [], streets: [{ id: "s", name: "A", kind: "street", digId: 1, at: 0 }, { nope: 1 }] };
    const p = parseSave(raw, NOW)!;
    expect(p.sim.finds.foundations.map((f) => f.id)).toEqual(["ok"]);
    expect(p.sim.finds.streets).toHaveLength(1);
  });
});

describe("recordFinds through the worker", () => {
  it("a demolished dig keeps its disc, so the finds stay on the map", async () => {
    const road = addRoad(emptyRoads(), [[0, 0], [100, 0]], "dirt", 1, [0]);
    if (!road.ok) throw new Error(road.reason);
    const s = { ...town([{ ...dig(), radius: 40 }]), roads: road.graph, realTime: NOW };
    let stored: unknown = JSON.parse(JSON.stringify({ version: 4, city, sim: s }));
    const storage: Storage = { get: async () => stored, put: async (x) => void (stored = JSON.parse(JSON.stringify(x))), clear: async () => void (stored = undefined) };
    const out: FromWorker[] = [];
    const h = new Handler(storage, (m) => out.push(m));
    await h.handle({ t: "load", legacy: null, now: NOW });
    await h.handle({ t: "cmd", id: 1, cmd: { type: "recordFinds", digId: 1, foundations: [found("a", 100)], pois: [], streets: [] } });
    await h.handle({ t: "cmd", id: 2, cmd: { type: "demolish", id: 1 } });
    expect(out.filter((m) => m.t === "cmdResult").pop()).toEqual({ t: "cmdResult", id: 2, ok: true });
    const snap = out.filter((m): m is Extract<FromWorker, { t: "snapshot" }> => m.t === "snapshot").pop()!;
    expect(snap.sim.buildings[1]).toBeUndefined();
    expect(snap.sim.digs).toEqual([expect.objectContaining({ id: 1, r: 40, foundations: 1 })]);
    expect((stored as SaveV4).sim.finds.revealed).toEqual([expect.objectContaining({ digId: 1, r: 40 })]);
    await h.handle({ t: "cmd", id: 3, cmd: { type: "recordFinds", digId: 1, foundations: [found("late", 100)], pois: [], streets: [] } });
    expect(out.filter((m) => m.t === "cmdResult").pop()).toEqual({ t: "cmdResult", id: 3, ok: true });
  });
  it("is acknowledged, persisted and posts the new chronicle; a repeat changes nothing", async () => {
    const road = addRoad(emptyRoads(), [[0, 0], [100, 0]], "dirt", 1, [0]);
    if (!road.ok) throw new Error(road.reason);
    const s = { ...town([dig()]), roads: road.graph };
    let stored: unknown = JSON.parse(JSON.stringify({ version: 4, city, sim: { ...s, realTime: NOW } }));
    const storage: Storage = { get: async () => stored, put: async (x) => void (stored = JSON.parse(JSON.stringify(x))), clear: async () => void (stored = undefined) };
    const out: FromWorker[] = [];
    const h = new Handler(storage, (m) => out.push(m));
    await h.handle({ t: "load", legacy: null, now: NOW });
    await h.handle({ t: "cmd", id: 1, cmd: { type: "recordFinds", digId: 1, foundations: [found("a", 100)], pois: [], streets: [{ id: "s", name: "Милютина" }] } });
    expect(out.filter((m) => m.t === "cmdResult")).toEqual([{ t: "cmdResult", id: 1, ok: true }]);
    const snap = out.filter((m): m is Extract<FromWorker, { t: "snapshot" }> => m.t === "snapshot").pop()!;
    expect(snap.chronicle?.some((e) => e.text.includes("Милютина"))).toBe(true);
    expect(snap.sim.digs[0]).toMatchObject({ id: 1, foundations: 1, streets: 1 });
    expect((stored as SaveV4).sim.finds.foundations).toHaveLength(1);
    await h.handle({ t: "cmd", id: 2, cmd: { type: "recordFinds", digId: 1, foundations: [found("a", 100)], pois: [], streets: [] } });
    expect(out.filter((m) => m.t === "cmdResult").pop()).toEqual({ t: "cmdResult", id: 2, ok: true });
    await h.handle({ t: "cmd", id: 3, cmd: { type: "recordFinds", digId: 99, foundations: [], pois: [], streets: [] } });
    expect(out.filter((m) => m.t === "cmdResult").pop()).toMatchObject({ id: 3, ok: false });
  });
});

describe("typed foundations", () => {
  const rec = (s: SimState, c: FindsCmd) => {
    const r = recordFinds(s, c);
    if (!r.ok) throw new Error(r.reason);
    return r.sim;
  };
  const typed = (id: string, extra: Record<string, unknown> = {}) => ({ ...found(id, 100), cls: "school", name: "Школа", height: 12, ...extra });
  const save = (sim: SimState): unknown => JSON.parse(JSON.stringify({ version: 4, city, sim } satisfies SaveV4));

  it("stores the kind, name and height of a typed foundation", () => {
    const s = rec(town([dig()]), cmd({ foundations: [typed("a"), found("b")] }));
    expect(s.finds.foundations[0]).toMatchObject({ id: "a", cls: "school", name: "Школа", height: 12 });
    expect("cls" in s.finds.foundations[1]).toBe(false);
  });
  it("rejects a bad kind, name or height", () => {
    const s = town([dig()]);
    for (const bad of [{ cls: "" }, { cls: "x".repeat(61) }, { name: "" }, { name: "x".repeat(201) }, { height: -1 }, { height: 301 }, { height: NaN }, { height: "9" }]) {
      expect(recordFinds(s, cmd({ foundations: [typed("a", bad)] })).ok, JSON.stringify(bad)).toBe(false);
    }
    expect(recordFinds(s, cmd({ foundations: [typed("a", { height: 0 }), typed("b", { height: 300 })] })).ok).toBe(true);
  });
  it("enriches an already recorded foundation that has no type, without stone or chronicle", () => {
    const s1 = rec(town([dig()]), cmd({ foundations: [found("a", 100)] }));
    const s2 = rec(s1, cmd({ foundations: [typed("a")] }));
    expect(s2.finds.foundations).toHaveLength(1);
    expect(s2.finds.foundations[0]).toMatchObject({ id: "a", cls: "school", name: "Школа", height: 12, area: 100 });
    expect(s2.stock.stone).toBe(s1.stock.stone);
    expect(s2.chronicle).toBe(s1.chronicle);
    expect(s1.finds.foundations[0].cls).toBeUndefined(); // the old state is not mutated
    // a type already there is kept
    const s3 = rec(s2, cmd({ foundations: [typed("a", { cls: "library", name: "Другая" })] }));
    expect(s3).toBe(s2);
  });
  it("round-trips through a save; an old save without the fields loads untyped", () => {
    const s = rec(town([dig()]), cmd({ foundations: [typed("a"), found("b")] }));
    expect(parseSave(save(s), NOW)!.sim.finds).toEqual(s.finds);
    const raw = save(s) as { sim: { finds: { foundations: Record<string, unknown>[] } } };
    for (const f of raw.sim.finds.foundations) {
      delete f.cls;
      delete f.name;
      delete f.height;
    }
    const old = parseSave(raw, NOW)!.sim.finds.foundations;
    expect(old).toHaveLength(2);
    expect(old[0].cls).toBeUndefined();
  });
  it("drops a broken type from a save but keeps the foundation", () => {
    const s = rec(town([dig()]), cmd({ foundations: [typed("a")] }));
    const raw = save(s) as { sim: { finds: { foundations: Record<string, unknown>[] } } };
    Object.assign(raw.sim.finds.foundations[0], { cls: 5, name: "", height: 9999 });
    const f = parseSave(raw, NOW)!.sim.finds.foundations[0];
    expect(f.id).toBe("a");
    expect([f.cls, f.name, f.height]).toEqual([undefined, undefined, undefined]);
  });
});
