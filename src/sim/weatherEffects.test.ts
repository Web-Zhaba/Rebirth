import { describe, expect, it } from "vitest";
import { step } from "./clock";
import { BUILDINGS } from "./buildings";
import { FIELD } from "./fields";
import { emptyGrowth } from "./growth";
import { dailyEconomy, economyStats, produceStep } from "./production";
import { emptyRoads } from "./roads";
import { YEAR_DAYS, YEAR_MIN } from "./time";
import type { Building, Field, Household, Resident, SimState } from "./types";
import { CALM, emptyWeather, type Weather, type WeatherState } from "./weather";
import { buildFactor, EFFECTS, fieldWork, firewoodDaily, floodRisk, foodNeedFactor, lightFrost, moodShift, mortalityFactor, spoilage, workFactor } from "./weatherEffects";
import { emptyZones } from "./zones";

const SITE = { lat: 50, lng: 30, elev: 200, seed: 1, phase: 0 };
const at = (day: number, hour = 0) => (day - 1) * 1440 + hour * 60 - 360;
const day = (min: number, max = min, rain = 0) => ({ min, max, rain });

// A state with a site and the given parts of it (nothing else is simulated by hand-built tests).
const wx = (o: Omit<Partial<WeatherState>, "now"> & { now?: Partial<Weather> } = {}): WeatherState => ({ ...emptyWeather(), site: SITE, ...o, now: { ...CALM, ...o.now } });

const TEMPLATES = Object.keys(BUILDINGS);

describe("calm state", () => {
  it("is exactly neutral", () => {
    const w = emptyWeather();
    expect(fieldWork(w)).toBe(1);
    expect(buildFactor(w)).toBe(1);
    for (const t of TEMPLATES) expect(workFactor(t, w)).toBe(1);
    expect(firewoodDaily(w)).toBe(0);
    expect(foodNeedFactor(w)).toBe(1);
    expect(spoilage(w, 0)).toBe(0);
    expect(moodShift(w)).toBe(0);
    expect(mortalityFactor(w, true)).toBe(1);
    expect(floodRisk(w)).toBe(false);
    expect(lightFrost(w)).toBe(false);
  });
  it("a mild day with a site is neutral too", () => {
    const w = wx({ now: { temp: 15 }, yesterday: day(10, 20) });
    expect(fieldWork(w)).toBe(1);
    expect(buildFactor(w)).toBe(1);
    for (const t of TEMPLATES) expect(workFactor(t, w)).toBe(1);
    expect(foodNeedFactor(w)).toBe(1);
  });
});

describe("factor tables", () => {
  it("field work", () => {
    expect(fieldWork(wx({ now: { precip: 1.5 } }))).toBeCloseTo(0.2);
    expect(fieldWork(wx({ now: { precip: 0.5 } }))).toBeCloseTo(0.6);
    expect(fieldWork(wx({ snowpack: 0.1 }))).toBe(0);
    expect(fieldWork(wx({ frozen: 0.8 }))).toBe(0);
    expect(fieldWork(wx({ now: { wind: 15 } }))).toBeCloseTo(0.7);
    expect(fieldWork(wx({ now: { temp: 35 } }))).toBeCloseTo(0.8);
    expect(fieldWork(wx({ soil: 0.98 }))).toBeCloseTo(0.5);
    expect(fieldWork(wx({ now: { precip: 1.5 }, soil: 0.98 }))).toBeCloseTo(0.1);
    expect(workFactor("gumno", wx({ now: { precip: 0.5 } }))).toBeCloseTo(0.6);
  });
  it("extraction", () => {
    const storm = wx({ now: { wind: 16 } });
    expect(workFactor("woodcutter", storm)).toBeCloseTo(0.3);
    expect(workFactor("woodcutter", wx({ snowpack: 0.5 }))).toBeCloseTo(0.8);
    expect(workFactor("woodcutter", wx({ snowpack: 0.1, frozen: 0.9 }))).toBeCloseTo(1.15);
    expect(workFactor("woodcutter", wx({ now: { temp: 2, precip: 0.5 } }))).toBeCloseTo(0.6);
    expect(workFactor("sawpit", wx({ now: { temp: -25 } }))).toBeCloseTo(0.85);
    expect(workFactor("sawpit", wx({ now: { precip: 0.5 } }))).toBeCloseTo(0.9);
    expect(workFactor("quarry", wx({ now: { precip: 1.5 } }))).toBeCloseTo(0.35);
    expect(workFactor("quarry", wx({ now: { precip: 0.5 } }))).toBeCloseTo(0.7);
    expect(workFactor("quarry", wx({ now: { temp: -20 } }))).toBeCloseTo(0.5);
    expect(workFactor("quarry", wx({ snowpack: 0.5 }))).toBeCloseTo(0.4);
    expect(workFactor("fisher", storm)).toBeCloseTo(0.2);
    expect(workFactor("fisher", wx({ ice: 0.8 }))).toBeCloseTo(0.35);
    expect(workFactor("garden", wx({ now: { temp: -3 } }))).toBe(0);
    expect(workFactor("garden", wx({ soil: 0.1 }))).toBeCloseTo(0.4);
    expect(workFactor("garden", wx({ soil: 0.99 }))).toBeCloseTo(0.7);
    expect(workFactor("hunter", storm)).toBeCloseTo(0.4);
    expect(workFactor("hunter", wx({ now: { snow: true, precip: 0.3, temp: -2 } }))).toBeCloseTo(1.3);
    expect(workFactor("dig", wx({ frozen: 0.9, now: { temp: -8 } }))).toBeCloseTo(0.3);
    expect(workFactor("dig", wx({ now: { precip: 0.5 } }))).toBeCloseTo(0.7);
    for (const t of ["pottery", "carpentry", "smithy"]) {
      expect(workFactor(t, wx({ now: { temp: -12 } }))).toBeCloseTo(0.8);
      expect(workFactor(t, wx({ now: { temp: 35 } }))).toBeCloseTo(0.85);
    }
    expect(workFactor("izba", storm)).toBe(1);
  });
  it("construction", () => {
    expect(buildFactor(wx({ now: { precip: 0.5 } }))).toBeCloseTo(0.6);
    expect(buildFactor(wx({ now: { precip: 1.5 } }))).toBeCloseTo(0.3);
    expect(buildFactor(wx({ now: { precip: 0.5, snow: true, temp: -2 } }))).toBeCloseTo(0.5);
    expect(buildFactor(wx({ now: { wind: 16 } }))).toBeCloseTo(0.3);
    expect(buildFactor(wx({ now: { temp: -20 } }))).toBeCloseTo(0.4);
    expect(buildFactor(wx({ now: { temp: 35 } }))).toBeCloseTo(0.8);
    expect(buildFactor(wx({ now: { temp: 2 }, soil: 0.9 }))).toBeCloseTo(0.7);
  });
  it("people and food", () => {
    expect(firewoodDaily(wx({ yesterday: day(10, 20) }))).toBe(0); // mean 15, above the base
    expect(firewoodDaily(wx({ yesterday: day(-8, -4) }))).toBeCloseTo((EFFECTS.firewoodYear * 18) / EFFECTS.hddRef);
    expect(foodNeedFactor(wx({ yesterday: day(0) }))).toBeCloseTo(1.1);
    expect(foodNeedFactor(wx({ yesterday: day(-40) }))).toBeCloseTo(1.3); // capped
    expect(spoilage(wx({ yesterday: day(25), soil: 0.5 }), 0)).toBeCloseTo(0.005);
    expect(spoilage(wx({ yesterday: day(25), soil: 0.5 }), 1)).toBeCloseTo(0.0025);
    expect(spoilage(wx({ yesterday: day(10, 10, 20) }), 0)).toBeCloseTo(0.001);
    expect(spoilage(wx({ yesterday: day(10, 10, 20) }), 1)).toBe(0);
    expect(moodShift(wx({ now: { wind: 16 } }))).toBe(-4);
    expect(moodShift(wx({ yesterday: day(-20, -14) }))).toBe(-4);
    expect(moodShift(wx({ yesterday: day(10, 20), now: { cloud: 0.1 } }))).toBe(2);
    expect(mortalityFactor(wx({ yesterday: day(-10) }), true)).toBeCloseTo(1.4);
    expect(mortalityFactor(wx({ yesterday: day(-40) }), true)).toBe(2);
    expect(mortalityFactor(wx({ yesterday: day(-10) }), undefined)).toBe(1);
  });
  it("events", () => {
    expect(lightFrost(wx({ yesterday: day(-1.5) }))).toBe(true);
    expect(lightFrost(wx({ yesterday: day(-5) }))).toBe(false);
    expect(floodRisk(wx({ soil: 0.95, yesterday: day(8, 12, 10), day: day(5, 9, 8) }))).toBe(true);
    expect(floodRisk(wx({ soil: 0.5, yesterday: day(8, 12, 10), day: day(5, 9, 8) }))).toBe(false);
    expect(floodRisk(wx({ soil: 0.95, snowpack: 0.2, now: { temp: 8 } }))).toBe(true);
  });
});

// ---------- through the simulation ----------

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
  return {
    realTime: 0,
    gameMinutes: gm,
    roads: emptyRoads(),
    zones: { ...emptyZones(), fields },
    ...emptyGrowth(7, gm),
    stock: { food: 1750, logs: 0, planks: 0, stone: 0, wares: 20 },
    buildings,
    weather,
  };
};

// `n` adults (age 30) in one household each of `perHome`, all with `job` (null = artel).
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

const FIELD10: Field = { id: 1, pts: [[100, 60], [300, 60], [300, 560], [100, 560]], area: 100_000 } as Field;
const farm = (gm: number, weather: WeatherState, farmers = 4) => folk(base(gm, weather, [bld(1, "gumno", 200)], [FIELD10]), farmers, 1);
const NOON_SPRING = at(6, 12);
const NOON_HARVEST = at(18, 12);

describe("construction", () => {
  const site = (w: WeatherState) => {
    const b = { ...bld(1, "izba", 100, "building"), done: 0, labor: 1000 };
    return folk(base(at(10, 12), w, [b]), 6, null);
  };
  it("rain cuts the artel's person-hours", () => {
    const calm = step(site(emptyWeather())).buildings[1].done;
    const rain = step(site(wx({ now: { precip: 0.5, temp: 12 } }))).buildings[1].done;
    expect(calm).toBeGreaterThan(0);
    expect(rain / calm).toBeCloseTo(0.6, 1);
  });
});

describe("fields", () => {
  it("a bad crop means fewer hours and fewer kg, and the harvest still ends", () => {
    const YIELD = FIELD.yieldKgHa * 10;
    const sown = (s: SimState): SimState => ({ ...s, prod: { ...s.prod, fields: { 1: { year: 1, sowH: FIELD.sowHoursHa * 10, harvH: 0, reaped: 0 } } } });
    const dry = sown(farm(NOON_HARVEST, wx({ crop: 0.5 })));
    expect(economyStats(dry).fields.expected).toBeCloseTo(YIELD * 0.5);
    const done = produceStep(dry, (FIELD.harvestHoursHa * 10 * 0.5) / 4); // 4 farmers
    expect(done.prod.fields[1].reaped).toBeCloseTo(YIELD * 0.5);
    expect(done.events.at(-1)!.text).toContain("Урожай собран");
    const full = produceStep(sown(farm(NOON_HARVEST, emptyWeather())), (FIELD.harvestHoursHa * 10 * 0.5) / 4);
    expect(full.prod.fields[1].reaped).toBeCloseTo(YIELD * 0.5); // half the hours, half the grain
    expect(full.events.some((e) => e.text.includes("Урожай собран"))).toBe(false); // calm: the full crop needs twice the hours
  });
  it("rain slows sowing; frozen ground stops it", () => {
    const sow = (w: WeatherState) => produceStep(farm(NOON_SPRING, w), 1).prod.fields[1]?.sowH ?? 0;
    const calm = sow(emptyWeather());
    expect(sow(wx({ now: { precip: 0.5 } })) / calm).toBeCloseTo(0.6);
    expect(sow(wx({ frozen: 0.9 }))).toBe(0);
    expect(produceStep(farm(NOON_SPRING, wx({ frozen: 0.9 })), 1).events).toHaveLength(0); // no «Начался сев» on a frozen field
  });
  it("a frost night takes grain once and says so", () => {
    const s = farm(at(18, 0), wx({ crop: 0.8, frost: 1, yesterday: day(-6, 4) }));
    const withSown = { ...s, prod: { ...s.prod, fields: { 1: { year: 1, sowH: FIELD.sowHoursHa * 10, harvH: 0, reaped: 0 } } } };
    const d = dailyEconomy(withSown);
    expect(d.weather.frost).toBeCloseTo(0.4); // 0.15 * (-2 + 6) = 0.6 removed
    expect(d.weather.crop).toBeCloseTo(0.32);
    expect(d.events.some((e) => e.text.startsWith("Заморозок"))).toBe(true);
    const unsown = dailyEconomy(s);
    expect(unsown.weather.frost).toBe(1); // nothing sown yet: no loss
    const mild = dailyEconomy({ ...withSown, weather: { ...withSown.weather, yesterday: day(-1, 8) } });
    expect(mild.weather.frost).toBe(1);
  });
});

describe("people", () => {
  const cold = day(-10, -6);
  const town = (logs: number) => {
    const s = base(at(26, 0), wx({ yesterday: cold }), [bld(1, "izba", 100)]);
    return { ...folk(s, 4, null, 2), stock: { ...s.stock, logs } };
  };
  it("firewood is burnt per household; without it people are cold, glum and shorter-lived", () => {
    const per = firewoodDaily(wx({ yesterday: cold }));
    const withSite = (s: SimState): SimState => ({ ...s, buildings: { ...s.buildings, 9: bld(9, "izba", 50, "planned") } }); // a site keeps the idle adults at work (no brushwood)
    const warm = dailyEconomy(withSite(town(10)));
    expect(warm.stock.logs).toBeCloseTo(10 - 2 * per);
    expect(Object.values(warm.households).some((h) => h.cold)).toBe(false);
    const bare = dailyEconomy(withSite(town(0)));
    expect(Object.values(bare.households).every((h) => h.cold)).toBe(true);
    expect(bare.events.map((e) => e.text)).toContain("Дров нет, люди мёрзнут");
    expect(bare.households[1].mood).toBeLessThan(warm.households[1].mood - 2);
    expect(economyStats(bare).unheated).toEqual({ households: 2, people: 4 });
    expect(economyStats(bare).firewood).toBeCloseTo(2 * per);
    // the line comes once per spell
    expect(dailyEconomy(bare).events.filter((e) => e.text === "Дров нет, люди мёрзнут")).toHaveLength(1);
    // one household is served, the second is not
    const part = dailyEconomy(withSite(town(per * 1.5)));
    expect(part.households[1].cold).toBeUndefined();
    expect(part.households[2].cold).toBe(true);
  });
  it("the cold raises the food need", () => {
    const calm = economyStats({ ...town(0), weather: emptyWeather() }).foodPerDay;
    const cool = economyStats({ ...town(0), weather: wx({ yesterday: day(0) }) }).foodPerDay;
    expect(cool / calm).toBeCloseTo(1.1);
  });
  it("food spoils in the heat and is reported", () => {
    const s = { ...town(0), gameMinutes: at(12, 0), weather: wx({ yesterday: day(25), soil: 0.5 }) };
    const d = dailyEconomy({ ...s, stock: { ...s.stock, food: 10_000 }, buildings: {}, prod: { ...s.prod, flags: { ...s.prod.flags, rot: 0 } } });
    const need = economyStats(s).foodPerDay;
    // 0.5 % of the stock rots (all of it outside barns), the town eats `need`
    expect(10_000 - need - d.stock.food).toBeGreaterThan(40);
    expect(d.events.some((e) => e.text.startsWith("Пропало"))).toBe(true);
    const barn = dailyEconomy({ ...s, stock: { ...s.stock, food: 10_000 }, buildings: { 5: bld(5, "barn", 400) } });
    expect(barn.stock.food).toBeGreaterThan(d.stock.food);
  });
});

describe("year constants", () => {
  it("a game year burns about firewoodYear x YEAR_SCALE per household in a temperate climate", () => {
    // sanity of the HDD scaling: ~219 degree-days in a game year (2500 real ones x YEAR_SCALE) at 10 m3 / 2500 per degree-day
    expect((EFFECTS.firewoodYear * 2500 * (YEAR_DAYS / 360)) / EFFECTS.hddRef).toBeCloseTo(EFFECTS.firewoodYear * (YEAR_DAYS / 360));
  });
});
