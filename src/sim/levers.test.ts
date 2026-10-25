import { describe, expect, it } from "vitest";
import { allocateClearings, allocateLabor, BUILDINGS, CREW } from "./buildings";
import { BASE_TICK, queuedLabel, step } from "./clock";
import { clearingLabor } from "./clearing";
import { isEvening } from "./evening";
import { etaRealMs } from "./buildEta";
import { emptyGrowth, seedOf } from "./growth";
import { callBlock, callSettlers, callToloka, setPriority, setRations, setSchedule, tolokaWait } from "./leverCmds";
import { CALL, emptyLevers, RATIONS, STRADA_MOOD, TOLOKA_COOLDOWN, workHours } from "./levers";
import { builderCount, countResidents, foodOutlook, foodPerDay, forageKg, productionScale } from "./people";
import { dailyEconomy } from "./production";
import { addRoad, emptyRoads } from "./roads";
import { parseSave } from "./save";
import type { Building, City, Clearing, SimState } from "./types";
import { YEAR_DAYS } from "./time";
import { emptyZones } from "./zones";

const NOW = 1_800_000_000_000;
const city: City = { name: "Тест", lat: 59.12, lng: 37.9, foundedAt: NOW - 1000 };
const at = (day: number, hour = 0, minute = 0) => (day - 1) * 1440 + hour * 60 + minute - 360;
const NOON = at(3, 12);

const roads = () => {
  const r = addRoad(emptyRoads(), [[0, 0], [240, 0]], "dirt", 1, [0]); // finished: no road work
  if (!r.ok) throw new Error(r.reason);
  return r.graph;
};
const site = (id: number, labor = 1e6): Building => {
  const t = BUILDINGS.izba;
  return { id, template: "izba", zone: "res", lot: { cx: 0, cy: 0, angle: 0, w: t.w, d: t.d }, side: 1, footprint: [[0, 0], [1, 0], [1, 1], [0, 1]], height: t.height, state: "building", labor, done: 0, created: 0, paid: true, level: 1, streak: 0 };
};
const house = (id: number): Building => ({ ...site(id, 100), state: "active", done: 100 });
const clearing = (id: number): Clearing => ({ id, pts: [[0, 0], [10, 0], [10, 10]], area: 5000, forest: 0.8, labor: clearingLabor(5000, 0.8), done: 0 });
const world = (bs: Building[], gm = NOON, cs: Clearing[] = []): SimState => ({
  realTime: NOW,
  gameMinutes: gm,
  roads: roads(),
  zones: emptyZones(),
  ...emptyGrowth(seedOf(city.foundedAt), gm),
  buildings: Object.fromEntries(bs.map((b) => [b.id, b])),
  clearings: cs,
});
const ok = (r: ReturnType<typeof setPriority>): SimState => {
  if (!r.ok) throw new Error(r.reason);
  return r.sim;
};

describe("priority", () => {
  const two = { 1: site(1, 100), 2: site(2, 100) };
  it("a prioritized building goes to the front of both rounds", () => {
    expect([...allocateLabor(two, 8, CREW, [], false, { priority: 2 })]).toEqual([[2, 6], [1, 2]]);
    expect([...allocateLabor(two, 20, CREW, [], false, { priority: 2 })]).toEqual([[2, 14], [1, 6]]);
    expect([...allocateLabor(two, 8, CREW)]).toEqual([[1, 6], [2, 2]]); // none: the oldest first
  });
  it("a prioritized clearing goes ahead of buildings that would come first", () => {
    const cs = [clearing(1), clearing(2)];
    expect(allocateClearings(two, cs, 8, CREW, false, { priority: -2 }).get(2)).toBe(6);
    expect(allocateClearings(two, cs, 8, CREW, false).size).toBe(0);
    expect(allocateLabor(two, 8, CREW, cs, false, { priority: -2 }).size).toBe(1);
  });
  it("the command sets and clears it, and refuses finished or missing sites", () => {
    const s = world([site(1), house(2)]);
    expect(setPriority(s, 2)).toMatchObject({ ok: false });
    expect(setPriority(s, 9)).toMatchObject({ ok: false });
    const p = ok(setPriority(s, 1));
    expect(p.levers.priority).toBe(1);
    expect(p.chronicle.at(-1)?.kind).toBe("order");
    expect(ok(setPriority(p, null)).levers.priority).toBeNull();
  });
  it("the artel works the priority site first and the priority drops when it is finished", () => {
    let s = ok(setPriority(world([site(1), site(2, 5)]), 2));
    s = step(s);
    expect(s.buildings[2].done).toBeGreaterThan(0);
    expect(s.buildings[2].done).toBeLessThanOrEqual(5);
    for (let i = 0; i < 20; i++) s = step(s);
    expect(s.buildings[2].state).toBe("active");
    expect(s.levers.priority).toBeNull();
  });
});

describe("toloka", () => {
  it("focus takes every hand without the crew limit", () => {
    const two = { 1: site(1, 100), 2: site(2, 100) };
    expect([...allocateLabor(two, 20, CREW, [], false, { focus: 2 })]).toEqual([[2, 20]]);
    expect([...allocateLabor({ 1: site(1, 100), 2: site(2, 8) }, 20, CREW, [], false, { focus: 2 })]).toEqual([[2, 8], [1, 12]]);
  });
  it("all adults build the site, production stops, and the day ends it", () => {
    const base = world([site(1), site(2)]);
    const adults = countResidents(base.residents, base.gameMinutes).adults;
    expect(adults).toBeGreaterThanOrEqual(CREW);
    const s0 = ok(callToloka(base, 2));
    expect(s0.levers.toloka).toEqual({ site: 2, until: at(3, 19) });
    expect(builderCount(s0)).toBe(adults);
    expect(productionScale(s0)).toBe(0);
    expect(productionScale(base)).toBe(1);
    const s1 = step(s0);
    expect(s1.buildings[2].done).toBeCloseTo((adults * BASE_TICK) / 60);
    // 18:50: the next tick reaches 19:00 and the call is over
    const late = step({ ...s0, gameMinutes: at(3, 18, 50) });
    expect(late.levers.toloka).toBeNull();
    expect(productionScale(late)).toBe(1);
  });
  it("the call also ends when its site is finished", () => {
    const s = step(ok(callToloka(world([site(1), site(2, 1)]), 2)));
    expect(s.buildings[2].state).toBe("active");
    expect(s.levers.toloka).toBeNull();
  });
  it("cooldown is three game days, work hours only", () => {
    const s = ok(callToloka(world([site(1)]), 1));
    expect(s.levers.tolokaReady).toBe(NOON + TOLOKA_COOLDOWN);
    expect(callToloka(s, 1)).toMatchObject({ ok: false });
    const next = { ...s, levers: { ...s.levers, toloka: null }, gameMinutes: NOON + 1440 };
    expect(callToloka(next, 1)).toMatchObject({ ok: false }); // still resting
    expect(tolokaWait(next)).toBe(2 * 1440);
    expect(callToloka({ ...next, gameMinutes: NOON + TOLOKA_COOLDOWN }, 1)).toMatchObject({ ok: true });
    expect(callToloka(world([site(1)], at(3, 22)), 1)).toMatchObject({ ok: false }); // night
    expect(callToloka(world([house(1)]), 1)).toMatchObject({ ok: false });
  });
});

describe("strada", () => {
  it("work hours follow the schedule", () => {
    const s = ok(setSchedule(world([site(1)]), true));
    expect(workHours(world([]))).toEqual({ start: 7, end: 19 });
    expect(workHours(s)).toEqual({ start: 5, end: 21 });
    expect(workHours(s.levers)).toEqual({ start: 5, end: 21 });
    expect(queuedLabel(at(3, 6), world([]).levers)).toBe("начнут в 07:00");
    expect(queuedLabel(at(3, 6), s.levers)).toBeNull();
    expect(queuedLabel(at(3, 22), s.levers)).toBe("начнут в 05:00");
    expect(isEvening(20, world([]).levers)).toBe(true);
    expect(isEvening(20, s.levers)).toBe(false);
    expect(isEvening(21, s.levers)).toBe(true);
    expect(isEvening(22, s.levers)).toBe(false);
  });
  it("the artel works 05-21: a third more hours", () => {
    const run = (strada: boolean) => {
      let s = { ...world([site(1)], at(3, 0)), levers: { ...emptyLevers(), strada } };
      for (let i = 0; i < 144; i++) s = step(s);
      return s.buildings[1].done;
    };
    expect(run(true) / run(false)).toBeCloseTo(16 / 12, 1);
  });
  it("the build ETA counts the long day", () => {
    const night = at(3, 22);
    const ms = (strada: boolean) => etaRealMs(10, 5, night, 1, { ...emptyLevers(), strada });
    expect(ms(true)).toBeLessThan(ms(false));
  });
  it("lowers the mood target by 8", () => {
    const base = world([house(1)], at(3, 0));
    const mood = (s: SimState) => Object.values(dailyEconomy(s).households)[0].mood;
    const m0 = mood({ ...base, stock: { ...base.stock, food: 1e5 } });
    const m1 = mood({ ...base, stock: { ...base.stock, food: 1e5 }, levers: { ...emptyLevers(), strada: true } });
    expect(m0 - m1).toBeCloseTo(-STRADA_MOOD * 0.25, 5);
  });
});

describe("rations", () => {
  const base = world([house(1)], at(3, 0));
  const rich = { ...base, stock: { ...base.stock, food: 2000 } };
  const eaten = (r: keyof typeof RATIONS) => 2000 + forageKg(rich) - dailyEconomy({ ...rich, levers: { ...emptyLevers(), rations: r } }).stock.food;
  it("food eaten changes by a quarter", () => {
    const need = foodPerDay(rich.residents, rich.gameMinutes);
    expect(eaten("normal")).toBeCloseTo(need);
    expect(eaten("reduced")).toBeCloseTo(need * 0.75);
    expect(eaten("generous")).toBeCloseTo(need * 1.25);
  });
  it("mood target moves by -10 / +8", () => {
    const mood = (r: keyof typeof RATIONS) => Object.values(dailyEconomy({ ...rich, levers: { ...emptyLevers(), rations: r } }).households)[0].mood;
    expect(mood("reduced") - mood("normal")).toBeCloseTo(-10 * 0.25, 5);
    expect(mood("generous") - mood("normal")).toBeCloseTo(8 * 0.25, 5);
  });
  it("the food outlook follows the rations", () => {
    const tight = { ...base, stock: { ...base.stock, food: (1.05 * foodPerDay(base.residents, base.gameMinutes) - forageKg(base)) * YEAR_DAYS } };
    const out = (r: keyof typeof RATIONS) => foodOutlook({ ...tight, levers: { ...emptyLevers(), rations: r } });
    expect(out("reduced")).toBeGreaterThan(out("normal"));
    expect(out("normal")).toBeGreaterThan(out("generous"));
  });
  it("the command validates and logs", () => {
    const s = ok(setRations(base, "reduced"));
    expect(s.levers.rations).toBe("reduced");
    expect(s.chronicle.at(-1)?.text).toContain("урезанные");
    expect(setRations(base, "huge" as never)).toMatchObject({ ok: false });
  });
});

describe("call for settlers", () => {
  const stocked = (s: SimState): SimState => ({ ...s, stock: { ...s.stock, food: 1000, wares: 20 } });
  it("refuses without a vacant house, food or wares", () => {
    expect(callSettlers(stocked(world([site(1)])))).toMatchObject({ ok: false, reason: expect.stringContaining("дома") });
    const h = world([house(1)]);
    expect(callSettlers({ ...h, stock: { ...h.stock, food: 100, wares: 20 } })).toMatchObject({ ok: false, reason: expect.stringContaining("еды") });
    expect(callSettlers({ ...h, stock: { ...h.stock, food: 1000, wares: 2 } })).toMatchObject({ ok: false, reason: expect.stringContaining("товаров") });
  });
  it("spends food and wares, promises the house and the family arrives within a day", () => {
    const s0 = stocked(world([house(1)]));
    const s = ok(callSettlers(s0));
    expect(s.stock.food).toBe(1000 - CALL.food);
    expect(s.stock.wares).toBe(20 - CALL.wares);
    expect(s.incoming).toHaveLength(1);
    expect(s.incoming[0].house).toBe(1);
    expect(s.incoming[0].arrive).toBeGreaterThan(s.gameMinutes);
    expect(s.incoming[0].arrive).toBeLessThanOrEqual(s.gameMinutes + 1440);
    expect(callBlock(s)).toContain("дома"); // the only house is promised
    expect(callSettlers(s)).toMatchObject({ ok: false });
    let cur = s;
    const pop = Object.keys(cur.residents).length;
    for (let i = 0; i < 144 && cur.incoming.length > 0; i++) cur = step(cur);
    expect(cur.incoming).toHaveLength(0);
    expect(Object.keys(cur.residents).length).toBeGreaterThan(pop);
  });
});

describe("saving", () => {
  const save = (sim: Record<string, unknown>) => ({ version: 4, city, sim: JSON.parse(JSON.stringify(sim)) });
  it("levers survive a round trip", () => {
    let s = world([site(1)]);
    s = ok(callToloka(ok(setPriority(ok(setSchedule(ok(setRations(s, "generous")), true)), 1)), 1));
    const back = parseSave(save({ ...s, realTime: NOW }), NOW + 1000);
    expect(back?.sim.levers).toEqual(s.levers);
  });
  it("old saves load with every lever off", () => {
    const { levers: _l, ...old } = world([site(1)]);
    expect(parseSave(save({ ...old, realTime: NOW }), NOW + 1000)?.sim.levers).toEqual(emptyLevers());
    expect(parseSave(save({ ...old, levers: { rations: "bogus", toloka: { site: 0 }, strada: "yes", priority: 1.5 }, realTime: NOW }), NOW + 1000)?.sim.levers).toEqual(emptyLevers());
  });
});
