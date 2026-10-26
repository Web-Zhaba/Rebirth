import { allUnlocked } from "./goals";
import { describe, expect, it } from "vitest";
import { advanceTo } from "./clock";
import { BUILDINGS, houseCapacity, UPGRADE } from "./buildings";
import { computeCoverage, computeLandValue, dailyServices, refreshServices, reachSegments, serviceStats, upgradeBlockers, upgradeShortfall } from "./coverage";
import { advanceBuildings, canPlace, emptyGrowth, placeBuilding } from "./growth";
import { toSnapshot } from "./handler";
import { builderCount, constructionWork, countResidents, dailyStep, foodOutlook, FORAGE, forageKg, idleResidents, peopleStats, productionScale, queryBuilding } from "./people";
import { dailyEconomy, economyStats, HAND_HOURS, payMaterials, produceStep } from "./production";
import { addRoad, emptyRoads } from "./roads";
import { parseSave } from "./save";
import { FIELD } from "./fields";
import { covers, learnPerDay, SERVICE, SERVICES, serviceMood, servicesIn } from "./services";
import { SCHOOL_SEATS } from "./school";
import { YEAR_DAYS, YEAR_MIN } from "./time";
import type { Building, Household, Resident, RoadGraph, SimState } from "./types";
import { emptyZones, qkey, regenerateCells } from "./zones";

const NOW = 1_800_000_000_000;
const at = (day: number, hour = 0, year = 1) => ((year - 1) * YEAR_DAYS + day - 1) * 1440 + hour * 60 - 360;
const NOON = at(12, 12);

const road = (pts: [number, number][], labor: number[]): RoadGraph => {
  const r = addRoad(emptyRoads(), pts, "dirt", 1, labor);
  if (!r.ok) throw new Error(r.reason);
  return r.graph;
};
// A straight road along x with a node every 100 m; `unbuiltFrom` m onwards is not built yet.
const roadAlong = (len = 2000, unbuiltFrom = Infinity): RoadGraph => {
  const pts = Array.from({ length: Math.floor(len / 100) + 1 }, (_, i): [number, number] => [i * 100, 0]);
  return road(pts, pts.slice(1).map((_, i) => (i * 100 >= unbuiltFrom ? 50 : 0)));
};

// A building whose door is at (x, 3), beside the road.
function bld(id: number, template: string, x: number, state: Building["state"] = "active"): Building {
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
}

function town(bs: Building[], roads: RoadGraph = roadAlong(), gm = NOON): SimState {
  const buildings: Record<number, Building> = {};
  for (const b of bs) buildings[b.id] = b;
  return { realTime: NOW, gameMinutes: gm, roads, zones: emptyZones(), ...emptyGrowth(7, gm), goals: allUnlocked(), stock: { food: 1750, logs: 0, planks: 0, stone: 0, wares: 20 }, buildings, nextBuildingId: bs.length + 1 };
}

interface HSpec {
  home: number | null;
  adults?: number;
  kids?: number;
  kidAge?: number;
  job?: number; // workplace of the first adult
  literate?: boolean; // the first adult
  mood?: number;
  school?: number; // days attended by every child
}

// Replaces the founders with exactly these households (adults 30, children 5 unless kidAge).
function folk(s: SimState, specs: HSpec[]): SimState {
  const residents: Record<number, Resident> = {};
  const households: Record<number, Household> = {};
  let pid = 1;
  specs.forEach((sp, i) => {
    const hid = i + 1;
    const members: number[] = [];
    const add = (age: number, job: number | null, literate: boolean, school: number) => {
      const id = pid++;
      residents[id] = { id, first: "Иван", last: "Тестов", sex: "m", born: s.gameMinutes - age * YEAR_MIN, household: hid, spouse: null, job, commute: job === null ? null : 5, idleDays: 0, literate, school: literate ? 100 : school };
      members.push(id);
    };
    for (let k = 0; k < (sp.adults ?? 1); k++) add(30, k === 0 ? (sp.job ?? null) : null, k === 0 && !!sp.literate, 0);
    for (let k = 0; k < (sp.kids ?? 0); k++) add(sp.kidAge ?? 5, null, false, sp.school ?? 0);
    households[hid] = { id: hid, last: "Тестов", home: sp.home, members, arrived: 0, founder: false, mood: sp.mood ?? 60 };
  });
  return { ...s, residents, households, nextPersonId: pid, nextHouseholdId: specs.length + 1, events: [] };
}

const withCoverage = (s: SimState): SimState => refreshServices(s);
// An unfinished house far away: construction work exists, so jobless adults are builders, not idle.
const busy = (s: SimState): SimState => ({ ...s, buildings: { ...s.buildings, 900: bld(900, "izba", 1900, "planned") } });

describe("placing services", () => {
  const zoned = (): SimState => {
    const roads = roadAlong(600);
    const terrain: Record<string, { land: "meadow"; slope: number }> = {};
    for (const c of regenerateCells(roads, [], [], {})) terrain[qkey(c.cx, c.cy)] = { land: "meadow", slope: 0 };
    const cells = regenerateCells(roads, [], [], terrain);
    return { ...town([], roads), zones: { cells, fields: [], terrain, rev: 1 } };
  };
  const site = { forest: 0, water: 0, rock: 0 };
  it("every service stands on a lot beside a built road, like the S5 buildings", () => {
    const s = zoned();
    const edge = Object.values(s.roads.edges)[0].id;
    for (const id of ["well", "market", "chapel", "school", "healer"]) {
      const t = BUILDINGS[id];
      expect(t.zone).toBe("placed");
      const c = s.zones.cells.find((k) => k.edge === edge && k.side === 1 && k.depth === 0 && k.i === 0)!;
      const check = canPlace(s, t, edge, c.side, c.i, site);
      expect(check.ok, `${id}: ${check.ok ? "" : check.reason}`).toBe(true);
      const placed = placeBuilding(s, t, edge, c.side, c.i, site);
      const b = placed.buildings[placed.nextBuildingId - 1];
      expect(b).toMatchObject({ template: id, state: "planned", level: 1, streak: 0, paid: false });
      expect(b.upgrade).toBeUndefined();
    }
  });
  it("footprints fit their lots and the table matches the design", () => {
    const want: Record<string, [number, number, number, number]> = { well: [1, 1, 0, 150], market: [2, 2, 4, 800], chapel: [1, 2, 1, 1000], school: [1, 2, 2, 800], healer: [1, 1, 1, 1000] };
    for (const [id, [w, d, jobs, range]] of Object.entries(want)) {
      expect(SERVICES[id as keyof typeof SERVICES].reach).toBe(range);
      const t = BUILDINGS[id];
      expect([t.w, t.d, t.jobs]).toEqual([w, d, jobs]);
      expect(t.deep).toBeLessThanOrEqual(8 * t.d - 2); // 2 m set back from the lot front
      expect(t.along).toBeLessThanOrEqual(8 * t.w);
    }
  });
});

describe("coverage by network distance", () => {
  // well at x = 0: reach 150 m along the road, door offsets (3 m each) included
  it("counts houses within reach along built roads, offsets included", () => {
    const s = town([bld(1, "well", 0), bld(2, "izba", 100), bld(3, "izba", 140), bld(4, "izba", 160), bld(5, "izba", 400)]);
    const c = computeCoverage(s);
    expect(covers(c[2], "well")).toBe(true); // 3 + 100 + 3
    expect(covers(c[3], "well")).toBe(true); // 3 + 100 + 40.1
    expect(covers(c[4], "well")).toBe(false); // nearest node is 200 m away
    expect(covers(c[5], "well")).toBe(false);
    expect(servicesIn(c[2])).toEqual(["well"]);
  });
  it("is cut by reach", () => {
    const s = folk(town([bld(1, "chapel", 0), bld(2, "izba", 900), bld(3, "izba", 1100)]), [{ home: null, job: 1 }]);
    const c = computeCoverage(s);
    expect(covers(c[2], "chapel")).toBe(true);
    expect(covers(c[3], "chapel")).toBe(false); // 1006 m > 1000 m
  });
  it("is blocked by a road that is not built", () => {
    // built 0-100, NOT built 100-200, built 200-500: the chapel reaches 1000 m, but not across the gap
    const pts: [number, number][] = [[0, 0], [100, 0], [200, 0], [300, 0], [400, 0], [500, 0]];
    const gap = road(pts, [0, 50, 0, 0, 0]);
    const s = folk(town([bld(1, "chapel", 0), bld(2, "izba", 80), bld(3, "izba", 300)], gap), [{ home: null, job: 1 }]);
    const c = computeCoverage(s);
    expect(covers(c[2], "chapel")).toBe(true);
    expect(covers(c[3], "chapel")).toBe(false);
    // once the gap is built the house is covered
    const whole = computeCoverage({ ...s, roads: road(pts, [0, 0, 0, 0, 0]) });
    expect(covers(whole[3], "chapel")).toBe(true);
    // no built road at all: nothing is covered
    expect(computeCoverage(town([bld(1, "well", 0), bld(2, "izba", 50)], roadAlong(2000, 0)))).toEqual({});
  });
  it("does not count a service that is unfinished or unstaffed", () => {
    const houses = [bld(2, "izba", 100)];
    expect(computeCoverage(town([bld(1, "well", 0, "building"), ...houses]))).toEqual({});
    const market = folk(town([bld(1, "market", 0), ...houses]), [{ home: null, job: 1 }]);
    expect(covers(computeCoverage(market)[2], "market")).toBe(true);
    expect(computeCoverage({ ...market, residents: { ...market.residents, 1: { ...market.residents[1], job: null } } })).toEqual({});
    // a school has 2 jobs but one worker is enough
    const school = folk(town([bld(1, "school", 0), ...houses]), [{ home: null, job: 1 }]);
    expect(covers(computeCoverage(school)[2], "school")).toBe(true);
  });
  it("covers only finished houses and is kept in the state by refreshServices", () => {
    const s = refreshServices(town([bld(1, "well", 0), bld(2, "izba", 100, "building"), bld(3, "izba", 100)]));
    expect(Object.keys(s.coverage)).toEqual(["3"]);
    expect(s.landValue[3]).toBeGreaterThan(0);
  });
  it("is computed at the daily step", () => {
    let s = town([bld(1, "well", 0), bld(2, "izba", 100)]);
    s = folk(s, [{ home: 2 }]);
    expect(s.coverage).toEqual({});
    s = dailyServices(s);
    expect(covers(s.coverage[2], "well")).toBe(true);
  });
});

describe("mood terms", () => {
  const base = () => busy(folk(town([bld(1, "well", 0), bld(2, "izba", 100), bld(3, "izba", 1500)]), [{ home: 2, adults: 2 }, { home: 3, adults: 2 }]));
  it("serviceMood sums the covering services, school only for families with school-age children", () => {
    expect(serviceMood(0, true)).toBe(0);
    const all = 0b11111;
    expect(serviceMood(all, true)).toBe(8 + 5 + 7 + 3 + 2);
    expect(serviceMood(all, false)).toBe(8 + 5 + 7 + 2);
  });
  it("a covered household's target is raised by the service, an uncovered one's is not", () => {
    const s = withCoverage(base());
    const d = dailyEconomy({ ...s, gameMinutes: at(13) });
    // target 10 + 45 + 0 + 10 (+ 8 for the well); mood moves a quarter of the way from 60
    expect(d.households[1].mood).toBeCloseTo(60 + (10 + 45 + 10 + 8 - 60) / 4);
    expect(d.households[2].mood).toBeCloseTo(60 + (10 + 45 + 10 - 60) / 4);
  });
  it("tents get no service bonus even with a stale coverage entry", () => {
    const s = withCoverage(base());
    const tent = { ...s, households: { ...s.households, 1: { ...s.households[1], home: null } } };
    expect(dailyEconomy({ ...tent, gameMinutes: at(13) }).households[1].mood).toBeCloseTo(60 + (10 + 45 - 60) / 4);
  });
  it("the school term needs a school-age child", () => {
    const mk = (kidAge: number) => {
      const s = busy(folk(town([bld(1, "school", 0), bld(2, "izba", 100)]), [{ home: 2, adults: 2, kids: 1, kidAge }]));
      s.residents[1].job = 1; // the teacher is the father
      return withCoverage(s);
    };
    expect(dailyEconomy({ ...mk(9), gameMinutes: at(13) }).households[1].mood).toBeCloseTo(60 + (10 + 45 + 10 + 3 - 60) / 4);
    expect(dailyEconomy({ ...mk(3), gameMinutes: at(13) }).households[1].mood).toBeCloseTo(60 + (10 + 45 + 10 - 60) / 4);
  });
  it("mood never exceeds 100", () => {
    let s = base();
    s = { ...s, coverage: { 2: 0b11111 }, households: { ...s.households, 1: { ...s.households[1], mood: 100 } } };
    expect(dailyEconomy({ ...s, gameMinutes: at(13) }).households[1].mood).toBeLessThanOrEqual(100);
  });
});

describe("market hand-out", () => {
  // 25 two-adult households in houses along the road, one market worker, no shops
  const mk = (extra: HSpec[] = []) => {
    const houses = Array.from({ length: 25 }, (_, i) => bld(10 + i, "izba", 100 + 10 * i));
    const specs: HSpec[] = [{ home: 10, adults: 2, job: 1 }, ...houses.slice(1).map((b) => ({ home: b.id, adults: 2 })), ...extra];
    let s = busy(folk(town([bld(1, "market", 0), ...houses]), specs));
    s = withCoverage({ ...s, stock: { ...s.stock, wares: 100 } });
    return s;
  };
  it("each worker serves 20 covered households a day", () => {
    const s = mk();
    const d = dailyEconomy({ ...s, gameMinutes: at(13) });
    expect(s.stock.wares - d.stock.wares).toBeCloseTo(20 * 0.1);
    expect(Object.values(d.households).filter((h) => h.mood > 60 + (10 + 45 + 10 + 5 + 10 - 60) / 4 - 0.01)).toHaveLength(20);
  });
  it("starts from another household the next day", () => {
    const s = mk();
    const lifted = (day: number) =>
      Object.values(dailyEconomy({ ...s, gameMinutes: at(day) }).households)
        .filter((h) => h.mood > 63)
        .map((h) => h.id)
        .join();
    expect(lifted(101)).not.toBe(lifted(102));
  });
  it("tents and households outside the market's reach get nothing", () => {
    const far = bld(60, "izba", 1500);
    const s0 = mk([{ home: null, adults: 2 }, { home: 60, adults: 2 }]);
    const s = withCoverage({ ...s0, buildings: { ...s0.buildings, 60: far } });
    const d = dailyEconomy({ ...s, gameMinutes: at(13) });
    expect(s.stock.wares - d.stock.wares).toBeCloseTo(20 * 0.1);
    expect(d.households[26].mood).toBeCloseTo(60 + (10 + 45 - 60) / 4); // tents, no wares
    expect(d.households[27].mood).toBeCloseTo(60 + (10 + 45 + 10 - 60) / 4); // a house, but out of reach
  });
  it("comes on top of shops: the shop trader serves 12, the market the next 20", () => {
    const s0 = mk();
    // the first household's second adult trades in a shop at the end of the road
    const s = withCoverage({
      ...s0,
      buildings: { ...s0.buildings, 99: bld(99, "shop", 1200) },
      residents: { ...s0.residents, 2: { ...s0.residents[2], job: 99 } },
    });
    const d = dailyEconomy({ ...s, gameMinutes: at(13) });
    // 25 households: 12 served by the shop, the other 13 by the market's 20 slots
    expect(s.stock.wares - d.stock.wares).toBeCloseTo(25 * 0.1);
    // without the market worker only the shop's 12 get wares
    const shopOnly = dailyEconomy({ ...s, residents: { ...s.residents, 1: { ...s.residents[1], job: null } }, gameMinutes: at(13) });
    expect(s.stock.wares - shopOnly.stock.wares).toBeCloseTo(12 * 0.1);
  });
  it("an unstaffed market hands out nothing", () => {
    const s0 = mk();
    const s = withCoverage({ ...s0, residents: { ...s0.residents, 1: { ...s0.residents[1], job: null } } });
    expect(dailyEconomy({ ...s, gameMinutes: at(13) }).stock.wares).toBe(100);
  });
});

describe("healer", () => {
  // rate for age 30 is 0.008 / YEAR_DAYS a day; with the healer 0.6 x that: a draw in between kills only the uncovered
  const draw = () => 2e-4; // between 0.6 x and 1 x of 0.008 / 32 = 2.5e-4
  it("death rates are x 0.6 for covered households", () => {
    let s = folk(town([bld(1, "healer", 0), bld(2, "izba", 100), bld(3, "izba", 1500)]), [{ home: 2, adults: 2, job: 1 }, { home: 3, adults: 2 }]);
    s = withCoverage(s);
    const d = dailyStep(s, { rand: draw, only: ["death"] });
    expect(Object.keys(d.households).map(Number)).toEqual([1]); // household 2 died out
    expect(Object.keys(d.residents)).toHaveLength(2);
    expect(SERVICE.healerDeathFactor).toBe(0.6);
    const none = dailyStep({ ...s, coverage: {} }, { rand: draw, only: ["death"] });
    expect(Object.keys(none.residents)).toHaveLength(0);
  });
  it("an unstaffed healer does not help", () => {
    const s = withCoverage(folk(town([bld(1, "healer", 0), bld(2, "izba", 100)]), [{ home: 2, adults: 2 }]));
    expect(s.coverage).toEqual({});
  });
});

describe("school and literacy", () => {
  const classroom = (kidAge: number, school = 0) => {
    const s = folk(town([bld(1, "school", 0), bld(2, "izba", 100), bld(3, "izba", 1500)]), [
      { home: 2, adults: 2, kids: 1, kidAge, school },
      { home: 3, adults: 2, kids: 1, kidAge, school },
    ]);
    s.residents[1].job = 1; // the teacher
    return withCoverage(s);
  };
  it("children 7-14 covered by a staffed school attend, others do not", () => {
    const s = dailyServices(classroom(9));
    expect(s.residents[3].school).toBeCloseTo(learnPerDay(false)); // covered household: one day of learning
    expect(s.residents[3].inClass).toBe(true);
    expect(s.residents[6].school).toBe(0); // far from the school
    expect(dailyServices(classroom(5)).residents[3].school).toBe(0); // too young
    const closed = classroom(9);
    const noTeacher = dailyServices({ ...closed, residents: { ...closed.residents, 1: { ...closed.residents[1], job: null } } });
    expect(noTeacher.residents[3].school).toBe(0);
  });
  it("serviceStats counts the pupils: children 7-14 in houses a school covers", () => {
    expect(serviceStats(classroom(9)).pupils).toBe(1); // the far household's child is not covered
    expect(serviceStats(classroom(5)).pupils).toBe(0); // too young
  });
  it("the seats of the schools cap the pupils, children first", () => {
    const s = withCoverage(folk(town([bld(1, "school", 0), bld(2, "izba", 100)]), [{ home: 2, adults: 1, kids: SCHOOL_SEATS + 1, kidAge: 9 }]));
    s.residents[1].job = 1; // the teacher
    const d = dailyServices(s);
    expect(serviceStats(d)).toMatchObject({ pupils: SCHOOL_SEATS, seats: SCHOOL_SEATS });
    expect(Object.values(d.residents).filter((r) => r.school > 0)).toHaveLength(SCHOOL_SEATS);
  });
  const day = (s: SimState) => dailyServices({ ...s, gameMinutes: s.gameMinutes + 1440 });
  it("the town sends illiterate grown-ups to school only when ordered; the teacher stays at school", () => {
    const s = classroom(9);
    const ordered = dailyServices({ ...s, levers: { ...s.levers, adultSchool: true } });
    expect(ordered.residents[2].school).toBeCloseTo(learnPerDay(true)); // illiterate adult in a covered house
    expect(ordered.residents[2].inClass).toBe(true);
    expect(ordered.residents[1].school).toBe(0); // the teacher
    expect(dailyServices(s).residents[2].school).toBe(0); // not ordered
  });
  it("a grown-up in class is neither jobless nor a builder: no work at all", () => {
    const s = dailyServices({ ...classroom(9), levers: { ...classroom(9).levers, adultSchool: true } });
    const c = countResidents(s.residents, s.gameMinutes);
    expect(c.inClass).toBe(1); // resident 2; the teacher (1) works, the far adults (4, 5) are jobless
    expect(c.jobless).toBe(2);
    expect(idleResidents(s).has(2)).toBe(false);
  });
  it("a grown-up learns in one year of school days, a child in two", () => {
    let s: SimState = { ...classroom(9), levers: { ...classroom(9).levers, adultSchool: true } };
    for (let d = 1; d < SERVICE.adultLiteracyDays; d++) s = day(s);
    expect(s.residents[2].literate).toBe(false);
    s = day(s);
    expect(s.residents[2].school).toBeCloseTo(100);
    expect(s.residents[2].literate).toBe(true);
    expect(SERVICE.childLiteracyDays).toBe(2 * SERVICE.adultLiteracyDays);
  });
  it("a child learns a little on each school day and is literate after two years", () => {
    let s = classroom(12.9);
    for (let d = 1; d < SERVICE.childLiteracyDays; d++) s = day(s);
    expect(s.residents[3].school).toBeLessThan(100);
    expect(s.residents[3].literate).toBe(false);
    s = day(s);
    expect(s.residents[3].literate).toBe(true);
    expect(s.residents[6].literate).toBe(false); // far from the school
  });
  it("a child who leaves school at 15 keeps the progress he has", () => {
    const s = dailyServices(classroom(15, 50));
    expect(s.residents[3].school).toBe(50);
    expect(s.residents[3].literate).toBe(false);
  });
  it("adults without school stay illiterate", () => {
    const s = dailyServices(folk(town([bld(1, "school", 0), bld(2, "izba", 100)]), [{ home: 2, adults: 2 }]));
    expect(Object.values(s.residents).every((r) => !r.literate)).toBe(true);
    expect(serviceStats(s).literate).toBe(0);
  });
  it("literate workers make workshops 20 % more productive", () => {
    const mk = (literate: boolean) => folk(town([bld(1, "pottery", 50)]), [{ home: null, adults: 2, job: 1, literate }]);
    const plain = produceStep(mk(false), 1);
    // only the first adult has a job: one worker
    expect(plain.stock.wares - mk(false).stock.wares).toBeCloseTo(0.025);
    const lit = produceStep(mk(true), 1);
    expect(lit.stock.wares - mk(true).stock.wares).toBeCloseTo(0.025 * 1.2);
  });
  it("literate shop workers serve 20 % more households", () => {
    const specs = (literate: boolean): HSpec[] => [{ home: null, adults: 1, job: 1, literate }, ...Array.from({ length: 20 }, () => ({ home: null, adults: 2 }))];
    const run = (literate: boolean) => {
      let s = folk(town([bld(1, "shop", 50)]), specs(literate));
      s = { ...s, stock: { ...s.stock, wares: 100 } };
      return s.stock.wares - dailyEconomy({ ...s, gameMinutes: at(13) }).stock.wares;
    };
    // 21 households: 12 served, or 14 (the trader's own household wants only 0.05)
    expect(run(false)).toBeGreaterThanOrEqual(0.1 * 11 + 0.05 - 1e-9);
    expect(run(false)).toBeLessThanOrEqual(0.1 * 12 + 1e-9);
    expect(run(true)).toBeGreaterThanOrEqual(0.1 * 13 + 0.05 - 1e-9);
    expect(run(true)).toBeLessThanOrEqual(0.1 * 14 + 1e-9);
  });
});

describe("land value", () => {
  const houses = () => [bld(1, "well", 0), bld(2, "izba", 100)];
  it("20 + 8 per covered service + 0.3 x (neighbour mood - 50)", () => {
    const s = folk(town(houses()), [{ home: 2, mood: 70 }]);
    const lv = computeLandValue(s, { 2: 0b00011 }); // two services
    expect(lv[2]).toBe(Math.round(20 + 16 + 0.3 * 20));
    expect(computeLandValue(s, {})[2]).toBe(Math.round(20 + 0.3 * 20));
  });
  it("is clamped to 0..100", () => {
    const hi = folk(town(houses()), [{ home: 2, mood: 100 }]);
    expect(computeLandValue(hi, { 2: 0b11111 })[2]).toBe(75);
    const lo = folk(town(houses()), [{ home: 2, mood: 0 }]);
    expect(computeLandValue(lo, {})[2]).toBe(5);
    expect(computeLandValue(hi, { 2: 0b11111 })[2]).toBeLessThanOrEqual(100);
  });
  it("counts only households within 100 m, and a vacant house has no mood term", () => {
    const s = folk(town([bld(1, "izba", 100), bld(2, "izba", 150), bld(3, "izba", 600)]), [{ home: 2, mood: 90 }, { home: 3, mood: 10 }]);
    const lv = computeLandValue(s, {});
    expect(lv[1]).toBe(Math.round(20 + 0.3 * 40)); // the neighbour at 50 m counts, the one at 500 m does not
    expect(lv[3]).toBe(Math.round(20 + 0.3 * (10 - 50)));
    const vacant = computeLandValue(folk(town([bld(1, "izba", 100)]), []), {});
    expect(vacant[1]).toBe(20);
  });
});

describe("house upgrade", () => {
  // all five services cover the house, a happy family (land 20 + 40 + 0.3 x 40 = 72)
  const rich = (mood = 90) => {
    const s = folk(town([bld(1, "well", 0), bld(2, "chapel", 40), bld(3, "healer", 80), bld(4, "izba", 120), bld(5, "market", 160), bld(6, "school", 200)]), [
      { home: 4, adults: 2, mood },
      { home: null, adults: 1, job: 2 },
      { home: null, adults: 1, job: 3 },
      { home: null, adults: 1, job: 5 },
      { home: null, adults: 1, job: 6 },
    ]);
    // residents 1-2 live in house 4; the services need workers: give them the tent adults
    return s;
  };
  const day = (s: SimState) => dailyServices({ ...s, gameMinutes: s.gameMinutes + 1440 });
  it("starts after 20 good days in a row", () => {
    let s = day(rich());
    expect(servicesIn(s.coverage[4])).toEqual(["well", "market", "chapel", "school", "healer"]);
    expect(s.landValue[4]).toBeGreaterThanOrEqual(SERVICE.upgradeLand);
    expect(s.buildings[4].streak).toBe(1);
    for (let d = 0; d < 18; d++) s = day(s);
    expect(s.buildings[4].streak).toBe(19);
    expect(s.buildings[4].upgrade).toBeUndefined();
    s = day(s);
    expect(s.buildings[4].upgrade).toEqual({ labor: UPGRADE.labor, done: 0, paid: false });
    expect(s.buildings[4].streak).toBe(0);
    expect(s.buildings[4].state).toBe("active");
    expect(s.households[1].home).toBe(4); // the family stays
    expect(constructionWork(s.buildings, s.roads)).toBe(true);
  });
  it("one low-mood day resets the streak", () => {
    let s = day(rich());
    for (let d = 0; d < 5; d++) s = day(s);
    expect(s.buildings[4].streak).toBe(6);
    s = day({ ...s, households: { ...s.households, 1: { ...s.households[1], mood: 74 } } });
    expect(s.buildings[4].streak).toBe(0);
  });
  it("the land threshold is 60: four services and a happy neighbourhood are enough", () => {
    expect(SERVICE.upgradeLand).toBe(60);
    expect(upgradeShortfall(60, undefined, 80)).toEqual([]);
    expect(upgradeShortfall(59, undefined, 80)).toEqual(["стоимость участка 59 из 60, нет: вода, рынок, храм, школа, лечебница"]);
  });
  it("the inspector names what keeps a house from its second level", () => {
    const poor = folk(town([bld(4, "izba", 120)]), [{ home: 4, adults: 2, mood: 60 }]);
    const left = upgradeBlockers(poor, poor.buildings[4], 60);
    expect(left).toEqual(expect.arrayContaining([expect.stringContaining("нет: вода"), "настроение 60 из 75"]));
    const ok = day(rich());
    expect(upgradeBlockers(ok, ok.buildings[4], 90)).toEqual([]);
    expect(upgradeBlockers(ok, ok.buildings[5], 90)).toEqual([]);
  });
  it("needs the land value too, and only an izba upgrades", () => {
    const poor = folk(town([bld(4, "izba", 120)]), [{ home: 4, adults: 2, mood: 100 }]);
    let s = poor;
    for (let d = 0; d < 12; d++) s = day(s);
    expect(s.buildings[4].streak).toBe(0);
    expect(s.buildings[4].upgrade).toBeUndefined();
    const five = rich();
    let t: SimState = { ...five, buildings: { ...five.buildings, 4: bld(4, "izba5", 120) } };
    for (let d = 0; d < 12; d++) t = day(t);
    expect(t.buildings[4].upgrade).toBeUndefined();
  });
  it("is built like construction: materials from the stock, 60 h of labor, then level 2", () => {
    const s = rich();
    const house: Building = { ...s.buildings[4], upgrade: { labor: UPGRADE.labor, done: 0, paid: false } };
    const buildings = { ...s.buildings, 4: house };
    const stock = { ...s.stock, logs: 30, planks: 5, stone: 0 };
    const paid = payMaterials(buildings, stock, 100);
    expect(paid.stock).toMatchObject({ logs: 20, planks: 3 });
    expect(paid.buildings[4].upgrade).toEqual({ labor: 60, done: 0, paid: true });
    const half = advanceBuildings(paid.buildings, 30);
    expect(half[4].upgrade!.done).toBe(30);
    expect(half[4].level).toBe(1);
    const done = advanceBuildings(half, 40);
    expect(done[4].level).toBe(2);
    expect(done[4].upgrade).toBeUndefined();
    expect(done[4].height).toBeCloseTo(BUILDINGS.izba.height + UPGRADE.height);
    expect(done[4].state).toBe("active");
    expect(houseCapacity(done[4])).toBe(BUILDINGS.izba.residents + 2);
    expect(constructionWork(done, s.roads)).toBe(false);
  });
  it("what the stock lacks is made by hand and added to the labor", () => {
    const s = rich();
    const house: Building = { ...s.buildings[4], upgrade: { labor: UPGRADE.labor, done: 0, paid: false } };
    const paid = payMaterials({ ...s.buildings, 4: house }, { ...s.stock, logs: 0, planks: 0 }, 100);
    expect(paid.buildings[4].upgrade!.labor).toBe(60 + 10 * HAND_HOURS.logs + 2 * HAND_HOURS.planks);
  });
  it("level 2 houses hold two more people: births continue up to the new capacity", () => {
    const s = rich();
    const big: Building = { ...s.buildings[4], level: 2 };
    expect(houseCapacity(big)).toBe(7);
    expect(houseCapacity(s.buildings[4])).toBe(5);
  });
});

describe("workers without inputs build", () => {
  const mk = (logs: number, yesterday = 0) => {
    let s = folk(town([bld(1, "sawpit", 50), bld(2, "izba", 100, "building"), bld(5, "izba", 200)]), [{ home: null, adults: 2, job: 1 }, { home: null, adults: 4 }]);
    s = { ...s, stock: { ...s.stock, logs }, prod: { ...s.prod, yesterday: { 1: yesterday } } };
    s.residents[2] = { ...s.residents[2], job: 1 };
    return s;
  };
  it("count as builders when the workshop made nothing yesterday and has no input", () => {
    const s = mk(0);
    expect(builderCount(s)).toBe(6); // four jobless adults and both sawyers
    expect(peopleStats(s)).toMatchObject({ builders: 6, unemployed: 0 });
  });
  it("not while there are logs or the workshop worked yesterday", () => {
    expect(builderCount(mk(5))).toBe(4);
    expect(peopleStats(mk(5)).builders).toBe(4);
    expect(builderCount(mk(0, 0.5))).toBe(4);
  });
  it("they are no unemployed when nothing is built (they have a job)", () => {
    const s = mk(0);
    const calm = { ...s, buildings: { 1: s.buildings[1] } };
    expect(peopleStats(calm)).toMatchObject({ builders: 0, unemployed: 4 });
  });
  it("the inspector shows them as builders", () => {
    const s = mk(0);
    const q = queryBuilding(s, 1)!;
    expect(q.kind === "workplace" && q.workers.every((w) => w.idle)).toBe(true);
    const house = queryBuilding({ ...s, households: { ...s.households, 1: { ...s.households[1], home: 5 } } }, 5)!;
    expect(house.kind === "house" && house.households[0].people.map((p) => p.role)).toEqual(["на стройке", "на стройке"]);
  });
});

describe("inspector and snapshot", () => {
  const sim = () => {
    const s = folk(town([bld(1, "well", 0), bld(2, "market", 40), bld(3, "izba", 100), bld(4, "izba", 1500)]), [{ home: 3, adults: 2, job: 2 }, { home: 4, adults: 2 }]);
    return dailyServices(s);
  };
  it("houses report their services, land value and level", () => {
    const q = queryBuilding(sim(), 3)!;
    expect(q).toMatchObject({ kind: "house", level: 1, upgrading: false, services: ["well", "market"] });
    expect(q.kind === "house" && q.landValue).toBeGreaterThan(30);
  });
  it("aggregates count houses covered per service", () => {
    const stats = serviceStats(sim());
    expect(stats.houses).toBe(2);
    expect(stats.covered).toEqual({ well: 1, market: 1, chapel: 0, school: 0, healer: 0 });
    expect(stats.avgLandValue).toBeGreaterThan(20);
    expect(stats.level2).toBe(0);
    const snap = toSnapshot(sim());
    expect(snap.services.covered.well).toBe(1);
    expect(snap.houseMood[3]).toBe(60);
    expect(snap.coverage[3]).toBeGreaterThan(0);
  });
});

describe("reach segments", () => {
  it("cuts an edge where the reach ends", () => {
    const roads = roadAlong(1000);
    const seg = reachSegments(roads, 0, 3, 150);
    // limit 147 m from node 0: the edges 0-100 whole and 100-200 up to 47 m
    expect(seg).toHaveLength(2);
    const lens = seg.map(([a, b]) => Math.hypot(b[0] - a[0], b[1] - a[1])).sort((p, q) => p - q);
    expect(lens[0]).toBeCloseTo(47, 0);
    expect(lens[1]).toBeCloseTo(100, 0);
  });
  it("skips unbuilt edges", () => {
    expect(reachSegments(roadAlong(1000, 100), 0, 3, 1000)).toHaveLength(1);
  });
  it("starts from the point on the road, not from a node: a spot mid-edge reaches both ways at its own distance", () => {
    const seg = reachSegments(roadAlong(1000), 50, 3, 150);
    expect(seg).toHaveLength(2);
    expect(Math.max(...seg.flat().map((p) => p[0]))).toBeCloseTo(197, 0);
  });
  it("a well one house away on the same long road covers it", () => {
    const s = town([bld(1, "well", 50), bld(2, "izba", 60)]);
    expect(servicesIn(computeCoverage(s)[2])).toEqual(["well"]);
  });
});

describe("save", () => {
  const raw = (b: Record<string, unknown>) => ({
    version: 4,
    city: { name: "Тест", lat: 55, lng: 37, foundedAt: 1_700_000_000_000 },
    sim: { realTime: NOW - 1000, gameMinutes: 0, buildings: { 1: b }, nextBuildingId: 2 },
  });
  const izba = (extra: Record<string, unknown> = {}) => ({ ...bld(1, "izba", 0), ...extra });
  const strip = (b: Building) => {
    const { level: _l, streak: _s, ...rest } = b;
    return rest;
  };
  it("saves from before services get level 1, no streak, illiterate residents and empty coverage", () => {
    const save = parseSave(raw(strip(bld(1, "izba", 0))), NOW)!;
    expect(save.sim.buildings[1]).toMatchObject({ level: 1, streak: 0 });
    expect(save.sim.buildings[1].upgrade).toBeUndefined();
    expect(save.sim.coverage).toEqual({});
    expect(save.sim.landValue).toEqual({});
    const founder = Object.values(save.sim.residents)[0];
    expect(founder).toMatchObject({ literate: false, school: 0 });
  });
  it("keeps a level 2 izba and an upgrade in progress", () => {
    expect(parseSave(raw(izba({ level: 2 })), NOW)!.sim.buildings[1].level).toBe(2);
    const up = parseSave(raw(izba({ upgrade: { labor: 60, done: 20, paid: true }, streak: 3 })), NOW)!.sim.buildings[1];
    expect(up.upgrade).toEqual({ labor: 60, done: 20, paid: true });
    expect(up.streak).toBe(3);
  });
  it("repairs broken values instead of losing the town", () => {
    const b = parseSave(raw(izba({ level: 7, streak: -4, upgrade: { labor: -1, done: 0 } })), NOW)!.sim.buildings[1];
    expect(b).toMatchObject({ level: 1, streak: 0 });
    expect(b.upgrade).toBeUndefined();
    // a level 2 smithy makes no sense
    expect(parseSave(raw({ ...bld(1, "smithy", 0), level: 2 }), NOW)!.sim.buildings[1].level).toBe(1);
    // an upgrade on a building that is not finished is dropped
    expect(parseSave(raw(izba({ state: "building", done: 0, upgrade: { labor: 60, done: 0, paid: false } })), NOW)!.sim.buildings[1].upgrade).toBeUndefined();
  });
  it("founding households of older saves are those that arrived at minute 0", () => {
    const s = folk(town([bld(1, "izba", 0)]), [{ home: 1 }, { home: null }, { home: null }]);
    const hh = (founder?: boolean) => ({
      1: { ...s.households[1], founder: undefined },
      2: { ...s.households[2], arrived: 500, founder: undefined },
      3: { ...s.households[3], arrived: 500, founder },
    });
    const parse = (founder?: boolean) =>
      parseSave(JSON.parse(JSON.stringify({ version: 4, city: { name: "Тест", lat: 55, lng: 37, foundedAt: 1_700_000_000_000 }, sim: { ...s, households: hh(founder), realTime: NOW - 1000 } })), NOW)!.sim.households;
    expect([1, 2, 3].map((id) => parse()[id].founder)).toEqual([true, false, false]);
    expect(parse(true)[3].founder).toBe(true); // an explicit flag wins
  });
  it("round-trips residents' literacy and learning progress", () => {
    const s = folk(town([bld(1, "izba", 0)]), [{ home: 1, adults: 1, kids: 1, kidAge: 9, school: 40, literate: true }]);
    const json = JSON.parse(JSON.stringify({ version: 4, city: { name: "Тест", lat: 55, lng: 37, foundedAt: 1_700_000_000_000 }, sim: { ...s, realTime: NOW - 1000 } }));
    const back = parseSave(json, NOW)!.sim;
    expect(back.residents[1].literate).toBe(true);
    expect(back.residents[2].school).toBe(40);
  });
});

describe("determinism with services", () => {
  it("two runs of a town with services are identical", () => {
    const build = () => {
      let s = folk(town([bld(1, "well", 0), bld(2, "market", 40), bld(3, "school", 80), bld(4, "izba", 120), bld(5, "izba", 160)]), [
        { home: 4, adults: 2, kids: 2, kidAge: 9, job: 2 },
        { home: 5, adults: 2, job: 3 },
      ]);
      s = { ...s, realTime: NOW };
      return s;
    };
    const a = advanceTo(build(), NOW + 12 * 3600 * 1000);
    const b = advanceTo(build(), NOW + 12 * 3600 * 1000);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.gameMinutes).toBeGreaterThan(NOON);
  });
});

describe("minimum artel", () => {
  // n adults, all employed in shops, with a planned house to build
  const employed = (adults: number, planned = true) => {
    const bs = [bld(1, "pottery", 50), ...(planned ? [bld(2, "izba", 100, "planned")] : [])];
    return folk(town(bs), Array.from({ length: adults }, () => ({ home: null, adults: 1, job: 1 })));
  };
  it("is max(3, 20 % of the adults), drafted from the employed", () => {
    expect(builderCount(employed(10))).toBe(3);
    expect(builderCount(employed(20))).toBe(4);
    expect(builderCount(employed(40))).toBe(8);
    expect(peopleStats(employed(20)).builders).toBe(4);
  });
  it("only while construction work exists, and only the shortfall", () => {
    expect(builderCount(employed(10, false))).toBe(0);
    expect(productionScale(employed(10, false))).toBe(1);
    // 4 jobless adults already are enough
    const s = employed(10);
    const more = folk(s, [...Array.from({ length: 6 }, () => ({ home: null, adults: 1, job: 1 })), { home: null, adults: 4 }]);
    expect(builderCount(more)).toBe(4);
    expect(productionScale(more)).toBe(1);
  });
  it("cannot draft more than there are workers", () => {
    const s = folk(town([bld(1, "pottery", 50), bld(2, "izba", 100, "planned")]), [{ home: null, adults: 1, job: 1 }]);
    expect(builderCount(s)).toBe(1);
  });
  it("scales the production of all workplaces by 1 - drafted / employed", () => {
    const s = employed(10);
    expect(productionScale(s)).toBeCloseTo(1 - 3 / 10);
    // only the first adult of a household has a job in folk(); count by employed
    const made = (st: SimState) => produceStep(st, 1).stock.wares - st.stock.wares;
    expect(made(s) / made(employed(10, false))).toBeCloseTo(0.7);
    // an explicit scale wins (the clock passes the one of the tick's start)
    expect(produceStep(s, 1, 0.5).stock.wares - s.stock.wares).toBeCloseTo(0.5 * 10 * 0.025);
  });
});

describe("food outlook", () => {
  const base = (gm: number) => busy(folk(town([bld(1, "izba", 0)], roadAlong(), gm), [{ home: 1, adults: 2 }])); // 1.4 kg a day
  // food for `kg` times the need of a full year (1.4 kg a day)
  const withFood = (gm: number, kg: number) => ({ ...base(gm), stock: { ...base(gm).stock, food: kg * YEAR_DAYS * 1.4 } });
  it("is (projected / need - 0.9) / 0.3, clamped", () => {
    const gm = at(12, 12);
    expect(foodOutlook(withFood(gm, 0.9))).toBeCloseTo(0);
    expect(foodOutlook(withFood(gm, 1.05))).toBeCloseTo(0.5);
    expect(foodOutlook(withFood(gm, 1.2))).toBeCloseTo(1);
    expect(foodOutlook(withFood(gm, 5))).toBe(1);
    expect(foodOutlook(withFood(gm, 0.1))).toBe(0);
  });
  it("looks a full year ahead at any date", () => {
    for (const day of [2, 12, 22, 28]) {
      expect(foodOutlook(withFood(at(day, 12), 1.2))).toBeCloseTo(1);
      expect(foodOutlook(withFood(at(day, 12), 0.9))).toBeCloseTo(0);
    }
  });
  it("counts the unreaped harvest of sown fields while the window is open", () => {
    const gm = at(12, 12);
    const field = { id: 1, pts: [[0, 60], [100, 60], [100, 160], [0, 160]] as [number, number][], area: 10_000 }; // 1 ha
    const s0 = busy(folk(town([bld(1, "gumno", 50), bld(2, "izba", 0)], roadAlong(), gm), [{ home: 2, adults: 2 }]));
    const s = { ...s0, zones: { ...s0.zones, fields: [field] }, stock: { ...s0.stock, food: 0 } };
    // need 1.4 x YEAR_DAYS kg; a field not sown yet counts in full (the yield of 1 ha), a gumno works it
    const Y = FIELD.yieldKgHa;
    const need = 1.4 * YEAR_DAYS;
    const o = (food: number, st = s) => foodOutlook({ ...st, stock: { ...st.stock, food } });
    const short = need * 0.9 - Y; // the food that makes the outlook exactly 0 with one harvest
    expect(o(short)).toBeCloseTo(0);
    expect(o(short + need * 0.15)).toBeCloseTo(0.5);
    // fully sown: the same yield expected; half reaped: only half is left
    const sown = { ...s, prod: { ...s.prod, fields: { 1: { year: 1, sowH: FIELD.sowHoursHa, harvH: 0, reaped: 0 } } } };
    expect(o(short, sown)).toBeCloseTo(0);
    const half = { ...s, prod: { ...s.prod, fields: { 1: { year: 1, sowH: FIELD.sowHoursHa, harvH: FIELD.harvestHoursHa / 2, reaped: Y / 2 } } } };
    expect(o(short + Y / 2, half)).toBeCloseTo(0);
    // after the window the next year's harvest counts in full, whatever this year gave
    expect(o(short, { ...half, gameMinutes: at(28, 12) })).toBeCloseTo(0);
    // a field no gumno works adds nothing
    const none = { ...s, buildings: { 2: s.buildings[2], 900: s.buildings[900] } };
    expect(o(short, none)).toBe(0);
  });
  it("counts the fishers' daily output until then", () => {
    const gm = at(12, 12);
    const s0 = busy(folk(town([bld(1, "fisher", 50), bld(2, "izba", 0)], roadAlong(), gm), [{ home: 2, adults: 2, job: 1 }]));
    const s = { ...s0, stock: { ...s0.stock, food: 0 } };
    // 1 fisher x 0.6 kg x 12 h = 7.2 kg a day against 1.4: more than enough
    expect(foodOutlook(s)).toBe(1);
    // in winter 3.6 kg a day: still above the need
    expect(foodOutlook({ ...s, gameMinutes: at(28, 12) })).toBe(1);
  });
  it("is in the economy stats", () => {
    expect(economyStats(withFood(at(12, 12), 5)).outlook).toBe(1);
  });
  it("no people, no need", () => {
    expect(foodOutlook({ ...base(at(12, 12)), residents: {}, households: {} })).toBe(1);
  });
});

describe("foraging and unemployment", () => {
  // two houses, no construction work: the adults without a job are idle
  const calm = (gm: number, specs: HSpec[] = [{ home: 1, adults: 2 }, { home: 2, adults: 1, job: 5 }]) =>
    folk(town([bld(1, "izba", 100), bld(2, "izba", 200), bld(5, "pottery", 300)], roadAlong(), gm), specs);
  it("idle adults gather 1.2 kg a day, 0.4 in winter", () => {
    expect(idleResidents(calm(at(12, 12))).size).toBe(2);
    expect(forageKg(calm(at(12, 12)))).toBeCloseTo(2 * FORAGE.day);
    expect(FORAGE).toEqual({ day: 1.2, winter: 0.4 });
    expect(forageKg(calm(at(4, 12)))).toBeCloseTo(2.4); // spring
    expect(forageKg(calm(at(18, 12)))).toBeCloseTo(2.4); // autumn
    expect(forageKg(calm(at(28, 12)))).toBeCloseTo(0.8); // winter
  });
  it("those with a job, children and old people gather nothing; nobody forages while there is building work", () => {
    expect(idleResidents(calm(at(12, 12), [{ home: 1, adults: 1, job: 5, kids: 2 }])).size).toBe(0);
    expect(forageKg(busy(calm(at(12, 12))))).toBe(0);
  });
  it("farmers with no field work count as idle when nothing is built", () => {
    const s = folk(town([bld(1, "izba", 100), bld(2, "gumno", 200)], roadAlong(), at(12, 12)), [{ home: 1, adults: 1, job: 2 }]);
    expect(idleResidents(s).size).toBe(1); // summer: the land has no work
  });
  it("is added to the stock at the daily food step, up to the capacity", () => {
    const s = calm(at(12, 12));
    const d = dailyEconomy({ ...s, gameMinutes: at(13) });
    // eaten 3 x 0.7, gathered 2 x 1.2
    expect(d.stock.food - s.stock.food).toBeCloseTo(2.4 - 2.1);
    const full = dailyEconomy({ ...s, stock: { ...s.stock, food: 3000 }, gameMinutes: at(13) });
    expect(full.stock.food).toBeCloseTo(3000 - 2.1);
    expect(full.prod.flags.rot).toBe(0);
  });
  it("lowers the mood target by 12 x the share of idle adults in the household", () => {
    const s = calm(at(12, 12), [{ home: 1, adults: 2, job: 5 }, { home: 2, adults: 2 }]); // only the first adult of a household has the job
    const d = dailyEconomy({ ...s, gameMinutes: at(13) });
    // target 10 + 45 + 10 (house); household 1: one of two adults idle, household 2: both
    expect(d.households[1].mood).toBeCloseTo(60 + (65 - 6 - 60) / 4);
    expect(d.households[2].mood).toBeCloseTo(60 + (65 - 12 - 60) / 4);
    // with building work nobody is idle
    const b = dailyEconomy({ ...busy(s), gameMinutes: at(13) });
    expect(b.households[2].mood).toBeCloseTo(60 + (65 - 60) / 4);
  });
  it("shows in the economy stats and the food outlook", () => {
    const s = calm(at(12, 12));
    expect(economyStats(s).forage).toBeCloseTo(2.4);
    // 3 people eat 2.1 kg, 2.4 are gathered: 1.143 of the need, (1.143 - 0.9) / 0.3
    expect(foodOutlook({ ...s, stock: { ...s.stock, food: 0 } })).toBeCloseTo((2.4 / 2.1 - 0.9) / 0.3);
    expect(foodOutlook({ ...busy(s), stock: { ...s.stock, food: 0 } })).toBe(0);
  });
  it("an idle founding family stays and is fed for months", () => {
    let s = folk(calm(at(12, 12)), [{ home: 1, adults: 2 }]);
    s = { ...s, households: { 1: { ...s.households[1], founder: true, mood: 20 } } };
    for (let d = 0; d < 20; d++) s = dailyStep(dailyEconomy({ ...s, gameMinutes: s.gameMinutes + 1440 }), { rand: () => 0.01 });
    expect(Object.keys(s.households)).toContain("1");
  });
});
