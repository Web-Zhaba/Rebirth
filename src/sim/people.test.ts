import { describe, expect, it } from "vitest";
import { advanceTo, BASE_TICK, step } from "./clock";
import { BUILDINGS } from "./buildings";
import { demand, emptyGrowth, seedOf } from "./growth";
import { Handler, type Storage } from "./handler";
import {
  ageOf,
  builderCount,
  RATES,
  constructionWork,
  createFounders,
  dailyStep,
  deathRate,
  familyGenitive,
  FEMALE_NAMES,
  immigrationStep,
  MALE_NAMES,
  peopleStats,
  queryBuilding,
  SURNAMES,
  surnameFor,
  syncPeople,
  vacantHouses,
  type RuleOpts,
} from "./people";
import type { FromWorker } from "./protocol";
import { addRoad, emptyRoads } from "./roads";
import { parseSave } from "./save";
import { YEAR_MIN, YEAR_SCALE } from "./time";
import type { Building, City, Household, Resident, RoadGraph, SaveV4, SimState, TerrainInfo } from "./types";
import { emptyZones, qkey, regenerateCells } from "./zones";

const NOW = 1_800_000_000_000;
const MIDNIGHT = 1080; // 00:00 of game day 2
const always = () => 0; // every probabilistic rule succeeds
const never = () => 0.999999; // none does
const WALK = 4000 / 60;

const road = (pts: [number, number][], labor = 0): RoadGraph => {
  const r = addRoad(emptyRoads(), pts, "dirt", 1, pts.slice(1).map(() => labor));
  if (!r.ok) throw new Error(r.reason);
  return r.graph;
};
// A road along the x axis with a node every 100 m; built unless `labor` > 0.
const roadAlong = (len = 3000, labor = 0): RoadGraph =>
  road(Array.from({ length: Math.floor(len / 100) + 1 }, (_, i): [number, number] => [i * 100, 0]), labor);

// A building whose door (lot front) is at (x, 3), right beside the road.
function building(id: number, template: string, x: number, state: Building["state"] = "active"): Building {
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
    paid: true,
    level: 1,
    streak: 0,
  };
}

function town(bs: Building[], roads: RoadGraph = roadAlong(), gm = MIDNIGHT): SimState {
  const buildings: Record<number, Building> = {};
  for (const b of bs) buildings[b.id] = b;
  return { realTime: NOW, gameMinutes: gm, roads, zones: emptyZones(), ...emptyGrowth(7, gm), buildings, nextBuildingId: bs.length + 1 };
}

interface HSpec {
  home: number | null;
  people: { sex?: "m" | "f"; age?: number; job?: number }[];
}

// Replaces the founders with exactly these households (nobody married).
function custom(s: SimState, specs: HSpec[]): SimState {
  const residents: Record<number, Resident> = {};
  const households: Record<number, Household> = {};
  let pid = 1;
  specs.forEach((sp, i) => {
    const hid = i + 1;
    const members: number[] = [];
    for (const p of sp.people) {
      const id = pid++;
      residents[id] = {
        id,
        first: "Иван",
        last: "Тестов",
        sex: p.sex ?? "m",
        born: s.gameMinutes - (p.age ?? 30) * YEAR_MIN,
        household: hid,
        spouse: null,
        job: p.job ?? null,
        commute: p.job === undefined ? null : 5,
        idleDays: 0,
        literate: false,
        school: 0,
      };
      members.push(id);
    }
    households[hid] = { id: hid, last: "Тестов", home: sp.home, members, arrived: 0, founder: false, mood: 60 };
  });
  return { ...s, residents, households, nextPersonId: pid, nextHouseholdId: specs.length + 1, events: [] };
}

// One game day with only the deterministic rules (moving in, jobs) unless told otherwise.
const day = (s: SimState, opts: RuleOpts = { only: [] }) => dailyStep(s, opts);
const ages = (s: SimState) => Object.values(s.residents).map((r) => (s.gameMinutes - r.born) / YEAR_MIN);
const houses = (n: number) => Array.from({ length: n }, (_, i) => building(i + 1, "izba", 100 + i * 100));
const kinds = (s: SimState) => s.events.map((e) => e.kind);

describe("names", () => {
  it("has enough names and handles feminine surnames", () => {
    expect(MALE_NAMES.length).toBeGreaterThanOrEqual(25);
    expect(FEMALE_NAMES.length).toBeGreaterThanOrEqual(25);
    expect(SURNAMES.length).toBeGreaterThanOrEqual(40);
    expect(surnameFor("Смирнов", "f")).toBe("Смирнова");
    expect(surnameFor("Васильев", "f")).toBe("Васильева");
    expect(surnameFor("Ильин", "f")).toBe("Ильина");
    expect(surnameFor("Седых", "f")).toBe("Седых");
    expect(surnameFor("Смирнов", "m")).toBe("Смирнов");
    expect(familyGenitive("Смирнов")).toBe("Смирновых");
    expect(familyGenitive("Седых")).toBe("Седых");
    expect(surnameFor("Королёв", "f")).toBe("Королёва");
    expect(familyGenitive("Королёв")).toBe("Королёвых");
  });
  it("death rates follow the age bands", () => {
    expect([2, 10, 30, 55, 65, 80].map(deathRate)).toEqual([0.03, 0.005, 0.008, 0.02, 0.05, 0.15]);
  });
});

describe("founders", () => {
  it("are exactly 14 people in 4 married households in tents", () => {
    for (let seed = 1; seed <= 25; seed++) {
      const { people } = createFounders(seed, 0);
      const rs = Object.values(people.residents);
      const hs = Object.values(people.households);
      expect(rs).toHaveLength(14);
      expect(hs).toHaveLength(4);
      expect(rs.filter((r) => -r.born / YEAR_MIN < 16)).toHaveLength(6); // 8 adults, 6 children
      for (const h of hs) {
        expect(h.home).toBeNull();
        const m = h.members.map((id) => people.residents[id]);
        const adults = m.filter((r) => -r.born / YEAR_MIN >= 20);
        expect(adults).toHaveLength(2);
        const [a, b] = adults;
        expect(a.spouse).toBe(b.id);
        expect(b.spouse).toBe(a.id);
        expect(new Set(adults.map((r) => r.sex))).toEqual(new Set(["m", "f"]));
        expect(adults.every((r) => -r.born / YEAR_MIN <= 40)).toBe(true);
        expect(m.length - 2).toBeLessThanOrEqual(2);
        for (const r of m) expect(r.last).toBe(surnameFor(h.last, r.sex));
      }
      expect(people.nextPersonId).toBe(15);
    }
  });
  it("a new town starts with them", () => {
    const g = emptyGrowth(5);
    expect(Object.keys(g.residents)).toHaveLength(14);
    expect(g.events).toEqual([]);
  });
});

describe("moving in", () => {
  it("tent households take vacant finished houses, lowest id first, one per house", () => {
    const s = town([building(1, "izba", 100), building(2, "izba", 200), building(3, "izba", 300, "planned")]);
    const a = day(s);
    const h = Object.values(a.households).sort((p, q) => p.id - q.id);
    expect(h.map((x) => x.home)).toEqual([1, 2, null, null]);
    expect(kinds(a)).toEqual(["movein", "movein"]);
    expect(vacantHouses(a.buildings, a.households)).toEqual([]);
  });
  it("a household that does not fit waits for a bigger house", () => {
    const big = custom(town([building(1, "izba", 100), building(2, "izba5", 200)]), [{ home: null, people: Array(6).fill({}) }]);
    expect(day(big).households[1].home).toBe(2);
    const small = custom(town([building(1, "izba", 100)]), [{ home: null, people: Array(6).fill({}) }]);
    expect(day(small).households[1].home).toBeNull();
  });
  it("a removed house sends its household back to the tents", () => {
    const a = day(town(houses(4)));
    expect(Object.values(a.households).every((h) => h.home !== null)).toBe(true); // the four founders
    const { 2: _gone, ...rest } = a.buildings;
    const b = syncPeople({ ...a, buildings: rest });
    expect(Object.values(b.households).filter((h) => h.home === null)).toHaveLength(1);
    expect(syncPeople(b)).toBe(b);
  });
});

describe("immigration", () => {
  // the 4 founding households move into houses 1-4 and house 5 stays vacant
  // plenty of food: the outlook (a full year ahead) is 1
  const settled = (extra: Building[]) => {
    const s = town([...houses(4), building(5, "izba", 500), ...extra]);
    return day({ ...s, stock: { ...s.stock, food: 20000 } });
  };
  const jobs = () => [building(6, "smithy", 600), building(7, "carpentry", 700), building(8, "pottery", 800)]; // 10 jobs for 8 adults

  it("the daily step stores how attractive the town is", () => {
    const s = settled(jobs());
    expect(peopleStats(s).unemployed).toBe(0);
    expect(s.attract).toBeGreaterThan(0.5); // mood 60 x food outlook 1
    expect(s.attract).toBeLessThanOrEqual(1);
    expect(s.households[1].home).toBe(1); // but nobody arrives in the daily step
    expect(s.incoming).toEqual([]);
    expect(Object.keys(s.households)).toHaveLength(4);
  });
  it("is 0 when everybody is unemployed", () => {
    const s = settled([]); // no workplaces and no construction: all adults idle
    expect(peopleStats(s)).toMatchObject({ unemployed: 8, builders: 0 });
    expect(s.attract).toBe(0);
  });
  it("sends a family to a vacant house, 6-12 game hours away, only once per house", () => {
    const s = { ...settled(jobs()), attract: 1 };
    const a = immigrationStep(s, BASE_TICK);
    expect(a.incoming).toHaveLength(1);
    expect(a.incoming[0].house).toBe(5);
    expect(a.incoming[0].arrive - s.gameMinutes).toBeGreaterThanOrEqual(6 * 60);
    expect(a.incoming[0].arrive - s.gameMinutes).toBeLessThanOrEqual(12 * 60);
    expect(Object.keys(a.households)).toHaveLength(4); // not arrived yet
    expect(immigrationStep(a, BASE_TICK).incoming).toBe(a.incoming); // the house is promised already
    const calm = { ...s, attract: 0 };
    expect(immigrationStep(calm, BASE_TICK)).toBe(calm);
  });
  it("the per-tick hazard adds up to the daily rate", () => {
    const base: SimState = { ...settled(jobs()), attract: 0.5 };
    let came = 0;
    const days = 300;
    for (let seed = 1; seed <= days; seed++) {
      let s = { ...base, rng: seed };
      for (let t = 0; t < 1440 / BASE_TICK && s.incoming.length === 0; t++) s = immigrationStep(s, BASE_TICK);
      if (s.incoming.length > 0) came++;
    }
    expect(came / days).toBeGreaterThan(0.4); // 1 - (1 - 0.5)^1 = 0.5
    expect(came / days).toBeLessThan(0.6);
  });
  it("the family arrives at its time into the promised house", () => {
    const s = settled(jobs());
    const gm = s.gameMinutes;
    const wait = { ...s, attract: 0, incoming: [{ house: 5, arrive: gm + 1 }] };
    expect(immigrationStep(wait, BASE_TICK)).toBe(wait); // not due yet
    const a = immigrationStep({ ...wait, incoming: [{ house: 5, arrive: gm }] }, BASE_TICK);
    const fam = Object.values(a.households).find((h) => h.home === 5)!;
    expect(fam).toBeDefined();
    expect(fam.founder).toBe(false);
    expect(fam.members.length).toBeGreaterThanOrEqual(2);
    expect(fam.members.length).toBeLessThanOrEqual(5);
    expect(a.incoming).toEqual([]);
    expect(a.events.at(-1)).toMatchObject({ kind: "arrival" });
    expect(a.events.at(-1)!.text).toContain("приехала в поселение");
    const adults = fam.members.map((id) => a.residents[id]).filter((r) => (a.gameMinutes - r.born) / YEAR_MIN >= 18);
    expect(adults).toHaveLength(2);
    expect(adults[0].spouse).toBe(adults[1].id);
  });
  it("goes into another vacant house when the promised one is gone, else into a tent", () => {
    const s = { ...settled([building(9, "izba", 900)]), attract: 0 };
    const due = (house: number) => [{ house, arrive: s.gameMinutes }];
    const { 5: _gone, ...without5 } = s.buildings;
    const other = immigrationStep({ ...s, buildings: without5, incoming: due(5) }, BASE_TICK);
    expect(Object.values(other.households).filter((h) => !h.founder).map((h) => h.home)).toEqual([9]);
    const { 9: _also, ...without9 } = without5;
    const tent = immigrationStep({ ...s, buildings: without9, incoming: due(5) }, BASE_TICK);
    expect(Object.values(tent.households).filter((h) => !h.founder).map((h) => h.home)).toEqual([null]);
    expect(tent.incoming).toEqual([]);
    // the tent family moves in through the daily step once a house stands
    const settledTent = day({ ...tent, buildings: s.buildings });
    expect(Object.values(settledTent.households).filter((h) => !h.founder).map((h) => h.home)).toEqual([5]);
  });
  it("does not take a house promised to another family", () => {
    const s = { ...settled([building(9, "izba", 900)]), attract: 0 };
    const a = immigrationStep({ ...s, incoming: [{ house: 5, arrive: s.gameMinutes - 1 }, { house: 9, arrive: s.gameMinutes + 600 }] }, BASE_TICK);
    expect(Object.values(a.households).find((h) => !h.founder)!.home).toBe(5);
    expect(a.incoming).toEqual([{ house: 9, arrive: s.gameMinutes + 600 }]);
  });
  it("arrivals always fit the house", () => {
    const s = custom(town([building(1, "izba", 100)]), []);
    for (let i = 1; i <= 40; i++) {
      const a = immigrationStep({ ...s, rng: i, attract: 0, incoming: [{ house: 1, arrive: s.gameMinutes }] }, BASE_TICK);
      for (const h of Object.values(a.households)) expect(h.members.length).toBeLessThanOrEqual(5);
      expect(Object.keys(a.households)).toHaveLength(1);
    }
  });
});

describe("births", () => {
  it("only married women with room, in housed households", () => {
    const s = day(town(houses(4)));
    const before = Object.keys(s.residents).length;
    const a = day(s, { rand: always, only: ["birth"] });
    expect(Object.keys(a.residents).length).toBe(before + 4);
    expect(kinds(a).filter((k) => k === "birth")).toHaveLength(4);
    const kid = Object.values(a.residents).find((r) => r.born === a.gameMinutes)!;
    expect(kid.last).toBe(surnameFor(a.households[kid.household].last, kid.sex));
    expect(a.households[kid.household].members).toContain(kid.id);
    // a full house stops births: an izba holds 5
    let c = a;
    for (let i = 0; i < 3; i++) c = day(c, { rand: always, only: ["birth"] });
    for (const h of Object.values(c.households)) expect(h.members).toHaveLength(5);
  });
  it("not in tents, not for unmarried women", () => {
    expect(Object.keys(day(town([]), { rand: always, only: ["birth"] }).residents)).toHaveLength(14);
    const s = day(town(houses(4)));
    const wife = Object.values(s.residents).find((r) => r.sex === "f" && r.spouse !== null && r.household === 1)!;
    const husband = s.residents[wife.spouse!];
    const widowed = { ...s, residents: { ...s.residents, [wife.id]: { ...wife, spouse: null }, [husband.id]: { ...husband, spouse: null } } };
    const a = day(widowed, { rand: always, only: ["birth"] });
    expect(a.households[1].members).toHaveLength(s.households[1].members.length);
    expect(a.households[2].members).toHaveLength(s.households[2].members.length + 1);
  });
});

describe("deaths", () => {
  it("remove people and free the house when a household empties", () => {
    const s = day(town(houses(4)));
    const h1 = s.households[1];
    let n = 0;
    // draws go in id order; household 1 holds ids 1..k
    const killHousehold1 = () => (n++ < h1.members.length ? 0 : 0.999999);
    const a = day(s, { rand: killHousehold1, only: ["death"] });
    expect(a.households[1]).toBeUndefined();
    expect(h1.members.every((id) => !a.residents[id])).toBe(true);
    expect(Object.keys(a.households)).toHaveLength(3);
    expect(vacantHouses(a.buildings, a.households)).toEqual([1]);
    expect(kinds(a).filter((k) => k === "death")).toHaveLength(h1.members.length);
  });
  it("a death widows the spouse", () => {
    const s = day(town(houses(4)));
    let n = 0;
    const a = day(s, { rand: () => (n++ === 0 ? 0 : 0.999999), only: ["death"] });
    const victim = s.residents[1];
    expect(a.residents[1]).toBeUndefined();
    expect(a.residents[victim.spouse!].spouse).toBeNull();
    expect(a.households[1].members).not.toContain(1);
    expect(a.events.at(-1)!.text).toMatch(/^Умер(ла)? /);
  });
  it("nobody dies on a failing draw", () => {
    expect(Object.keys(day(town([]), { rand: never, only: ["death"] }).residents)).toHaveLength(14);
  });
});

describe("marriage", () => {
  const pair = (bs: Building[]) =>
    custom(town(bs), [
      { home: null, people: [{ sex: "m", age: 25 }, { sex: "f", age: 45 }] },
      { home: null, people: [{ sex: "f", age: 24 }, { sex: "m", age: 50 }] },
    ]);
  it("a man and a woman from different households wed into a vacant house", () => {
    const a = day(pair([building(1, "izba", 100)]), { rand: always, only: ["marriage"] });
    const man = a.residents[1];
    const woman = a.residents[3];
    expect(man.spouse).toBe(3);
    expect(woman.spouse).toBe(1);
    expect(woman.household).toBe(man.household);
    const h = a.households[man.household];
    expect(h.home).toBe(1);
    expect([...h.members].sort()).toEqual([1, 3]);
    expect(kinds(a)).toContain("marriage");
    expect(woman.last).toBe(surnameFor(man.last, "f"));
    expect(a.households[1].members).toEqual([2]);
  });
  it("needs a vacant house", () => {
    const a = day(pair([]), { rand: always, only: ["marriage"] });
    expect(a.residents[1].spouse).toBeNull();
    expect(a.residents[3].spouse).toBeNull();
    expect(kinds(a)).not.toContain("marriage");
  });
  it("not when the draw fails or when they share a household", () => {
    expect(day(pair([building(1, "izba", 100)]), { rand: never, only: ["marriage"] }).residents[1].spouse).toBeNull();
    const together = custom(town([building(1, "izba", 100)]), [{ home: null, people: [{ sex: "m", age: 25 }, { sex: "f", age: 24 }] }]);
    expect(day(together, { rand: always, only: ["marriage"] }).residents[1].spouse).toBeNull();
  });
});

describe("jobs", () => {
  const adults = (n: number, home: number | null = 1): HSpec => ({ home, people: Array(n).fill({}) });

  it("assigns the nearest reachable workplace, then the next one when it is full", () => {
    const s = custom(town([building(1, "izba", 100), building(2, "smithy", 400), building(3, "smithy", 1000)]), [adults(4)]);
    const a = day(s);
    const rs = Object.values(a.residents);
    expect(rs.filter((r) => r.job === 2)).toHaveLength(3); // the smithy holds 3
    expect(rs.filter((r) => r.job === 3)).toHaveLength(1);
    const near = rs.find((r) => r.job === 2)!;
    const far = rs.find((r) => r.job === 3)!;
    expect(near.commute).toBeCloseTo((3 + 300 + 3) / WALK, 1);
    expect(far.commute).toBeCloseTo((3 + 900 + 3) / WALK, 1);
    const st = peopleStats(a);
    expect(st.employed).toBe(4);
    expect(st.avgCommute).toBeCloseTo((near.commute! * 3 + far.commute!) / 4, 5);
  });
  it("households in tents take no regular jobs (they build their homes); once housed they do", () => {
    const s = custom(town([building(1, "smithy", 200), building(2, "izba", 100)]), [adults(1, null), adults(1, 2)]);
    const r = day(s).residents;
    expect(r[1]).toMatchObject({ job: null, commute: null });
    expect(r[2].job).toBe(1);
    // a tent worker who had a job loses it
    const busy = custom(town([building(1, "smithy", 200)]), [{ home: null, people: [{ job: 1 }] }]);
    expect(day(busy).residents[1].job).toBeNull();
    expect(builderCount(day(busy))).toBe(1);
  });
  it("leaves people unemployed when the workplace is beyond 45 minutes", () => {
    const bs = () => [building(1, "izba", 100), building(2, "smithy", 3200)];
    expect(day(custom(town(bs()), [adults(1)])).residents[1].job).toBeNull();
    // and a worker whose workplace became unreachable loses the job
    const employed = custom(town(bs()), [{ home: 1, people: [{ job: 2 }] }]);
    expect(day(employed).residents[1]).toMatchObject({ job: null, commute: null });
  });
  it("leaves people unemployed when the road is not built", () => {
    const unbuilt = roadAlong(3000, 100);
    const a = day(custom(town([building(1, "izba", 100), building(2, "smithy", 400)], unbuilt), [adults(2)]));
    expect(Object.values(a.residents).every((r) => r.job === null)).toBe(true);
  });
  it("children and the old do not work; planned buildings give no jobs", () => {
    const s = custom(town([building(1, "izba", 100), building(2, "smithy", 400), building(3, "shop", 500, "planned")]), [
      { home: 1, people: [{ age: 10 }, { age: 70 }, { age: 30 }] },
    ]);
    const a = day(s);
    expect(a.residents[1].job).toBeNull();
    expect(a.residents[2].job).toBeNull();
    expect(a.residents[3].job).toBe(2);
  });
  it("jobs of a removed workplace are dropped", () => {
    const s = day(custom(town([building(1, "izba", 100), building(2, "smithy", 400)]), [adults(2)]));
    expect(Object.values(s.residents).every((r) => r.job === 2)).toBe(true);
    const { 2: _gone, ...rest } = s.buildings;
    const t = syncPeople({ ...s, buildings: rest });
    expect(Object.values(t.residents).every((r) => r.job === null && r.commute === null)).toBe(true);
    expect(syncPeople(t)).toBe(t);
    const u = day({ ...s, buildings: rest });
    expect(Object.values(u.residents).every((r) => r.job === null)).toBe(true);
  });
  it("idle days count up without work, not while construction is pending, and reset with a job", () => {
    const calm = custom(town([building(1, "izba", 100)]), [adults(1)]);
    expect(day(day(calm)).residents[1].idleDays).toBe(2);
    const busy = custom(town([building(1, "izba", 100), building(2, "izba", 200, "planned")]), [adults(1)]);
    expect(constructionWork(busy.buildings, busy.roads)).toBe(true);
    expect(day(day(busy)).residents[1].idleDays).toBe(0);
    const worked = custom(town([building(1, "izba", 100), building(2, "smithy", 300)]), [adults(1)]);
    const w2 = { ...worked, residents: { 1: { ...worked.residents[1], idleDays: 4 } } };
    expect(day(w2).residents[1]).toMatchObject({ job: 2, idleDays: 0 });
  });
});

describe("builders and unemployment", () => {
  it("jobless adults build while there is construction work, otherwise they are unemployed", () => {
    const planned = town([...houses(2), building(3, "izba", 300, "planned")]);
    expect(peopleStats(planned)).toMatchObject({ pop: 14, adults: 8, children: 6, builders: 8, unemployed: 0, tents: 4, households: 4 });
    expect(peopleStats(town(houses(2)))).toMatchObject({ builders: 0, unemployed: 8 });
  });
  it("demand counts vacancies, vacant and unfinished houses and tents", () => {
    const s = town([building(1, "izba", 100), building(2, "izba", 200), building(3, "smithy", 300)]);
    // 4 tents, 2 vacant houses, 3 open jobs: 1.5 + 3 / 2 - 2 + 4
    expect(demand(s).res).toBeCloseTo(5);
    const t = day(s);
    // two families moved in, two are still in tents, and the smithy has staff
    const employed = peopleStats(t).employed;
    expect(demand(t).res).toBeCloseTo(1.5 + (3 - employed) / 2 + 2);
  });
});

describe("emigration", () => {
  // n daily steps in a town of four houses and no work: every adult has n idle days
  const idle = (n: number) => {
    let s = town(houses(4));
    for (let i = 0; i < n; i++) s = day(s);
    return s;
  };
  it("idle families do not leave, however long they sit idle", () => {
    const s = idle(30);
    expect(Object.values(s.residents).filter((r) => r.idleDays >= 30).length).toBeGreaterThanOrEqual(8);
    expect(Object.keys(day(s, { rand: always, only: ["emigration"] }).households)).toHaveLength(4);
    // immigrants (not founders) with good mood stay as well
    const imm = custom(town(houses(2)), [{ home: 1, people: [{ age: 30 }, { age: 28 }] }]);
    let t = imm;
    for (let i = 0; i < 30; i++) t = day(t);
    expect(t.households[1].founder).toBe(false);
    expect(Object.keys(day(t, { rand: always, only: ["emigration"] }).households)).toHaveLength(1);
  });
  it("only low mood makes a family leave (10 % a day), vacating the house", () => {
    const base = custom(town(houses(2)), [{ home: 1, people: [{ age: 30 }, { age: 28 }] }, { home: 2, people: [{ age: 30 }] }]);
    const sad = { ...base, households: { 1: { ...base.households[1], mood: 20 }, 2: { ...base.households[2], mood: 60 } } };
    const a = day(sad, { rand: () => 0.05, only: ["emigration"] });
    expect(Object.keys(a.households)).toEqual(["2"]);
    expect(kinds(a).filter((k) => k === "departure")).toHaveLength(1);
    expect(a.events.at(-1)!.text).toContain("покинула поселение");
    expect(vacantHouses(a.buildings, a.households)).toEqual([1]);
    expect(Object.keys(day(sad, { rand: () => 0.15, only: ["emigration"] }).households)).toHaveLength(2);
    expect(RATES.moodLeaveDay).toBe(0.1);
  });
  it("founding households never emigrate, even unhappy", () => {
    const s = day(town(houses(4))); // the founders move in
    expect(Object.values(s.households).every((h) => h.founder && h.home !== null)).toBe(true);
    const sad = { ...s, households: Object.fromEntries(Object.values(s.households).map((h) => [h.id, { ...h, mood: 5 }])) };
    expect(Object.keys(day(sad, { rand: () => 0.01, only: ["emigration"] }).households)).toHaveLength(4);
  });
  it("founders in tents never leave", () => {
    let s = town([]);
    for (let i = 0; i < 8; i++) s = day(s);
    expect(Math.max(...Object.values(s.residents).map((r) => r.idleDays))).toBe(8);
    expect(Object.keys(day(s, { rand: always, only: ["emigration"] }).households)).toHaveLength(4);
  });
});

describe("determinism", () => {
  it("one advanceTo equals many random-sized calls, people included", () => {
    const g = road([[0, 0], [160, 0]]);
    const terrain: Record<string, TerrainInfo> = {};
    for (const c of regenerateCells(g, [], [], {})) terrain[qkey(c.cx, c.cy)] = { land: "meadow", slope: 0 };
    const cells = regenerateCells(g, [], [], terrain).map((c) =>
      c.block ? c : { ...c, zone: c.side === 1 ? (c.i < 10 ? ("res" as const) : ("craft" as const)) : ("trade" as const) },
    );
    const start: SimState = { realTime: NOW, gameMinutes: 0, roads: g, zones: { ...emptyZones(), cells, terrain, rev: 1 }, ...emptyGrowth(42) };
    const end = NOW + 40 * 24 * 60 * 1000; // 40 game days
    let t = NOW;
    let s = start;
    let seed = 3;
    while (t < end) {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      t += seed % 5000;
      s = advanceTo(s, t);
    }
    const once = advanceTo(start, t);
    expect(s).toEqual(once);
    expect(once.events.length).toBeGreaterThan(0);
    expect(once.events.length).toBeLessThanOrEqual(50);
    expect(Object.keys(once.buildings).length).toBeGreaterThan(0);
    expect(start.residents).toEqual(emptyGrowth(42).residents); // the input was not touched
  });
  it("the daily step runs when a tick crosses 00:00 and not otherwise", () => {
    const before = town([], roadAlong(), MIDNIGHT - 20);
    const mid = step(before);
    expect(mid.rng).toBe(before.rng);
    expect(mid.residents).toBe(before.residents);
    const after = step(mid); // 23:50 -> 00:00
    expect(after.rng).not.toBe(mid.rng); // deaths drew numbers
    expect(after.residents).not.toBe(mid.residents);
  });
});

describe("save", () => {
  const city: City = { name: "Череповец", lat: 59.12, lng: 37.9, foundedAt: NOW - 1000 };
  const wrap = (sim: Record<string, unknown>) => ({ version: 4, city, sim: { realTime: NOW, gameMinutes: 200, roads: emptyRoads(), ...sim } });

  it("the user's save without residents gets the founders", () => {
    const s = parseSave(wrap({ rng: 12345, buildings: {}, nextBuildingId: 1, lastSpawn: { res: -60, craft: -60, trade: -60 } }), NOW)!;
    expect(Object.keys(s.sim.residents)).toHaveLength(14);
    expect(Object.values(s.sim.households).every((h) => h.home === null)).toBe(true);
    const f = createFounders(12345, 200);
    expect(s.sim.residents).toEqual(f.people.residents);
    expect(s.sim.rng).toBe(f.rng);
    for (const a of ages(s.sim)) expect(a).toBeGreaterThanOrEqual(0);
  });
  it("round-trips people", () => {
    const sim = day(town(houses(4)));
    const raw = JSON.parse(JSON.stringify(sim));
    const s = parseSave({ version: 4, city, sim: { ...raw, roads: sim.roads, realTime: NOW } }, NOW)!;
    expect(s.sim.residents).toEqual(sim.residents);
    expect(s.sim.households).toEqual(sim.households);
    expect(s.sim.events).toEqual(sim.events);
    expect(s.sim.nextPersonId).toBe(sim.nextPersonId);
    expect(s.sim.nextHouseholdId).toBe(sim.nextHouseholdId);
  });
  it("a v3 save (360-day year) keeps every age, scales school days and keeps running", () => {
    const sim = day(town(houses(4)));
    const raw = JSON.parse(JSON.stringify(sim));
    const OLD_YEAR = 360 * 1440;
    const gm = 400 * 1440;
    const [a, b] = Object.keys(raw.residents);
    raw.residents[a] = { ...raw.residents[a], born: gm - 30 * OLD_YEAR, school: 0 };
    raw.residents[b] = { ...raw.residents[b], born: gm - 10 * OLD_YEAR, school: 360 };
    const v3 = { version: 3, city, sim: { ...raw, roads: sim.roads, realTime: NOW, gameMinutes: gm } };
    const s = parseSave(v3, NOW)!;
    expect(s.version).toBe(4);
    expect(s.sim.gameMinutes).toBe(gm);
    expect(ageOf(s.sim.residents[Number(a)].born, gm)).toBeCloseTo(30);
    expect(ageOf(s.sim.residents[Number(b)].born, gm)).toBeCloseTo(10);
    expect(s.sim.residents[Number(b)].school).toBe(Math.round(360 * YEAR_SCALE));
    const run = advanceTo(s.sim, NOW + 5 * 1440 * 1000);
    expect(run.gameMinutes).toBe(gm + 5 * 1440);
    expect(JSON.stringify(run)).not.toMatch(/NaN|null.*Infinity/);
    for (const r of Object.values(run.residents)) expect(Number.isFinite(r.born)).toBe(true);
    expect(Object.keys(run.residents).length).toBeGreaterThan(0);
  });
  it("a v4 save from before families on their way keeps its buildings and people", () => {
    const sim = day(town(houses(3)));
    const { incoming: _i, attract: _a, ...raw } = JSON.parse(JSON.stringify(sim));
    for (const b of Object.values(raw.buildings) as Record<string, unknown>[]) delete b.hand;
    const loaded = parseSave({ version: 4, city, sim: { ...raw, roads: sim.roads, realTime: NOW } }, NOW)!.sim;
    expect(Object.keys(loaded.buildings).sort()).toEqual(Object.keys(sim.buildings).sort());
    expect(Object.keys(loaded.residents).length).toBe(Object.keys(sim.residents).length);
    expect(loaded.incoming).toEqual([]);
  });
  it("loading a v3 save keeps the original copy once, then writes v4", async () => {
    const sim = day(town(houses(4)));
    const v3 = { version: 3, city, sim: { ...JSON.parse(JSON.stringify(sim)), roads: sim.roads, realTime: NOW } };
    let current: unknown = v3;
    const kept: [unknown, number][] = [];
    const storage: Storage = {
      get: async () => current,
      put: async (s) => void (current = s),
      clear: async () => void (current = null),
      keepOld: async (raw, version) => void kept.push([raw, version]),
    };
    const h = new Handler(storage, () => {});
    await h.handle({ t: "load", legacy: null, now: NOW });
    expect(kept).toEqual([[v3, 3]]);
    expect((current as { version: number }).version).toBe(4);
    await h.handle({ t: "load", legacy: null, now: NOW });
    expect(kept.length).toBe(1); // a v4 save is not kept again
  });
  it("broken people data resets to founders, the town survives", () => {
    const sim = day(town(houses(4)));
    const raw = JSON.parse(JSON.stringify(sim));
    const keep = { ...raw, roads: sim.roads, realTime: NOW };
    const bad: Record<string, unknown>[] = [
      { ...keep, residents: [] },
      { ...keep, residents: { ...keep.residents, 1: { ...keep.residents[1], sex: "x" } } },
      { ...keep, residents: { ...keep.residents, 1: { ...keep.residents[1], household: 99 } } },
      { ...keep, residents: { ...keep.residents, 1: { ...keep.residents[1], spouse: 9 } } },
      { ...keep, residents: { ...keep.residents, 1: { ...keep.residents[1], born: "old" } } },
      { ...keep, households: { ...keep.households, 1: { ...keep.households[1], members: [1, 77] } } },
      { ...keep, households: { ...keep.households, 1: { ...keep.households[1], members: [] } } },
      { ...keep, nextPersonId: 2 },
      { ...keep, households: "x" },
    ];
    for (const b of bad) {
      const s = parseSave({ version: 4, city, sim: b }, NOW)!;
      expect(s).not.toBeNull();
      const hs = Object.values(s.sim.households);
      expect(Object.keys(s.sim.residents)).toHaveLength(14);
      expect(hs).toHaveLength(4);
      expect(hs.every((h) => h.home === null)).toBe(true);
      expect(s.sim.roads).toEqual(sim.roads);
      expect(Object.keys(s.sim.buildings)).toHaveLength(4); // buildings are untouched
    }
  });
  it("repairs references to missing buildings", () => {
    const sim = day(custom(town([building(1, "izba", 100), building(2, "smithy", 400)]), [{ home: 1, people: [{}, {}] }]));
    expect(Object.values(sim.residents).every((r) => r.job === 2)).toBe(true);
    const raw = JSON.parse(JSON.stringify(sim));
    const s = parseSave({ version: 4, city, sim: { ...raw, roads: sim.roads, realTime: NOW, buildings: {}, nextBuildingId: 3 } }, NOW)!;
    expect(Object.keys(s.sim.residents)).toHaveLength(2);
    expect(s.sim.households[1].home).toBeNull();
    expect(Object.values(s.sim.residents).every((r) => r.job === null && r.commute === null)).toBe(true);
  });
});

describe("query", () => {
  const base = () => {
    const s = custom(town([building(1, "izba", 100), building(2, "smithy", 400), building(3, "izba", 500, "planned")]), [
      { home: 1, people: [{ sex: "m", age: 30 }, { sex: "f", age: 28 }, { sex: "m", age: 5 }, { sex: "m", age: 70 }, { sex: "f", age: 65 }] },
    ]);
    // logs in the stock: the smithy is not blocked by missing inputs, its smith is at work
    return { ...s, stock: { ...s.stock, logs: 5 }, residents: { ...s.residents, 1: { ...s.residents[1], job: 2, commute: 4.6 } } };
  };
  it("lists a household and the occupation of each member", () => {
    const s = base();
    const q = queryBuilding(s, 1)!;
    expect(q.kind).toBe("house");
    if (q.kind !== "house") return;
    expect(q.households).toHaveLength(1);
    expect(q.households[0].people.map((p) => p.role)).toEqual(["кузнец — Кузница", "на стройке", "ребёнок", "старик", "старуха"]);
    expect(q.households[0].people[0]).toMatchObject({ name: "Иван Тестов", age: 30, sex: "m" });
    const { 3: _planned, ...finished } = s.buildings;
    const calm = queryBuilding({ ...s, buildings: finished }, 1)!;
    if (calm.kind === "house") expect(calm.households[0].people[1].role).toBe("без работы");
  });
  it("lists the workers of a workplace with their commute", () => {
    expect(queryBuilding(base(), 2)).toEqual({ kind: "workplace", capacity: 3, workers: [{ id: 1, name: "Иван Тестов", age: 30, commute: 4.6, idle: false }] });
    expect(queryBuilding(town([building(1, "shop", 100)]), 1)).toMatchObject({ kind: "workplace", capacity: 2, workers: [] });
  });
  it("an empty house and a missing building", () => {
    expect(queryBuilding(town(houses(1)), 1)).toEqual({ kind: "house", households: [], level: 1, landValue: 0, services: [], upgrading: false });
    expect(queryBuilding(town([]), 5)).toBeNull();
  });
});

describe("handler: persistence and query channel", () => {
  const city: City = { name: "Череповец", lat: 59.12, lng: 37.9, foundedAt: NOW - 1000 };
  function setup(initial?: unknown) {
    let stored: unknown = initial;
    let puts = 0;
    const storage: Storage = {
      get: async () => stored,
      put: async (s) => {
        stored = s;
        puts++;
      },
      clear: async () => {
        stored = undefined;
      },
    };
    const out: FromWorker[] = [];
    const h = new Handler(storage, (m) => out.push(m));
    return { h, out, puts: () => puts, get: () => stored as SaveV4 };
  }

  it("saves every 10 wall seconds while ticking, not every tick", async () => {
    const { h, puts } = setup();
    await h.handle({ t: "found", city, now: NOW });
    const before = puts();
    for (let k = 1; k <= 40; k++) h.tick(NOW + k * 2500); // 100 s, one tick per call
    expect(puts() - before).toBe(10);
    await h.handle({ t: "flush" });
    expect(puts() - before).toBe(11);
  });
  it("sends aggregates, not residents, in `loaded`", async () => {
    const { h, out } = setup();
    await h.handle({ t: "found", city, now: NOW });
    const m = out[0] as Extract<FromWorker, { t: "loaded" }>;
    expect(m.save?.sim.people).toMatchObject({ pop: 14, households: 4, tents: 4, adults: 8, children: 6 });
    expect(m.save?.sim).not.toHaveProperty("residents");
  });
  it("answers building queries", async () => {
    const g = roadAlong(160);
    const terrain: Record<string, TerrainInfo> = {};
    for (const c of regenerateCells(g, [], [], {})) terrain[qkey(c.cx, c.cy)] = { land: "meadow", slope: 0 };
    const cells = regenerateCells(g, [], [], terrain).map((c) => (c.block ? c : { ...c, zone: "res" as const }));
    let s: SimState = { realTime: NOW, gameMinutes: 0, roads: g, zones: { ...emptyZones(), cells, terrain, rev: 1 }, ...emptyGrowth(seedOf(city.foundedAt)) };
    s = step(s); // spawns a house
    const b = Object.values(s.buildings)[0];
    expect(b).toBeDefined();
    s = { ...s, buildings: { [b.id]: { ...b, state: "active", done: b.labor } } };
    s = { ...s, households: { ...s.households, 1: { ...s.households[1], home: b.id } } };
    const { h, out } = setup({ version: 4, city, sim: s });
    await h.handle({ t: "load", legacy: null, now: NOW });
    out.length = 0;
    await h.handle({ t: "query", id: 5, q: { type: "building", id: b.id } });
    const hit = out[0] as Extract<FromWorker, { t: "queryResult" }>;
    expect(hit.t).toBe("queryResult");
    expect(hit.id).toBe(5);
    expect(hit.data?.kind).toBe("house");
    if (hit.data?.kind === "house") expect(hit.data.households[0].people).toHaveLength(s.households[1].members.length);
    await h.handle({ t: "query", id: 6, q: { type: "building", id: 999 } });
    expect(out[1]).toEqual({ t: "queryResult", id: 6, data: null });
  });
});
