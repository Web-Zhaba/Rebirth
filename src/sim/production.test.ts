import { allUnlocked } from "./goals";
import { describe, expect, it } from "vitest";
import { advanceTo, BASE_TICK, calendar, step } from "./clock";
import { BARN_CAP, BUILDINGS, foodCapacity, FOOD_CAMP_CAP, FOUNDING_STOCK } from "./buildings";
import { assignFields, FIELD, HARVEST_END_DAY, jobsOf, windowAt } from "./fields";
import { canPlace, emptyGrowth, placeBuilding, reconcile } from "./growth";
import { Handler, type Storage } from "./handler";
import { builderCount, dailyStep, foodPerDay, immigrationStep, peopleStats, queryBuilding, RATES } from "./people";
import { dailyEconomy, economyStats, HAND_HOURS, handHours, PACE, payMaterials, produceStep, RATE } from "./production";
import type { FromWorker } from "./protocol";
import { massText } from "./units";
import { addRoad, emptyRoads } from "./roads";
import { parseSave } from "./save";
import { YEAR_DAYS, YEAR_MIN } from "./time";
import type { Building, City, Field, Household, Resident, RoadGraph, SaveV4, SimState, Site, TerrainInfo } from "./types";
import { emptyZones, paintCells, qkey, regenerateCells } from "./zones";

const NOW = 1_800_000_000_000;
const meadow: TerrainInfo = { land: "meadow", slope: 0 };
const NO_SITE: Site = { forest: 0, water: 0, rock: 0 };

// gameMinutes of `hour`:00 on day-of-year `day` (1..YEAR_DAYS) of year `year`.
const at = (day: number, hour = 0, year = 1) => ((year - 1) * YEAR_DAYS + day - 1) * 1440 + hour * 60 - 360;
const NOON = at(12, 12); // summer
const SPRING_NOON = at(4, 12);
const HARVEST_NOON = at(18, 12);
const WINTER_NOON = at(28, 12);

const road = (pts: [number, number][], labor = 0): RoadGraph => {
  const r = addRoad(emptyRoads(), pts, "dirt", 1, pts.slice(1).map(() => labor));
  if (!r.ok) throw new Error(r.reason);
  return r.graph;
};
const roadAlong = (len = 2000, labor = 0): RoadGraph => road(Array.from({ length: Math.floor(len / 100) + 1 }, (_, i): [number, number] => [i * 100, 0]), labor);

function bld(id: number, template: string, x: number, state: Building["state"] = "active", site?: Site): Building {
  const t = BUILDINGS[template];
  const b: Building = {
    id,
    template,
    zone: t.zone,
    lot: { cx: x, cy: 3 + 4 * t.d, angle: 0, w: t.w, d: t.d },
    side: 1,
    footprint: [[x, 5], [x + 1, 5], [x + 1, 6], [x, 6]],
    height: t.height,
    state,
    labor: t.labor,
    done: state === "active" ? t.labor : 0,
    created: 0,
    paid: state !== "planned",
    level: 1,
    streak: 0,
  };
  if (site) b.site = site;
  return b;
}

const rect = (id: number, x0: number, y0: number, x1: number, y1: number): Field => ({
  id,
  pts: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]],
  area: (x1 - x0) * (y1 - y0),
});
const FIELD10 = (id = 1, x0 = 100) => rect(id, x0, 60, x0 + 200, 560); // 10 ha

function town(bs: Building[], opts: { gm?: number; fields?: Field[]; roads?: RoadGraph; terrain?: (key: string) => TerrainInfo } = {}): SimState {
  const gm = opts.gm ?? NOON;
  const roads = opts.roads ?? roadAlong();
  const fields = opts.fields ?? [];
  const terrain: Record<string, TerrainInfo> = {};
  for (const c of regenerateCells(roads, [], fields, {})) terrain[qkey(c.cx, c.cy)] = opts.terrain ? opts.terrain(qkey(c.cx, c.cy)) : meadow;
  const cells = regenerateCells(roads, [], fields, terrain);
  const buildings: Record<number, Building> = {};
  for (const b of bs) buildings[b.id] = b;
  return {
    realTime: NOW,
    gameMinutes: gm,
    roads,
    zones: { cells, fields, terrain, rev: 1 },
    ...emptyGrowth(7, gm),
    goals: allUnlocked(),
    stock: { food: 1750, logs: 0, planks: 0, stone: 0, wares: 20 }, // a bare camp, not the founding stock
    buildings,
    nextBuildingId: bs.length + 1,
  };
}

interface HSpec {
  home: number | null;
  adults?: number;
  kids?: number;
  job?: number; // workplace of every adult
  mood?: number;
}

// Replaces the founders with exactly these households (adults 30, children 5).
function folk(s: SimState, specs: HSpec[]): SimState {
  const residents: Record<number, Resident> = {};
  const households: Record<number, Household> = {};
  let pid = 1;
  specs.forEach((sp, i) => {
    const hid = i + 1;
    const members: number[] = [];
    const add = (age: number, job: number | null) => {
      const id = pid++;
      residents[id] = {
        id,
        first: "Иван",
        last: "Тестов",
        sex: "m",
        born: s.gameMinutes - age * YEAR_MIN,
        household: hid,
        spouse: null,
        job,
        commute: job === null ? null : 5,
        idleDays: 0,
        literate: false,
        school: 0,
      };
      members.push(id);
    };
    for (let k = 0; k < (sp.adults ?? 1); k++) add(30, sp.job ?? null);
    for (let k = 0; k < (sp.kids ?? 0); k++) add(5, null);
    households[hid] = { id: hid, last: "Тестов", home: sp.home, members, arrived: 0, founder: false, mood: sp.mood ?? 60 };
  });
  return { ...s, residents, households, nextPersonId: pid, nextHouseholdId: specs.length + 1, events: [] };
}

const work = (s: SimState, dt = 1) => produceStep(s, dt);
// An unfinished house far away: construction work exists, so jobless adults are builders, not idle.
const busy = (s: SimState): SimState => ({ ...s, buildings: { ...s.buildings, 900: bld(900, "izba", 1900, "planned") } });

describe("storage", () => {
  it("food capacity is 3 t plus 30 t per finished barn", () => {
    expect(foodCapacity({})).toBe(FOOD_CAMP_CAP);
    expect(foodCapacity({ 1: bld(1, "barn", 0), 2: bld(2, "barn", 50), 3: bld(3, "barn", 90, "building") })).toBe(FOOD_CAMP_CAP + 2 * BARN_CAP);
  });
  it("surplus food rots, with one event a day", () => {
    let s = folk(town([bld(1, "fisher", 50)]), [{ home: null, adults: 2, job: 1 }]);
    s = { ...s, stock: { ...s.stock, food: FOOD_CAMP_CAP - 0.1 } };
    s = work(s);
    expect(s.stock.food).toBe(FOOD_CAMP_CAP);
    s = work(s);
    s = work(s);
    expect(s.prod.flags.rot).toBeCloseTo(1.2 * 3 - 0.1);
    expect(s.events).toHaveLength(0);
    s = { ...s, prod: { ...s.prod, flags: { ...s.prod.flags, rot: 480 } } };
    const d = dailyEconomy({ ...s, gameMinutes: at(13) });
    expect(d.events.filter((e) => e.text.startsWith("Пропало"))).toHaveLength(1);
    expect(d.events[0].text).toContain("480 кг");
    expect(d.prod.flags.rot).toBe(0);
    // a barn raises the capacity: nothing rots
    let b = folk(town([bld(1, "fisher", 50), bld(2, "barn", 90)]), [{ home: null, adults: 2, job: 1 }]);
    b = work({ ...b, stock: { ...b.stock, food: FOOD_CAMP_CAP } });
    expect(b.stock.food).toBeCloseTo(FOOD_CAMP_CAP + 1.2);
    expect(b.prod.flags.rot).toBe(0);
  });
  it("daily rot trims food above capacity (a barn was demolished)", () => {
    let s = folk(town([]), [{ home: null, adults: 1 }]);
    s = { ...s, stock: { ...s.stock, food: 5000 } };
    const d = dailyEconomy({ ...s, gameMinutes: at(13) });
    expect(d.stock.food).toBe(FOOD_CAMP_CAP);
    expect(d.events[0].text).toContain("не хватает складов");
  });
});

describe("food", () => {
  it("adults eat 0.7 kg and children 0.45 kg a day", () => {
    let s = busy(folk(town([]), [{ home: null, adults: 2, kids: 2 }]));
    expect(foodPerDay(s.residents, s.gameMinutes)).toBeCloseTo(2.3);
    const d = dailyEconomy({ ...s, gameMinutes: at(13) });
    expect(d.stock.food).toBeCloseTo(s.stock.food - 2.3);
    expect(d.prod.flags.hungry).toBe(false);
  });
  it("a shortage feeds everyone the same fraction and says so once", () => {
    let s = folk(town([]), [{ home: 1, adults: 1 }, { home: null, adults: 1, kids: 2 }]);
    s = busy({ ...s, buildings: { 1: bld(1, "izba", 0) } });
    s = { ...s, stock: { ...s.stock, food: 1 } }; // needs 0.7 + 0.7 + 0.9 = 2.3
    const d = dailyEconomy({ ...s, gameMinutes: at(13) });
    expect(d.stock.food).toBe(0);
    expect(d.events.map((e) => e.text)).toEqual(["Еда закончилась, люди голодают"]);
    // fed = 1 / 2.3: both households move a quarter of the way towards 10 + 45 fed (+10 with a house)
    const fed = 1 / 2.3;
    expect(d.households[1].mood).toBeCloseTo(60 + (10 + 45 * fed + 10 - 60) / 4);
    expect(d.households[2].mood).toBeCloseTo(60 + (10 + 45 * fed - 60) / 4);
    const again = dailyEconomy({ ...d, gameMinutes: at(14) });
    expect(again.events).toHaveLength(1);
    expect(again.prod.flags.hungry).toBe(true);
  });
  it("files yesterday's output", () => {
    let s = folk(town([bld(1, "woodcutter", 50, "active", { forest: 1, water: 0, rock: 0 })]), [{ home: null, adults: 2, job: 1 }]);
    s = work(s);
    const d = dailyEconomy({ ...s, gameMinutes: at(13) });
    expect(d.prod.today).toEqual({});
    expect(d.prod.yesterday[1]).toBeCloseTo(2 * RATE.logs * PACE);
    expect(economyStats(d).yesterday.logs).toBeCloseTo(2 * RATE.logs * PACE);
  });
});

describe("producers", () => {
  const staffed = (template: string, n: number, site?: Site, gm = NOON) => folk(town([bld(1, template, 50, "active", site)], { gm }), [{ home: null, adults: n, job: 1 }]);
  it("woodcutter: RATE.logs m3 per hour x PACE x forest share", () => {
    expect(work(staffed("woodcutter", 2, { forest: 0.6, water: 0, rock: 0 })).stock.logs).toBeCloseTo(2 * RATE.logs * PACE * 0.6);
    expect(work(staffed("woodcutter", 2, NO_SITE)).stock.logs).toBe(0);
  });
  it("quarry: 0.15 t per hour x PACE, with or without rock nearby", () => {
    expect(work(staffed("quarry", 3, { forest: 0, water: 0, rock: 0.5 })).stock.stone).toBeCloseTo(3 * 0.15 * PACE);
    expect(work(staffed("quarry", 3, NO_SITE)).stock.stone).toBeCloseTo(3 * 0.15 * PACE);
  });
  it("fisher: 0.6 kg per hour, halved in winter", () => {
    expect(work(staffed("fisher", 2, { forest: 0, water: 1, rock: 0 })).stock.food - 1750).toBeCloseTo(1.2);
    expect(work(staffed("fisher", 2, { forest: 0, water: 1, rock: 0 }, WINTER_NOON)).stock.food - 1750).toBeCloseTo(0.6);
  });
  it("garden: 0.2 kg per hour in the growing seasons, nothing in winter", () => {
    expect(work(staffed("garden", 3, NO_SITE)).stock.food - 1750).toBeCloseTo(0.6);
    expect(work(staffed("garden", 3, NO_SITE, WINTER_NOON)).stock.food - 1750).toBeCloseTo(0);
  });
  it("hunter: 0.15 kg per hour, most in winter", () => {
    expect(work(staffed("hunter", 2, NO_SITE)).stock.food - 1750).toBeCloseTo(0.15);
    expect(work(staffed("hunter", 2, NO_SITE, WINTER_NOON)).stock.food - 1750).toBeCloseTo(0.6);
  });
  it("sawpit: 0.02 m3 per hour x PACE, 1.6 m3 of logs per m3; stops without logs", () => {
    let s = staffed("sawpit", 2);
    s = { ...s, stock: { ...s.stock, logs: 10 } };
    const a = work(s);
    expect(a.stock.planks).toBeCloseTo(2 * 0.02 * PACE);
    expect(a.stock.logs).toBeCloseTo(10 - 2 * 0.02 * PACE * 1.6);
    const none = work({ ...s, stock: { ...s.stock, logs: 0 } });
    expect(none.stock.planks).toBe(0);
    expect(none.prod.today[1]).toBeUndefined();
    const part = work({ ...s, stock: { ...s.stock, logs: 0.16 } }); // enough for 0.1 m3 of planks only
    expect(part.stock.planks).toBeCloseTo(0.1);
    expect(part.stock.logs).toBeCloseTo(0);
  });
  it("workshops: pottery needs nothing, smithy eats logs, carpentry eats planks", () => {
    expect(work(staffed("pottery", 3)).stock.wares - 20).toBeCloseTo(3 * 0.025);
    let sm = staffed("smithy", 3);
    expect(work(sm).stock.wares).toBe(20); // no logs, no wares
    sm = { ...sm, stock: { ...sm.stock, logs: 5 } };
    const a = work(sm);
    expect(a.stock.wares - 20).toBeCloseTo(3 * 0.015);
    expect(a.stock.logs).toBeCloseTo(5 - 3 * 0.015 * 0.05);
    let c = staffed("carpentry", 4);
    expect(work(c).stock.wares).toBe(20);
    c = { ...c, stock: { ...c.stock, planks: 2 } };
    const b = work(c);
    expect(b.stock.wares - 20).toBeCloseTo(4 * 0.015);
    expect(b.stock.planks).toBeCloseTo(2 - 4 * 0.015 * 0.03);
  });
  it("only employed workers produce, and only during work hours", () => {
    const s = folk(town([bld(1, "pottery", 50)]), [{ home: null, adults: 3 }]);
    expect(work(s).stock.wares).toBe(20); // nobody employed
    const w = folk(town([bld(1, "pottery", 50)], { gm: at(12, 12) }), [{ home: null, adults: 3, job: 1 }]);
    expect(step(w).stock.wares).toBeGreaterThan(20);
    const night = { ...w, gameMinutes: at(12, 22) };
    expect(step(night).stock.wares).toBe(20);
  });
});

describe("fields", () => {
  const farm = (gm: number, farmers = 4, extra: Building[] = []) =>
    folk(town([bld(1, "gumno", 200), bld(2, "barn", 500), ...extra], { gm, fields: [FIELD10()] }), [{ home: null, adults: farmers, job: 1 }]);

  it("sowing, harvest and the remainder lost", () => {
    const SOW = FIELD.sowHoursHa * 10; // person-hours of sowing for the 10 ha
    const HARV = FIELD.harvestHoursHa * 10;
    const YIELD = FIELD.yieldKgHa * 10; // reaped at 2 kg per hour, so HARV hours
    let s = farm(SPRING_NOON);
    s = work(s, SOW / 8); // 4 farmers x SOW / 8 h = half sown
    expect(s.events.map((e) => e.text)).toEqual(["Начался сев"]);
    expect(economyStats(s).fields.sown).toBeCloseTo(0.5);
    expect(economyStats(s).fields.expected).toBeCloseTo(YIELD / 2);
    s = work(s, SOW / 8);
    expect(economyStats(s).fields.sown).toBeCloseTo(1);
    s = work(s, SOW / 8); // nothing left to sow
    expect(s.prod.fields[1].sowH).toBeCloseTo(SOW);
    expect(s.events).toHaveLength(1);
    // harvest: half of it in the first go
    s = { ...s, gameMinutes: HARVEST_NOON };
    const food0 = s.stock.food;
    s = work(s, HARV / 8); // 4 farmers x HARV / 8 h
    expect(s.stock.food - food0).toBeCloseTo(YIELD / 2);
    expect(s.prod.fields[1].reaped).toBeCloseTo(YIELD / 2);
    expect(s.events.map((e) => e.text)).toEqual(["Начался сев", "Началась уборка урожая"]);
    // the window ends with half the grain still standing
    const lost = dailyEconomy({ ...s, gameMinutes: at(HARVEST_END_DAY + 1) });
    expect(lost.events.at(-1)!.text).toBe(`Зерно осталось в поле и пропало: ${massText(YIELD / 2)}`);
    expect(lost.prod.flags.closed).toBe(true);
    expect(dailyEconomy({ ...lost, gameMinutes: at(HARVEST_END_DAY + 2) }).events).toHaveLength(lost.events.length); // told once
    // finish instead: done event with the amount
    const done = work(s, HARV / 8);
    expect(done.prod.fields[1].reaped).toBeCloseTo(YIELD);
    expect(done.events.at(-1)!.text).toBe(`Урожай собран: ${massText(YIELD)}`);
    expect(work(done, HARV / 8).events).toHaveLength(done.events.length);
    expect(dailyEconomy({ ...done, gameMinutes: at(HARVEST_END_DAY + 1) }).events).toHaveLength(done.events.length); // nothing lost
    expect(done.prod.today[1]).toBeCloseTo(YIELD);
  });
  it("a field sown in the first spring is harvested in the first autumn: 35.6 kg per sown hectare", () => {
    // founding at spring day 1; the harvest window is days 17-20
    let s = farm(at(1, 12));
    expect(calendar(s.gameMinutes)).toMatchObject({ season: 0, dayOfSeason: 1 });
    s = work(s, 12); // one work day of 4 farmers (48 h) covers the 44.4 h of sowing
    expect(s.prod.fields[1].sowH).toBeCloseTo(FIELD.sowHoursHa * 10);
    const food0 = s.stock.food;
    for (let day = 17; day <= HARVEST_END_DAY; day++) {
      expect(windowAt(at(day, 12))).toBe("harvest");
      s = work({ ...s, gameMinutes: at(day, 12) }, 12);
    }
    expect(windowAt(at(HARVEST_END_DAY + 1, 12))).toBeNull();
    expect(s.prod.fields[1].reaped).toBeCloseTo((400 * 32 / 360) * 10);
    expect(s.stock.food - food0).toBeCloseTo(s.prod.fields[1].reaped);
    expect(s.events.at(-1)!.text).toBe("Урожай собран: 356 кг");
  });
  it("what was not sown cannot be harvested, and progress starts over each year", () => {
    let s = farm(HARVEST_NOON);
    s = work(s, 250);
    expect(s.stock.food).toBe(1750);
    expect(s.prod.fields[1]?.reaped ?? 0).toBe(0);
    s = farm(SPRING_NOON);
    s = work(s, 200);
    const next = { ...s, gameMinutes: at(4, 12, 2) };
    expect(economyStats(next).fields.sown).toBe(0);
    expect(dailyEconomy({ ...next, gameMinutes: at(4, 0, 2) }).prod.fields).toEqual({});
  });
  it("farmers work only inside the windows; otherwise they join the artel", () => {
    const people = (gm: number) => farm(gm, 4);
    // two jobless adults on top
    const withJobless = (gm: number) => {
      const s = people(gm);
      return folk({ ...s, residents: {}, households: {} }, [{ home: null, adults: 4, job: 1 }, { home: null, adults: 2 }]);
    };
    const mk = (gm: number) => {
      const s = people(gm);
      const f = withJobless(gm);
      // an unfinished building keeps the artel busy, so its hands count as builders
      return { ...s, residents: f.residents, households: f.households, buildings: { ...s.buildings, 9: bld(9, "izba", 700, "planned") } };
    };
    expect(builderCount(mk(SPRING_NOON))).toBe(3); // 2 jobless + 1 drafted: the artel has at least 3
    expect(builderCount(mk(at(14, 12)))).toBe(6); // mid-summer, after the late sowing days: the land has no work
    expect(builderCount(mk(HARVEST_NOON))).toBe(6); // nothing was sown, so nothing to reap
    const sown = (s: SimState) => ({ ...s, prod: { ...s.prod, fields: { 1: { year: 1, sowH: 500, harvH: 0, reaped: 0 } } } });
    expect(builderCount(sown(mk(HARVEST_NOON)))).toBe(3);
    const reaped = { ...mk(HARVEST_NOON) };
    expect(builderCount({ ...reaped, prod: { ...reaped.prod, fields: { 1: { year: 1, sowH: 500, harvH: 2000, reaped: 4000 } } } })).toBe(6); // harvest done
    expect(builderCount(mk(at(22, 12)))).toBe(6); // after the first 45 days of autumn
    expect(builderCount(mk(WINTER_NOON))).toBe(6);
    expect(peopleStats(mk(at(14, 12))).builders).toBe(6);
    expect(peopleStats(mk(SPRING_NOON)).builders).toBe(3);
  });
  it("gumno jobs: one per 2.5 ha, at most 16, none without fields", () => {
    const g = (fields: Field[]) => {
      const s = town([bld(1, "gumno", 200)], { fields });
      return jobsOf(s.buildings[1], s);
    };
    expect(g([])).toBe(0);
    expect(g([FIELD10()])).toBe(4);
    expect(g([rect(1, 100, 60, 150, 100)])).toBe(1); // 0.2 ha
    expect(g([rect(1, 100, 60, 300, 160), rect(2, 100, 200, 300, 300)])).toBe(2); // 2 + 2 ha
    expect(g([rect(1, -300, 60, 700, 260), rect(2, -300, 260, 700, 460), rect(3, -300, -460, 700, -260)])).toBe(16); // 60 ha
    // not finished: no jobs, no fields
    const s = town([bld(1, "gumno", 200, "building")], { fields: [FIELD10()] });
    expect(jobsOf(s.buildings[1], s)).toBe(0);
  });
  it("a field goes to the nearest gumno within 400 m", () => {
    const f = [FIELD10(1, 100), FIELD10(2, 1100)];
    const s = town([bld(1, "gumno", 200), bld(2, "gumno", 1200), bld(3, "gumno", 1050)], { fields: f });
    expect(assignFields(s.zones.fields, s.buildings)).toEqual(new Map([[1, 1], [2, 2]])); // field 2 centre (1200, 310): gumno 2 is nearer
    const far = town([bld(1, "gumno", 900)], { fields: [FIELD10(1, 100)] });
    expect(assignFields(far.zones.fields, far.buildings).size).toBe(0);
    const tie = town([bld(2, "gumno", 100), bld(1, "gumno", 300)], { fields: [FIELD10(1, 100)] });
    expect(assignFields(tie.zones.fields, tie.buildings).get(1)).toBe(1);
  });
  it("the daily job step fills a gumno up to its dynamic capacity", () => {
    const homes = [3, 4, 5, 6, 7, 8].map((id) => bld(id, "izba", 600 + 40 * id));
    let s = farm(SPRING_NOON, 0, homes);
    s = folk(s, homes.map((b) => ({ home: b.id, adults: 1 })));
    const d = dailyStep({ ...s, gameMinutes: at(31) }, { only: [] });
    expect(Object.values(d.residents).filter((r) => r.job === 1)).toHaveLength(4);
    const q = queryBuilding(d, 1);
    expect(q).toMatchObject({ kind: "workplace", capacity: 4 });
    // fields removed: the farmers lose their jobs
    const bare = dailyStep({ ...d, zones: { ...d.zones, fields: [] } }, { only: [] });
    expect(Object.values(bare.residents).filter((r) => r.job === 1)).toHaveLength(0);
    // fewer hectares: surplus workers are released
    const half = dailyStep({ ...d, zones: { ...d.zones, fields: [rect(1, 100, 60, 300, 360)] } }, { only: [] }); // 6 ha: 3 jobs
    expect(Object.values(half.residents).filter((r) => r.job === 1)).toHaveLength(3);
  });
});

describe("construction materials", () => {
  const planned = (template = "izba") => ({ 1: bld(1, template, 50, "planned") });
  it("takes the materials from the stock when work starts", () => {
    const M = BUILDINGS.izba.materials;
    const stock = { food: 0, logs: 30, planks: 5, stone: 4, wares: 0 };
    const r = payMaterials(planned(), stock, 1);
    expect(r.stock).toEqual({ food: 0, logs: 30 - M.logs, planks: 5 - M.planks, stone: 4 - M.stone, wares: 0 });
    expect(r.buildings[1].paid).toBe(true);
    expect(r.buildings[1].labor).toBe(BUILDINGS.izba.labor); // nothing missing
    // paid once only
    expect(payMaterials(r.buildings, r.stock, 1).stock).toEqual(r.stock);
    // no hours, no purchase
    expect(payMaterials(planned(), stock, 0).stock).toEqual(stock);
  });
  it("makes the shortfall by hand and adds it to the labor", () => {
    const M = BUILDINGS.izba.materials;
    const stock = { food: 0, logs: M.logs - 5, planks: 0, stone: M.stone + 3, wares: 0 };
    const r = payMaterials(planned(), stock, 1);
    // short by 5 m3 of logs and all the planks; the stone is there
    const hand = 5 * HAND_HOURS.logs + M.planks * HAND_HOURS.planks;
    expect(r.buildings[1].labor).toBeCloseTo(BUILDINGS.izba.labor + hand);
    expect(r.stock).toEqual({ food: 0, logs: 0, planks: 0, stone: 3, wares: 0 });
    expect(r.buildings[1].hand).toBeCloseTo(hand); // kept for the building panel
    expect(handHours(BUILDINGS.izba.materials, stock)).toBeCloseTo(r.buildings[1].hand!);
    expect(payMaterials(planned(), { food: 0, logs: 30, planks: 5, stone: 4, wares: 0 }, 1).buildings[1]).not.toHaveProperty("hand");
    expect(HAND_HOURS).toEqual({ logs: 4, planks: 12, stone: 2 });
  });
  it("only the building that really receives hours pays", () => {
    const two = { 1: bld(1, "izba", 50, "planned"), 2: bld(2, "izba", 90, "planned") };
    const r = payMaterials(two, { food: 0, logs: 100, planks: 10, stone: 10, wares: 0 }, 5);
    expect(r.buildings[1].paid).toBe(true);
    expect(r.buildings[2].paid).toBe(false);
    const both = payMaterials(two, { food: 0, logs: 100, planks: 10, stone: 10, wares: 0 }, BUILDINGS.izba.labor + 1);
    expect(both.buildings[2].paid).toBe(true);
  });
  it("a work tick pays and builds", () => {
    let s = folk(town(Object.values(planned()), { gm: NOON }), [{ home: null, adults: 6 }]);
    const M = BUILDINGS.izba.materials;
    s = { ...s, stock: { ...s.stock, logs: M.logs, planks: M.planks, stone: M.stone } };
    const a = step(s);
    expect(a.stock).toMatchObject({ logs: 0, planks: 0, stone: 0 });
    expect(a.buildings[1].paid).toBe(true);
    expect(a.buildings[1].done).toBeCloseTo(1); // 6 adults x 10 min
    expect(a.buildings[1].labor).toBe(BUILDINGS.izba.labor);
    const b = step(a);
    expect(b.stock).toMatchObject({ logs: 0, planks: 0, stone: 0 });
  });
});

describe("mood", () => {
  it("moves a quarter of the way to 10 + 45 fed + 10 wares + 10 house", () => {
    let s = busy(folk(town([bld(1, "izba", 0)]), [{ home: 1, adults: 2 }, { home: null, adults: 2 }]));
    const d = dailyEconomy({ ...s, gameMinutes: at(13) });
    expect(d.households[1].mood).toBeCloseTo(60 + (65 - 60) / 4);
    expect(d.households[2].mood).toBeCloseTo(60 + (55 - 60) / 4);
  });
  it("wares from trade workers lift it: 12 households a day per trader, 0.05 per person", () => {
    const specs: HSpec[] = [{ home: null, adults: 1, job: 1 }, ...Array.from({ length: 13 }, () => ({ home: null, adults: 2, kids: 2 }))];
    let s = busy(folk(town([bld(1, "shop", 50)]), specs));
    s = { ...s, stock: { ...s.stock, wares: 100 } };
    const d = dailyEconomy({ ...s, gameMinutes: at(13) });
    // one trader serves 12 of the 14 households
    const took = s.stock.wares - d.stock.wares; // the one-person household is served on some days only
    expect(took).toBeGreaterThanOrEqual(0.05 + 0.2 * 11 - 1e-9);
    expect(took).toBeLessThanOrEqual(0.2 * 12 + 1e-9);
    const lifted = Object.values(d.households).filter((h) => h.mood > 59);
    expect(lifted).toHaveLength(12);
    // no wares: nothing is handed out
    const dry = dailyEconomy({ ...s, stock: { ...s.stock, wares: 0 }, gameMinutes: at(13) });
    expect(dry.stock.wares).toBe(0);
    expect(Object.values(dry.households).every((h) => Math.abs(h.mood - 58.75) < 1e-9)).toBe(true);
    // the next day starts from another household
    const d2 = dailyEconomy({ ...s, gameMinutes: at(14) });
    const a = Object.values(d.households).filter((h) => h.mood > 59).map((h) => h.id).join();
    const b = Object.values(d2.households).filter((h) => h.mood > 59).map((h) => h.id).join();
    expect(a).not.toBe(b);
  });
  it("households in houses with mood below 35 leave, 10 % a day; tents never", () => {
    const s = folk(town([bld(1, "izba", 0)]), [{ home: 1, adults: 2, mood: 20 }, { home: null, adults: 2, mood: 20 }, { home: 1, adults: 1, mood: 50 }]);
    const t = { ...s, households: { ...s.households, 3: { ...s.households[3], home: 1 } } };
    // household 3 shares nothing with 1 here only for the test: give it its own house
    const two = { ...t, buildings: { 1: bld(1, "izba", 0), 2: bld(2, "izba", 50) }, households: { ...t.households, 3: { ...t.households[3], home: 2 } } };
    const out = dailyStep(two, { rand: () => 0.05, only: ["emigration"] });
    expect(Object.keys(out.households).map(Number).sort()).toEqual([2, 3]);
    expect(out.events.at(-1)!.kind).toBe("departure");
    const stay = dailyStep(two, { rand: () => 0.15, only: ["emigration"] });
    expect(Object.keys(stay.households)).toHaveLength(3);
    expect(RATES.moodLeaveDay).toBe(0.1);
  });
  it("hunger alone drives a housed household below 35 and out", () => {
    let s = busy(folk(town([bld(1, "izba", 0), bld(2, "izba", 50)]), [{ home: 1, adults: 2 }, { home: 2, adults: 2 }]));
    s = { ...s, stock: { ...s.stock, food: 0 } };
    let m = s.households[1].mood;
    for (let d = 0; d < 12; d++) {
      s = dailyEconomy({ ...s, gameMinutes: at(13 + d) });
      expect(s.households[1].mood).toBeLessThan(m); // moving towards 10 + 10 = 20
      m = s.households[1].mood;
    }
    expect(m).toBeLessThan(35);
    expect(m).toBeGreaterThan(20);
    const out = dailyStep(s, { rand: () => 0.05, only: ["emigration"] });
    expect(Object.keys(out.households)).toHaveLength(0);
  });
  it("a departing household takes its share of the food", () => {
    let s = folk(town([bld(1, "izba", 0)]), [{ home: 1, adults: 2, kids: 1, mood: 10 }, { home: null, adults: 2, kids: 3 }]);
    s = { ...s, stock: { ...s.stock, food: 800 } };
    const out = dailyStep(s, { rand: () => 0.05, only: ["emigration"] });
    expect(Object.keys(out.households)).toEqual(["2"]);
    expect(out.stock.food).toBeCloseTo(800 * (1 - 3 / 8));
    const stay = dailyStep(s, { rand: () => 0.5, only: ["emigration"] });
    expect(stay.stock.food).toBe(800);
  });
  it("attractiveness is scaled by the food outlook and by mood", () => {
    const base = folk(town([bld(1, "izba", 0), bld(2, "izba", 50), bld(3, "izba", 90, "planned")]), [{ home: 1, adults: 2, mood: 100 }]);
    const need = foodPerDay(base.residents, base.gameMinutes) * YEAR_DAYS; // a full year, no harvest or fishers
    // stock for an outlook of o: (stock / need - 0.9) / 0.3 = o
    const run = (o: number, mood = 100) => {
      const s = { ...base, stock: { ...base.stock, food: need * (0.9 + 0.3 * o) }, households: { 1: { ...base.households[1], mood } } };
      return dailyStep(s, { rand: () => 0.5, only: [] }).attract;
    };
    expect(run(1)).toBeCloseTo(1);
    expect(run(0.5)).toBeCloseTo(0.5);
    expect(run(1, 50)).toBeCloseTo(0.5);
    expect(run(0.8, 50)).toBeCloseTo(0.4);
    expect(run(0, 100)).toBe(0); // below 90 % of the need: nobody comes
  });
  it("immigrants bring 60 days of their food, up to the capacity", () => {
    const base = folk(town([bld(1, "izba", 0), bld(2, "izba", 50), bld(3, "izba", 90, "planned")]), [{ home: 1, adults: 2, mood: 100 }]);
    const s = { ...base, attract: 0, incoming: [{ house: 2, arrive: base.gameMinutes }], stock: { ...base.stock, food: 1000 } };
    const d = immigrationStep(s, BASE_TICK);
    const added = d.stock.food - 1000;
    const newcomers = Object.values(d.residents).filter((r) => r.household === 2);
    expect(added).toBeGreaterThanOrEqual(2 * 0.7 * 60 - 1e-9);
    expect(added).toBeCloseTo(newcomers.reduce((m, r) => m + (r.born > d.gameMinutes - 16 * YEAR_MIN ? 0.45 : 0.7), 0) * 60);
    const full = immigrationStep({ ...s, stock: { ...s.stock, food: FOOD_CAMP_CAP - 10 } }, BASE_TICK);
    expect(full.stock.food).toBe(FOOD_CAMP_CAP);
  });
});

// ---------- placement ----------

describe("placement", () => {
  const edgeId = (s: SimState) => Number(Object.keys(s.roads.edges)[0]);
  const base = () => town([], { roads: road([[0, 0], [160, 0]]) });
  const t = (id: string) => BUILDINGS[id];

  it("accepts a free lot beside a built road", () => {
    const s = base();
    expect(canPlace(s, t("barn"), edgeId(s), 1, 3, NO_SITE)).toEqual({ ok: true });
    expect(canPlace(s, t("gumno"), edgeId(s), -1, 3, NO_SITE)).toEqual({ ok: true }); // 1 x 2 cells
  });
  it("rejects bad edges, unbuilt roads, lots running off the road and non-placed templates", () => {
    const s = base();
    const e = edgeId(s);
    expect(canPlace(s, t("barn"), 999, 1, 0, NO_SITE)).toMatchObject({ ok: false, reason: "Нет такой дороги" });
    expect(canPlace(s, t("barn"), e, 1, 99, NO_SITE)).toMatchObject({ ok: false, reason: "Не хватает места вдоль дороги" });
    expect(canPlace(s, t("izba"), e, 1, 3, NO_SITE)).toMatchObject({ ok: false });
    const slow = town([], { roads: road([[0, 0], [160, 0]], 50) });
    expect(canPlace(slow, t("barn"), edgeId(slow), 1, 3, NO_SITE)).toMatchObject({ ok: false, reason: "Дорога ещё не построена" });
  });
  it("rejects blocked cells (water, steep, field, pending)", () => {
    const s = base();
    const e = edgeId(s);
    const water = (c: { cx: number; cy: number }) => ({ ...s.zones, terrain: { ...s.zones.terrain, [qkey(c.cx, c.cy)]: { land: "water", slope: 0 } as TerrainInfo } });
    const cell = s.zones.cells.find((c) => c.edge === e && c.side === 1 && c.i === 3 && c.depth === 0)!;
    const zones = water(cell);
    const wet = { ...s, zones: { ...zones, cells: regenerateCells(s.roads, s.zones.cells, [], zones.terrain) } };
    expect(canPlace(wet, t("barn"), e, 1, 3, NO_SITE)).toMatchObject({ ok: false, reason: "Здесь вода" });
    const unknown = { ...s, zones: { ...s.zones, cells: regenerateCells(s.roads, [], [], {}) } };
    expect(canPlace(unknown, t("barn"), e, 1, 3, NO_SITE)).toMatchObject({ ok: false, reason: "Местность ещё изучается" });
  });
  it("rejects lots under another building and accepts the neighbouring one", () => {
    let s = base();
    const e = edgeId(s);
    s = placeBuilding(s, t("barn"), e, 1, 3, NO_SITE);
    expect(canPlace(s, t("barn"), e, 1, 3, NO_SITE)).toMatchObject({ ok: false, reason: "Место занято зданием" });
    expect(canPlace(s, t("barn"), e, 1, 4, NO_SITE)).toEqual({ ok: true });
    expect(canPlace(s, t("gumno"), e, 1, 3, NO_SITE)).toMatchObject({ ok: false });
  });
  it("site thresholds: woodcutter forest >= 10 %, fisher water >= 5 %, quarry not on water or wetland", () => {
    const s = base();
    const e = edgeId(s);
    expect(canPlace(s, t("woodcutter"), e, 1, 3, { forest: 0.09, water: 0, rock: 0 })).toMatchObject({ ok: false });
    expect(canPlace(s, t("woodcutter"), e, 1, 3, { forest: 0.1, water: 0, rock: 0 })).toEqual({ ok: true });
    expect(canPlace(s, t("fisher"), e, 1, 3, { forest: 0, water: 0.04, rock: 0 })).toMatchObject({ ok: false });
    expect(canPlace(s, t("fisher"), e, 1, 3, { forest: 0, water: 0.05, rock: 0 })).toEqual({ ok: true });
    expect(canPlace(s, t("quarry"), e, 1, 3, NO_SITE)).toEqual({ ok: true });
    const cell = s.zones.cells.find((c) => c.edge === e && c.side === 1 && c.i === 3 && c.depth === 1)!;
    const terrain = { ...s.zones.terrain, [qkey(cell.cx, cell.cy)]: { land: "wetland", slope: 0 } as TerrainInfo };
    const wet = { ...s, zones: { ...s.zones, terrain } };
    expect(canPlace(wet, t("quarry"), e, 1, 3, NO_SITE)).toMatchObject({ ok: false });
    expect(canPlace(wet, t("barn"), e, 1, 3, NO_SITE)).toEqual({ ok: true }); // the barn lot is one cell deep
  });
  it("forager needs 20 % forest; orchard and apiary stay off water and wetland", () => {
    const s = base();
    const e = edgeId(s);
    expect(canPlace(s, t("forager"), e, 1, 3, { forest: 0.19, water: 0, rock: 0 })).toMatchObject({ ok: false });
    expect(canPlace(s, t("forager"), e, 1, 3, { forest: 0.2, water: 0, rock: 0 })).toEqual({ ok: true });
    const cell = s.zones.cells.find((c) => c.edge === e && c.side === 1 && c.i === 3 && c.depth === 0)!;
    const wet = { ...s, zones: { ...s.zones, terrain: { ...s.zones.terrain, [qkey(cell.cx, cell.cy)]: { land: "wetland", slope: 0 } as TerrainInfo } } };
    for (const id of ["orchard", "apiary"]) {
      expect(canPlace(s, t(id), e, 1, 3, NO_SITE)).toEqual({ ok: true });
      expect(canPlace(wet, t(id), e, 1, 3, NO_SITE)).toMatchObject({ ok: false });
    }
  });
  it("placing adds a planned building and clears the painted zone under it", () => {
    let s = base();
    const e = edgeId(s);
    s = { ...s, zones: { ...s.zones, cells: paintCells(s.zones.cells, s.zones.cells.map((c) => c.key), "res") } };
    const placed = placeBuilding(s, t("gumno"), e, 1, 3, { forest: 0.2, water: 0.1, rock: 0 });
    const b = placed.buildings[1];
    expect(b).toMatchObject({ template: "gumno", zone: "placed", state: "planned", paid: false, done: 0, labor: BUILDINGS.gumno.labor, site: { forest: 0.2, water: 0.1, rock: 0 } });
    expect(b.lot).toMatchObject({ w: 1, d: 2 });
    expect(placed.nextBuildingId).toBe(2);
    expect(placed.zones.rev).toBe(s.zones.rev + 1);
    const under = placed.zones.cells.filter((c) => c.edge === e && c.side === 1 && c.i === 3 && c.depth < 2);
    expect(under).toHaveLength(2);
    expect(under.every((c) => c.zone === "none")).toBe(true);
    expect(placed.zones.cells.find((c) => c.edge === e && c.side === 1 && c.i === 4 && c.depth === 0)!.zone).toBe("res");
  });
  it("growth never builds under a placed building", () => {
    let s = base();
    const e = edgeId(s);
    s = placeBuilding(s, t("gumno"), e, 1, 3, NO_SITE);
    // paint everything (the barn lot included) so only the occupancy rule keeps the lot free
    s = { ...s, gameMinutes: at(12, 12), zones: { ...s.zones, cells: paintCells(s.zones.cells, s.zones.cells.map((c) => c.key), "res") } };
    s = { ...s, lastSpawn: { res: -1e9, craft: -1e9, trade: -1e9 } };
    for (let k = 0; k < 400; k++) s = step(s);
    const grown = Object.values(s.buildings).filter((b) => b.id !== 1);
    expect(grown.length).toBeGreaterThan(2);
    const g = s.buildings[1];
    const inLot = (b: Building, x: number, y: number) => {
      const dx = x - b.lot.cx;
      const dy = y - b.lot.cy;
      return Math.abs(dx * Math.cos(b.lot.angle) + dy * Math.sin(b.lot.angle)) <= 4 * b.lot.w + 1e-6 && Math.abs(-dx * Math.sin(b.lot.angle) + dy * Math.cos(b.lot.angle)) <= 4 * b.lot.d + 1e-6;
    };
    for (const b of grown) {
      for (const c of s.zones.cells) {
        if (c.edge === e && c.side === 1 && c.i === 3 && c.depth < 2) expect(inLot(b, c.cx, c.cy)).toBe(false);
      }
      expect(Math.hypot(b.lot.cx - g.lot.cx, b.lot.cy - g.lot.cy)).toBeGreaterThan(7);
    }
  });
  it("reconcile keeps placed buildings unless their road goes", () => {
    let s = base();
    const e = edgeId(s);
    s = placeBuilding(s, t("barn"), e, 1, 3, NO_SITE);
    // zone data changes under it: still kept
    const none = s.zones.cells.map((c) => ({ ...c, zone: "none" as const }));
    expect(reconcile(s.buildings, s.roads, none)).toBe(s.buildings);
    expect(reconcile(s.buildings, { ...s.roads, edges: {} }, none)).toEqual({});
  });
});

describe("handler: placeBuilding and demolish", () => {
  const city: City = { name: "Череповец", lat: 59.12, lng: 37.9, foundedAt: NOW - 1000 };
  async function boot(s: SimState) {
    const save: SaveV4 = { version: 4, city, sim: { ...s, realTime: NOW } };
    let stored: unknown = save;
    const storage: Storage = { get: async () => stored, put: async (v) => void (stored = v), clear: async () => void (stored = undefined) };
    const out: FromWorker[] = [];
    const h = new Handler(storage, (m) => out.push(m));
    await h.handle({ t: "load", legacy: null, now: NOW });
    out.length = 0;
    return { h, out, get: () => stored as SaveV4 };
  }
  const spec = { template: "barn", side: 1 as const, i: 3, site: NO_SITE };

  it("places, persists and rejects", async () => {
    const s = town([], { roads: road([[0, 0], [160, 0]]), gm: 0 });
    const e = Number(Object.keys(s.roads.edges)[0]);
    const { h, out, get } = await boot(s);
    await h.handle({ t: "cmd", id: 1, cmd: { type: "placeBuilding", edge: e, ...spec } });
    expect(out.map((m) => m.t)).toEqual(["snapshot", "cmdResult"]);
    expect(out[1]).toEqual({ t: "cmdResult", id: 1, ok: true });
    expect(Object.values(get().sim.buildings)).toHaveLength(1);
    expect(Object.values(get().sim.buildings)[0]).toMatchObject({ template: "barn", state: "planned", zone: "placed" });
    out.length = 0;
    const bad = async (cmd: unknown) => {
      await h.handle({ t: "cmd", id: 2, cmd: cmd as never });
      return out.splice(0);
    };
    expect(await bad({ type: "placeBuilding", edge: e, ...spec })).toEqual([{ t: "cmdResult", id: 2, ok: false, reason: "Место занято зданием" }]);
    expect((await bad({ type: "placeBuilding", edge: e, ...spec, template: "izba" }))[0]).toMatchObject({ ok: false });
    expect((await bad({ type: "placeBuilding", edge: e, ...spec, template: "nope" }))[0]).toMatchObject({ ok: false });
    expect((await bad({ type: "placeBuilding", edge: e, ...spec, i: 1.5 }))[0]).toMatchObject({ ok: false });
    expect((await bad({ type: "placeBuilding", edge: e, ...spec, side: 0 }))[0]).toMatchObject({ ok: false });
    expect((await bad({ type: "placeBuilding", edge: e, ...spec, i: 5, site: { forest: 2, water: 0, rock: 0 } }))[0]).toMatchObject({ ok: false });
    expect((await bad({ type: "placeBuilding", edge: e, ...spec, i: 5, site: null }))[0]).toMatchObject({ ok: false });
    expect(Object.values(get().sim.buildings)).toHaveLength(1);
  });
  it("demolish removes any building; workers lose the job and households their house", async () => {
    let s = town([bld(1, "woodcutter", 50), bld(2, "izba", 90)], { roads: road([[0, 0], [160, 0]]), gm: 0 });
    s = { ...s, zones: { ...s.zones, cells: paintCells(s.zones.cells, s.zones.cells.map((c) => c.key), "res") } };
    s = folk(s, [{ home: 2, adults: 1, job: 1 }]);
    const { h, out, get } = await boot(s);
    expect(Object.values(get().sim.residents)[0].job).toBe(1);
    await h.handle({ t: "cmd", id: 1, cmd: { type: "demolish", id: 1 } });
    expect(out[1]).toEqual({ t: "cmdResult", id: 1, ok: true });
    expect(Object.keys(get().sim.buildings)).toEqual(["2"]);
    expect(Object.values(get().sim.residents)[0].job).toBeNull();
    await h.handle({ t: "cmd", id: 2, cmd: { type: "demolish", id: 2 } });
    expect(Object.keys(get().sim.buildings)).toEqual([]);
    expect(Object.values(get().sim.households)[0].home).toBeNull();
    out.length = 0;
    await h.handle({ t: "cmd", id: 3, cmd: { type: "demolish", id: 2 } });
    expect(out).toEqual([{ t: "cmdResult", id: 3, ok: false, reason: "Здание уже снесено" }]);
  });
  it("snapshots carry the aggregates and the inspector the production", async () => {
    const s = folk(town([bld(1, "gumno", 200), bld(2, "sawpit", 400)], { fields: [FIELD10()], gm: SPRING_NOON }), [{ home: null, adults: 2, job: 2 }]);
    const { h, out } = await boot(s);
    h.tick(NOW + 10_000);
    const snap = out.find((m) => m.t === "snapshot") as Extract<FromWorker, { t: "snapshot" }>;
    expect(snap.sim.stock.food).toBeGreaterThan(0);
    expect(snap.sim.economy).toMatchObject({ foodCap: FOOD_CAMP_CAP, fields: { count: 1, ha: 10, assignedHa: 10, window: "sowing" } });
    expect(snap.sim).not.toHaveProperty("prod");
    await h.handle({ t: "query", id: 5, q: { type: "building", id: 1 } });
    const q = out.find((m) => m.t === "queryResult") as Extract<FromWorker, { t: "queryResult" }>;
    expect(q.data).toMatchObject({ kind: "workplace", capacity: 4, production: { good: "food", fields: { count: 1, ha: 10 } } });
    await h.handle({ t: "query", id: 6, q: { type: "building", id: 2 } });
    const q2 = out.filter((m) => m.t === "queryResult")[1] as Extract<FromWorker, { t: "queryResult" }>;
    expect(q2.data).toMatchObject({ kind: "workplace", capacity: 2, production: { good: "planks", missing: "брёвна" } });
  });
});

describe("save", () => {
  const city: City = { name: "Череповец", lat: 59.12, lng: 37.9, foundedAt: NOW - 1000 };
  const wrap = (sim: object) => ({ version: 4, city, sim: { realTime: NOW, gameMinutes: 50, ...sim } });
  const full = () => {
    const s = folk(town([bld(1, "barn", 50)], { gm: 50 }), [{ home: null, adults: 2, mood: 73 }]);
    return { ...s, realTime: NOW };
  };

  it("round-trips stock, mood, progress and placed buildings", () => {
    const s = { ...full(), stock: { food: 5, logs: 6, planks: 7, stone: 8, wares: 9 } };
    s.buildings[1].site = { forest: 0.3, water: 0.2, rock: 0.1 };
    s.prod = { ...s.prod, fields: { 1: { year: 1, sowH: 3, harvH: 0, reaped: 0 } }, today: { 1: 2 }, yesterday: { 1: 3 } };
    const parsed = parseSave(JSON.parse(JSON.stringify({ version: 4, city, sim: s })), NOW)!;
    expect(parsed.sim.stock).toEqual(s.stock);
    expect(parsed.sim.prod).toEqual(s.prod);
    expect(parsed.sim.households[1].mood).toBe(73);
    expect(parsed.sim.buildings[1]).toEqual(s.buildings[1]);
  });
  it("round-trips the families on their way and the hand-made hours; older saves have none", () => {
    const s = full();
    s.buildings[1] = { ...s.buildings[1], template: "izba", zone: "res", state: "active", hand: 42 };
    const sim = { ...s, incoming: [{ house: 1, arrive: 400 }], attract: 0.7 };
    const parsed = parseSave(JSON.parse(JSON.stringify({ version: 4, city, sim })), NOW)!;
    expect(parsed.sim.incoming).toEqual([{ house: 1, arrive: 400 }]);
    expect(parsed.sim.attract).toBeCloseTo(0.7);
    expect(parsed.sim.buildings[1].hand).toBe(42);
    const old = JSON.parse(JSON.stringify({ version: 4, city, sim }));
    delete old.sim.incoming;
    delete old.sim.attract;
    expect(parseSave(old, NOW)!.sim).toMatchObject({ incoming: [], attract: 0 });
    // broken entries and entries for houses that are not finished are dropped
    const bad = JSON.parse(JSON.stringify({ version: 4, city, sim: { ...sim, incoming: [{ house: 1, arrive: 400 }, { house: 9, arrive: 1 }, { house: 1, arrive: "x" }, null, { house: 1, arrive: 5 }] } }));
    expect(parseSave(bad, NOW)!.sim.incoming).toEqual([{ house: 1, arrive: 400 }]);
  });
  it("round-trips an orchard's ripening and its year", () => {
    const s = full();
    s.buildings[1] = { ...s.buildings[1], template: "orchard", zone: "placed", ripe: 1234 };
    const sim = { ...s, prod: { ...s.prod, orchard: { year: 2, frost: 4, stress: 1.5, days: 8, hot: 2 } } };
    const p = parseSave(JSON.parse(JSON.stringify({ version: 4, city, sim })), NOW)!;
    expect(p.sim.buildings[1].ripe).toBe(1234);
    expect(p.sim.prod.orchard).toEqual({ year: 2, frost: 4, stress: 1.5, days: 8, hot: 2 });
    const old = JSON.parse(JSON.stringify({ version: 4, city, sim }));
    delete old.sim.prod.orchard;
    delete old.sim.buildings[1].ripe;
    const q = parseSave(old, NOW)!.sim;
    expect(q.prod.orchard).toEqual({ year: 1, frost: 0, stress: 0, days: 0, hot: 0 });
    expect(q.buildings[1].ripe).toBeUndefined();
  });
  it("older saves get the founding stock, mood 60, empty progress and paid buildings", () => {
    const s = full();
    const old = JSON.parse(JSON.stringify(s));
    delete old.stock;
    delete old.prod;
    for (const h of Object.values<Record<string, unknown>>(old.households)) delete h.mood;
    for (const b of Object.values<Record<string, unknown>>(old.buildings)) delete b.paid;
    old.buildings[1].state = "planned";
    old.buildings[1].done = 0;
    const p = parseSave({ version: 4, city, sim: old }, NOW)!;
    expect(p.sim.stock).toEqual(FOUNDING_STOCK);
    expect(p.sim.prod).toEqual({ fields: {}, flags: { year: 1, sowing: false, harvest: false, done: false, closed: false, hungry: false, rot: 0 }, today: {}, yesterday: {}, orchard: { year: 1, frost: 0, stress: 0, days: 0, hot: 0 } });
    expect(p.sim.households[1].mood).toBe(60);
    expect(p.sim.buildings[1].paid).toBe(false); // still planned
    old.buildings[1].state = "building";
    old.buildings[1].done = 5;
    expect(parseSave({ version: 4, city, sim: old }, NOW)!.sim.buildings[1].paid).toBe(true);
  });
  it("broken stock, progress and mood fall back without losing the town", () => {
    const s = JSON.parse(JSON.stringify(full()));
    s.stock = { food: -1, logs: 0, planks: 0, stone: 0, wares: 0 };
    s.prod = { fields: { 1: { year: 1, sowH: "x" } }, flags: 5, today: { a: 1, 2: -4 }, yesterday: null };
    s.households[1].mood = "high";
    const p = parseSave({ version: 4, city, sim: s }, NOW)!;
    expect(p.sim.stock.food).toBe(3000);
    expect(p.sim.prod.fields).toEqual({});
    expect(p.sim.prod.today).toEqual({});
    expect(p.sim.households[1].mood).toBe(60);
    expect(Object.keys(p.sim.residents)).toHaveLength(2);
    expect(Object.keys(p.sim.buildings)).toEqual(["1"]);
  });
  it("an invalid placed building resets the buildings only", () => {
    const s = JSON.parse(JSON.stringify(full()));
    s.buildings[1].site = { forest: 3, water: 0, rock: 0 };
    const p = parseSave({ version: 4, city, sim: s }, NOW)!;
    expect(p.sim.buildings).toEqual({});
    expect(Object.keys(p.sim.residents)).toHaveLength(2);
    expect(parseSave(wrap({}), NOW)!.sim.stock.food).toBe(3000);
    const bad = JSON.parse(JSON.stringify(full()));
    bad.buildings[1].zone = "res"; // barn is a placed template
    expect(parseSave({ version: 4, city, sim: bad }, NOW)!.sim.buildings).toEqual({});
  });
});

describe("determinism with production", () => {
  it("one call equals many calls", () => {
    let s = folk(
      town([bld(1, "gumno", 200), bld(2, "woodcutter", 300, "active", { forest: 0.5, water: 0, rock: 0 }), bld(3, "sawpit", 400), bld(4, "pottery", 500), bld(5, "izba", 600, "planned")], {
        fields: [FIELD10()],
        gm: at(6, 0),
      }),
      [{ home: null, adults: 4, job: 1 }, { home: null, adults: 2, job: 2 }, { home: null, adults: 2, job: 3 }, { home: null, adults: 2, job: 4 }, { home: null, adults: 3, kids: 2 }],
    );
    s = { ...s, realTime: NOW, stock: { ...s.stock, logs: 20 } };
    let t = NOW;
    let m = s;
    let seed = 11;
    const end = NOW + 6 * 1440 * 1000; // 6 game days
    while (t < end) {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      t += (seed % 9000) + 1;
      m = advanceTo(m, t);
    }
    const once = advanceTo(s, t);
    expect(m).toEqual(once);
    expect(calendar(once.gameMinutes).dayOfYear).toBeGreaterThanOrEqual(11);
    expect(once.stock.wares).toBeGreaterThan(20);
    expect(Object.keys(once.prod.fields).length).toBe(1);
  });
});
