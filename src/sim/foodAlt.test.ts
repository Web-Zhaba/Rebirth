import { describe, expect, it } from "vitest";
import { BARN_CAP, BUILDINGS, CELLAR_CAP, foodCapacity, FOOD_CAMP_CAP } from "./buildings";
import { artel, foodOutlook } from "./people";
import { bears, FOOD_RATE, idleWorkplaces, ORCHARD_YEARS } from "./fields";
import { emptyGrowth } from "./growth";
import { brushwood, dailyEconomy, economyStats, produceStep, productionInfo } from "./production";
import { workLength } from "./levers";
import { emptyRoads } from "./roads";
import { DAYS_PER_SEASON, YEAR_DAYS, YEAR_MIN } from "./time";
import type { Building, Field, Household, Resident, SimState } from "./types";
import { CALM, emptyWeather, type Weather, type WeatherState } from "./weather";
import { EFFECTS, emptyOrchard, orchardDay, orchardQuality, spoilage, workFactor } from "./weatherEffects";
import { emptyZones } from "./zones";

const SITE = { lat: 50, lng: 30, elev: 200, seed: 1, phase: 0 };
const at = (day: number, hour = 0, year = 1) => ((year - 1) * YEAR_DAYS + day - 1) * 1440 + hour * 60 - 360;
const day = (min: number, max = min, rain = 0) => ({ min, max, rain });
const wx = (o: Omit<Partial<WeatherState>, "now"> & { now?: Partial<Weather> } = {}): WeatherState => ({ ...emptyWeather(), site: SITE, ...o, now: { ...CALM, ...o.now } });

const SPRING = at(4, 12);
const SUMMER = at(12, 12);
const AUTUMN = at(20, 12);
const WINTER = at(28, 12);

let uid = 0;
const bld = (id: number, template: string, x: number, state: Building["state"] = "active"): Building => {
  const t = BUILDINGS[template];
  return {
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
};
const base = (gm: number, weather: WeatherState, bs: Building[], fields: Field[] = []): SimState => {
  const buildings: Record<number, Building> = {};
  for (const b of bs) buildings[b.id] = b;
  return { realTime: 0, gameMinutes: gm, roads: emptyRoads(), zones: { ...emptyZones(), fields }, ...emptyGrowth(7, gm), stock: { food: 1750, logs: 0, planks: 0, stone: 0, wares: 20 }, buildings, weather };
};
function folk(s: SimState, n: number, job: number | null, perHome = n): SimState {
  const residents: Record<number, Resident> = {};
  const households: Record<number, Household> = {};
  for (let i = 0; i < n; i++) {
    const hid = Math.floor(i / perHome) + 1;
    const id = ++uid;
    residents[id] = { id, first: "Иван", last: "Тестов", sex: "m", born: s.gameMinutes - 30 * YEAR_MIN, household: hid, spouse: null, job, commute: job === null ? null : 5, idleDays: 0, literate: false, school: 0 };
    (households[hid] ??= { id: hid, last: "Тестов", home: null, members: [], arrived: 0, founder: false, mood: 60 }).members.push(id);
  }
  return { ...s, residents, households, events: [] };
}
const staffed = (template: string, gm: number, w: WeatherState = emptyWeather(), n = BUILDINGS[template].jobs) => folk(base(gm, w, [bld(1, template, 100)]), n, 1);
const food = (s: SimState, hours = 1) => produceStep(s, hours).stock.food - 1750;

describe("templates", () => {
  it("the new producers are food workplaces, the cellar a services building without jobs", () => {
    for (const id of ["forager", "orchard", "apiary"]) expect(BUILDINGS[id]).toMatchObject({ zone: "placed", group: "food" });
    expect(BUILDINGS.forager.jobs).toBe(3);
    expect(BUILDINGS.orchard.jobs).toBe(2);
    expect(BUILDINGS.apiary.jobs).toBe(1);
    expect(BUILDINGS.cellar).toMatchObject({ jobs: 0, group: "services" });
  });
  it("a staffed producer feeds a few adults a year, none replaces fields", () => {
    const adultYear = 0.7 * YEAR_DAYS;
    const yearly = (t: string) => {
      const r = FOOD_RATE[t];
      return r.season.reduce((m, f) => m + f, 0) * DAYS_PER_SEASON * r.kgHour * BUILDINGS[t].jobs * workLength();
    };
    expect(yearly("forager") / adultYear).toBeGreaterThan(3);
    expect(yearly("forager") / adultYear).toBeLessThan(5.5);
    expect(yearly("orchard") / adultYear).toBeGreaterThan(5);
    expect(yearly("orchard") / adultYear).toBeLessThan(8);
    expect(yearly("apiary") / adultYear).toBeGreaterThan(1);
    expect(yearly("apiary") / adultYear).toBeLessThan(3);
  });
});

describe("forager", () => {
  it("seasons: 0.3 spring, 1 summer, 1.4 autumn, nothing in winter", () => {
    const rate = FOOD_RATE.forager.kgHour;
    expect(food(staffed("forager", SPRING))).toBeCloseTo(3 * rate * 0.3);
    expect(food(staffed("forager", SUMMER))).toBeCloseTo(3 * rate);
    expect(food(staffed("forager", AUTUMN))).toBeCloseTo(3 * rate * 1.4);
    expect(food(staffed("forager", WINTER))).toBeCloseTo(0);
  });
  it("rain halves it, a storm cuts it to 0.3, snow cover stops it", () => {
    expect(workFactor("forager", wx({ now: { precip: 0.5, temp: 12 } }))).toBeCloseTo(0.5);
    expect(workFactor("forager", wx({ now: { wind: 16 } }))).toBeCloseTo(0.3);
    expect(workFactor("forager", wx({ snowpack: 0.06 }))).toBe(0);
    expect(workFactor("forager", wx({ snowpack: 0.04 }))).toBe(1);
    const calm = food(staffed("forager", SUMMER));
    expect(food(staffed("forager", SUMMER, wx({ now: { precip: 0.5, temp: 12 } }))) / calm).toBeCloseTo(0.5);
  });
});

describe("apiary", () => {
  it("seasons 0.3 / 1 / 0.7 / 0", () => {
    const rate = FOOD_RATE.apiary.kgHour;
    expect(food(staffed("apiary", SPRING))).toBeCloseTo(rate * 0.3);
    expect(food(staffed("apiary", SUMMER))).toBeCloseTo(rate);
    expect(food(staffed("apiary", AUTUMN))).toBeCloseTo(rate * 0.7);
    expect(food(staffed("apiary", WINTER))).toBeCloseTo(0);
  });
  it("flies only on warm, dry, calm days", () => {
    const warm: Partial<Weather> = { temp: 18, wind: 3 };
    expect(workFactor("apiary", wx({ now: warm }))).toBe(1);
    expect(workFactor("apiary", wx({ now: { ...warm, temp: 9 } }))).toBe(0);
    expect(workFactor("apiary", wx({ now: { ...warm, precip: 0.5 } }))).toBe(0);
    expect(workFactor("apiary", wx({ now: { ...warm, wind: 16 } }))).toBe(0);
    expect(workFactor("apiary", wx({ now: { ...warm, wind: 9 } }))).toBe(0);
    expect(food(staffed("apiary", SUMMER, wx({ now: { temp: 6 } })))).toBe(0);
  });
});

describe("orchard", () => {
  const orchardTown = (gm: number, o: Partial<Building> = {}, w: WeatherState = emptyWeather()) => {
    const s = staffed("orchard", gm, w);
    return { ...s, buildings: { 1: { ...s.buildings[1], ...o } } };
  };
  it("the daily step stamps the year of growth once the building stands", () => {
    const s = orchardTown(at(1, 0));
    const d = dailyEconomy(s);
    expect(d.buildings[1].ripe).toBe(at(1, 0) + ORCHARD_YEARS * YEAR_MIN);
    expect(dailyEconomy({ ...d, gameMinutes: at(2, 0) }).buildings[1].ripe).toBe(d.buildings[1].ripe); // not restamped
    const planned = { ...s, buildings: { 1: bld(1, "orchard", 100, "building") } };
    expect(dailyEconomy(planned).buildings[1].ripe).toBeUndefined();
    expect(bears({ ripe: undefined }, 1e9)).toBe(false);
  });
  it("gives nothing before it bears, then only in autumn", () => {
    const young = orchardTown(AUTUMN, { ripe: AUTUMN + 10 });
    expect(food(young)).toBe(0);
    expect(food(orchardTown(AUTUMN, { ripe: AUTUMN - 1 }))).toBeCloseTo(2 * FOOD_RATE.orchard.kgHour);
    for (const gm of [SPRING, SUMMER, WINTER]) expect(food(orchardTown(gm, { ripe: 0 }))).toBe(0);
    expect(productionInfo(young, young.buildings[1])!.orchard).toMatchObject({ ripeDays: 1, quality: 1 });
  });
  it("its workers join the artel while there is nothing to pick", () => {
    expect(idleWorkplaces(orchardTown(SUMMER, { ripe: 0 })).has(1)).toBe(true);
    expect(idleWorkplaces(orchardTown(AUTUMN, { ripe: 0 })).has(1)).toBe(false);
    expect(idleWorkplaces(orchardTown(AUTUMN, { ripe: AUTUMN + 5 })).has(1)).toBe(true);
  });
  it("frost nights at the blossom cut the year by 40-80 %", () => {
    expect(orchardQuality(emptyOrchard())).toBe(1);
    let o = emptyOrchard();
    for (let i = 0; i < 2; i++) o = orchardDay(o, wx({ yesterday: day(-3, 4) }), 1, 0);
    expect(orchardQuality(o)).toBe(1); // two nights are not enough
    o = orchardDay(o, wx({ yesterday: day(-3, 4) }), 1, 0);
    expect(orchardQuality(o)).toBeCloseTo(0.6);
    for (let i = 0; i < 9; i++) o = orchardDay(o, wx({ yesterday: day(-3, 4) }), 1, 0);
    expect(orchardQuality(o)).toBeCloseTo(0.2); // at most 80 %
    expect(orchardDay(emptyOrchard(), wx({ yesterday: day(2, 9) }), 1, 0).frost).toBe(0); // a mild night is not counted
    expect(orchardDay(emptyOrchard(), wx({ yesterday: day(-3, 4) }), 1, 2).frost).toBe(0); // only the spring counts
    expect(orchardDay(emptyOrchard(), emptyWeather(), 1, 0)).toEqual(emptyOrchard()); // calm: nothing
    expect(orchardDay(o, wx({ yesterday: day(-3, 4) }), 2, 0).frost).toBe(1); // a new year starts over
  });
  it("drought and heat in summer lower it", () => {
    let dry = emptyOrchard();
    for (let i = 0; i < 8; i++) dry = orchardDay(dry, wx({ soil: 0.05, yesterday: day(15, 30) }), 1, 1);
    expect(orchardQuality(dry)).toBeLessThan(0.65);
    expect(orchardQuality(dry)).toBeGreaterThan(0.5);
    let wet = emptyOrchard();
    for (let i = 0; i < 8; i++) wet = orchardDay(wet, wx({ soil: 0.6, yesterday: day(15, 25) }), 1, 1);
    expect(orchardQuality(wet)).toBe(1);
    let hot = emptyOrchard();
    for (let i = 0; i < 8; i++) hot = orchardDay(hot, wx({ soil: 0.6, yesterday: day(20, 36) }), 1, 1);
    expect(orchardQuality(hot)).toBeCloseTo(0.7);
  });
  it("the daily step counts the day that ended, and the harvest follows the quality", () => {
    // 00:00 of day 9 (first of summer): the day that ended was spring
    const s = orchardTown(at(9, 0), { ripe: 0 }, wx({ yesterday: day(-3, 4) }));
    expect(dailyEconomy(s).prod.orchard.frost).toBe(1);
    const a = orchardTown(AUTUMN, { ripe: 0 });
    const sad = { ...a, prod: { ...a.prod, orchard: { year: 1, frost: 3, stress: 0, days: 0, hot: 0 } } };
    expect(food(sad)).toBeCloseTo(2 * FOOD_RATE.orchard.kgHour * 0.6);
  });
  it("the food outlook counts a bearing orchard only", () => {
    // 2 gardeners and 6 mouths at a building site (no foraging), little in the stock: the orchard's year is the difference
    const outlook = (ripe: number) => {
      const o = orchardTown(SUMMER, { ripe });
      const s = { ...o, buildings: { ...o.buildings, 9: bld(9, "izba", 50, "planned") } };
      const crowd = folk({ ...s, gameMinutes: SUMMER }, 6, null);
      const residents = { ...s.residents, ...crowd.residents };
      return foodOutlook({ ...s, residents, households: { ...s.households, ...crowd.households }, stock: { ...s.stock, food: 100 } });
    };
    expect(outlook(0)).toBeGreaterThan(outlook(SUMMER + 100));
  });
});

describe("cellar", () => {
  it("adds 10 t of room and makes nothing", () => {
    const s = base(SUMMER, emptyWeather(), [bld(1, "cellar", 100)]);
    expect(foodCapacity(s.buildings)).toBe(FOOD_CAMP_CAP + CELLAR_CAP);
    expect(foodCapacity(base(SUMMER, emptyWeather(), [bld(1, "cellar", 100, "building")]).buildings)).toBe(FOOD_CAMP_CAP);
    expect(productionInfo(s, s.buildings[1])).toMatchObject({ good: null, storage: CELLAR_CAP });
    expect(CELLAR_CAP).toBeLessThan(BARN_CAP);
  });
  it("spoilage: a cellar beats a barn beats the open", () => {
    const hot = wx({ yesterday: day(25), soil: 0.5 });
    const open = spoilage(hot, 0);
    const barn = spoilage(hot, 1);
    const cellar = spoilage(hot, 0, 1);
    expect(barn).toBeCloseTo(open * 0.5);
    expect(cellar).toBeLessThan(barn);
    expect(cellar).toBeCloseTo(open * (1 - EFFECTS.cellarHeat));
    expect(spoilage(wx({ yesterday: day(10, 10, 20) }), 0, 1)).toBe(0); // damp does not reach it
  });
  it("the daily step spoils less food held in a cellar", () => {
    const hot = wx({ yesterday: day(25), soil: 0.5 });
    const lost = (bs: Building[]) => {
      const s = base(at(12, 0), hot, bs);
      const d = dailyEconomy({ ...s, stock: { ...s.stock, food: 9000 } });
      return 9000 - d.stock.food;
    };
    expect(lost([bld(1, "cellar", 100)])).toBeLessThan(lost([]));
    expect(lost([bld(1, "cellar", 100)])).toBeLessThan(lost([bld(1, "barn", 100)]));
  });
});

describe("brushwood", () => {
  const COLD = day(-10, -6);
  const town = (logs: number, w: WeatherState = wx({ yesterday: COLD })) => {
    const s = folk(base(at(26, 0), w, [bld(1, "izba", 100)]), 4, null, 2);
    return { ...s, stock: { ...s.stock, logs } };
  };
  it("idle adults bring a little fuel when the logs will not last the day", () => {
    const s = town(0);
    expect(brushwood(s, 0.16)).toBeCloseTo(4 * EFFECTS.brush.m3);
    expect(economyStats(s).brushwood).toBeCloseTo(4 * EFFECTS.brush.m3);
    expect(Object.values(dailyEconomy(s).households).some((h) => h.cold)).toBe(true); // 0.12 m3 of 0.16 does not warm both households
  });
  it("not while the stock covers the day, and not on a warm day", () => {
    expect(brushwood(town(50), 0.16)).toBe(0);
    expect(economyStats(town(50)).brushwood).toBe(0);
    expect(economyStats(town(0, wx({ yesterday: day(15, 22) }))).brushwood).toBe(0);
    expect(economyStats(town(0, emptyWeather())).brushwood).toBe(0);
  });
  it("goes on while a household is cold, and only 40 % under snow", () => {
    const s = town(50);
    const cold = { ...s, households: { ...s.households, 1: { ...s.households[1], cold: true as const } } };
    expect(brushwood(cold, 0.16)).toBeCloseTo(4 * EFFECTS.brush.m3);
    const snow = town(0, wx({ yesterday: COLD, snowpack: 0.2 }));
    expect(economyStats(snow).brushwood).toBeCloseTo(4 * EFFECTS.brush.m3 * EFFECTS.brush.snow);
  });
  it("nobody gathers while the artel has a site to work on", () => {
    const s = town(0);
    const site = { ...s, buildings: { ...s.buildings, 9: bld(9, "izba", 50, "planned") } };
    expect(brushwood(site, 0.16)).toBe(0);
  });
});

describe("farmers in frozen weather", () => {
  const FIELD10: Field = { id: 1, pts: [[100, 60], [300, 60], [300, 560], [100, 560]], area: 100_000 } as Field;
  const farm = (w: WeatherState) => folk(base(at(6, 12), w, [bld(1, "gumno", 200)], [FIELD10]), 4, 1);
  it("count as idle and join the artel while the weather allows no field work", () => {
    expect(idleWorkplaces(farm(emptyWeather())).has(1)).toBe(false);
    expect(idleWorkplaces(farm(wx({ frozen: 0.9 }))).has(1)).toBe(true);
    expect(idleWorkplaces(farm(wx({ snowpack: 0.2 }))).has(1)).toBe(true);
    expect(idleWorkplaces(farm(wx({ now: { precip: 0.5, temp: 12 } }))).has(1)).toBe(false); // rain only slows them
    expect(artel(farm(wx({ frozen: 0.9 }))).hands).toBe(4);
    expect(artel(farm(emptyWeather())).hands).toBe(0);
  });
});
