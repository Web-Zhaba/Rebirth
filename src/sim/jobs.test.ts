import { describe, expect, it } from "vitest";
import { BUILDINGS, JOB_GROUPS, JOB_KEYS } from "./buildings";
import { emptyGrowth } from "./growth";
import { capacityOf, groupOf } from "./jobs";
import { emptyLevers } from "./levers";
import { setJobPriority, setStaff } from "./leverCmds";
import { builderCount, dailyStep, peopleStats, productionScales, rebalanceJobs, WALK_SPEED } from "./people";
import { jobReport } from "./jobReport";
import { addRoad, emptyRoads } from "./roads";
import { parseSave } from "./save";
import { YEAR_MIN } from "./time";
import type { Building, City, Household, Resident, RoadGraph, SimState } from "./types";
import { emptyZones } from "./zones";

const NOW = 1_800_000_000_000;
const MIDNIGHT = 1080;

const roadAlong = (len = 3000): RoadGraph => {
  const pts = Array.from({ length: Math.floor(len / 100) + 1 }, (_, i): [number, number] => [i * 100, 0]);
  const r = addRoad(emptyRoads(), pts, "dirt", 1, pts.slice(1).map(() => 0));
  if (!r.ok) throw new Error(r.reason);
  return r.graph;
};

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

function town(bs: Building[]): SimState {
  const buildings: Record<number, Building> = {};
  for (const b of bs) buildings[b.id] = b;
  return { realTime: NOW, gameMinutes: MIDNIGHT, roads: roadAlong(), zones: emptyZones(), ...emptyGrowth(7, MIDNIGHT), buildings, nextBuildingId: bs.length + 1 };
}

// One household in house 1 with `n` adults; `jobs[i]` is the job of the i-th one.
function people(s: SimState, n: number, jobs: (number | undefined)[] = []): SimState {
  const residents: Record<number, Resident> = {};
  const members: number[] = [];
  for (let i = 0; i < n; i++) {
    const id = i + 1;
    members.push(id);
    const job = jobs[i];
    residents[id] = { id, first: "Иван", last: "Тестов", sex: "m", born: s.gameMinutes - 30 * YEAR_MIN, household: 1, spouse: null, job: job ?? null, commute: job === undefined ? null : 5, idleDays: 0, literate: false, school: 0 };
  }
  const households: Record<number, Household> = { 1: { id: 1, last: "Тестов", home: 1, members, arrived: 0, founder: false, mood: 60 } };
  return { ...s, residents, households, nextPersonId: n + 1, nextHouseholdId: 2, events: [] };
}

type JobPriorities = SimState["levers"]["jobs"];
const day = (s: SimState) => dailyStep(s, { only: [] });
const withJobs = (s: SimState, jobs: Partial<JobPriorities>): SimState => ({ ...s, levers: { ...s.levers, jobs: { ...s.levers.jobs, ...jobs } } });
const at = (s: SimState, id: number) => Object.values(s.residents).filter((r) => r.job === id).length;
const must = (r: { ok: boolean } & Partial<{ sim: SimState }>): SimState => {
  if (!r.ok || !r.sim) throw new Error("expected ok");
  return r.sim;
};

describe("job groups", () => {
  it("every template declares a group; houses none, workplaces one of the groups", () => {
    for (const t of Object.values(BUILDINGS)) {
      if (t.zone === "res") expect(t.group, t.id).toBeNull();
      else expect(JOB_GROUPS as readonly (string | null)[], t.id).toContain(t.group);
    }
  });
  it("groups the way the design says", () => {
    expect(["gumno", "fisher"].map((k) => BUILDINGS[k].group)).toEqual(["food", "food"]);
    expect(["woodcutter", "sawpit", "quarry"].map((k) => BUILDINGS[k].group)).toEqual(["materials", "materials", "materials"]);
    expect(["smithy", "carpentry", "pottery"].map((k) => BUILDINGS[k].group)).toEqual(["crafts", "crafts", "crafts"]);
    expect(["shop", "tavern", "market"].map((k) => BUILDINGS[k].group)).toEqual(["trade", "trade", "trade"]);
    expect(["well", "chapel", "school", "healer", "dig", "barn"].map((k) => BUILDINGS[k].group)).toEqual(Array(6).fill("services"));
  });
  it("levers start at normal priority for every key", () => {
    expect(emptyLevers().jobs).toEqual(Object.fromEntries(JOB_KEYS.map((k) => [k, 2])));
  });
});

describe("capacity", () => {
  const s = town([building(1, "izba", 100), building(2, "smithy", 400)]);
  it("is the jobs, cut by the staff limit, and zero at priority none", () => {
    const b = s.buildings[2];
    expect(groupOf(b)).toBe("crafts");
    expect(capacityOf(b, s)).toBe(3);
    expect(capacityOf({ ...b, staff: 1 }, s)).toBe(1);
    expect(capacityOf({ ...b, staff: 0 }, s)).toBe(0);
    expect(capacityOf({ ...b, staff: 9 }, s)).toBe(3);
    expect(capacityOf(b, withJobs(s, { crafts: 0 }))).toBe(0);
    expect(capacityOf(b, withJobs(s, { crafts: 1 }))).toBe(3);
  });
});

describe("assignment", () => {
  // Craft work near the house, wood work farther away.
  const base = () => people(town([building(1, "izba", 100), building(2, "smithy", 400), building(3, "woodcutter", 1000)]), 4);

  it("at normal priority takes the nearest vacancy", () => {
    const a = day(base());
    expect(at(a, 2)).toBe(3);
    expect(at(a, 3)).toBe(1);
  });
  it("a house mid-road walks from its own place on the road: 110 m to the work is 1.7 min, not 4.4", () => {
    const s = people(town([building(1, "izba", 50), building(2, "smithy", 160)]), 1, [2]);
    const r = day(s).residents[1];
    expect(r.job).toBe(2);
    expect(r.commute).toBeCloseTo(116 / WALK_SPEED, 1); // 110 m along the road and 3 m off it at each end
  });
  it("takes the highest priority first, then the nearest", () => {
    const a = day(withJobs(base(), { materials: 3 }));
    expect(at(a, 3)).toBe(2); // the woodcutter holds 2
    expect(at(a, 2)).toBe(2);
    const b = day(withJobs(base(), { materials: 1 }));
    expect(at(b, 2)).toBe(3);
  });
  it("priority none closes the group", () => {
    const a = day(withJobs(base(), { crafts: 0 }));
    expect(at(a, 2)).toBe(0);
    expect(at(a, 3)).toBe(2);
    expect(peopleStats(a).employed).toBe(2);
  });
  it("rebalances toward a higher priority at once, from a command", () => {
    const a = day(base());
    expect(at(a, 2)).toBe(3);
    const b = must(setJobPriority(a, "materials", 3));
    expect(at(b, 3)).toBe(2);
    expect(at(b, 2)).toBe(2);
    expect(peopleStats(b).employed).toBe(4);
    // nobody moves down while their job is fine
    const c = must(setJobPriority(b, "materials", 2));
    expect(at(c, 3)).toBe(2);
  });
  it("releases the farthest workers above a lowered capacity", () => {
    const a = day(base());
    const far = Object.values(a.residents).find((r) => r.job === 3)!;
    const b = must(setStaff(a, 2, 1));
    expect(at(b, 2)).toBe(1);
    expect(b.residents[far.id].job).toBe(3); // still at the woodcutter, which has a free place
    const c = must(setStaff(a, 3, 0));
    expect(at(c, 3)).toBe(0);
    expect(c.residents[far.id].job).toBeNull();
  });
  it("is deterministic and leaves the input alone", () => {
    const a = withJobs(base(), { materials: 3 });
    const snap = JSON.stringify(a);
    expect(JSON.stringify(rebalanceJobs(a))).toBe(JSON.stringify(rebalanceJobs(a)));
    expect(JSON.stringify(day(a))).toBe(JSON.stringify(day(a)));
    expect(JSON.stringify(a)).toBe(snap);
  });
});

describe("builders", () => {
  // 20 adults, 17 jobs in crafts and trade, a house under construction: 3 jobless.
  const mk = (jobs: Partial<JobPriorities> = {}): SimState => {
    const bs = [building(1, "izba", 100), building(2, "smithy", 200), building(3, "carpentry", 300), building(4, "pottery", 400), building(5, "shop", 500), building(6, "tavern", 600), building(7, "izba", 700, "planned")];
    const slots = [2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 5, 5, 6, 6, 6, 6, 6];
    return withJobs(people(town(bs), 20, slots), jobs);
  };

  it("the floor follows the construction priority", () => {
    expect(builderCount(mk())).toBe(4); // 3 jobless, floor ceil(20 %) = 4
    expect(builderCount(mk({ build: 3 }))).toBe(8); // 40 %
    expect(builderCount(mk({ build: 1 }))).toBe(3); // 10 % is 2, the minimum is 3
    expect(builderCount(mk({ build: 0 }))).toBe(3); // only the jobless
    expect(peopleStats(mk({ build: 3 })).builders).toBe(8);
  });
  it("nothing is drafted without construction work", () => {
    const s = mk({ build: 3 });
    const done = { ...s, buildings: { ...s.buildings, 7: building(7, "izba", 700) } };
    expect(builderCount(done)).toBe(3);
    expect(productionScales(done)).toEqual([1, 1, 1, 1]);
  });
  it("drafts from the lowest priority groups first", () => {
    const s = mk({ build: 3, crafts: 1, trade: 3 }); // 5 drafted: the 10 craft workers lose them
    const sc = productionScales(s);
    expect(sc[3]).toBe(1);
    expect(sc[1]).toBeCloseTo(1 - 5 / 10, 9);
    expect(sc[2]).toBe(1);
    // protect crafts instead: trade (7 workers) is drafted, 5 of 7
    const t = productionScales(mk({ build: 3, crafts: 3, trade: 1 }));
    expect(t[3]).toBe(1);
    expect(t[1]).toBeCloseTo(1 - 5 / 7, 9);
    // more drafted than the lowest tier holds: the next tier pays the rest (trade 7 low, crafts 10 normal; draft 5 only trade)
    const u = productionScales(mk({ build: 3, trade: 1 }));
    expect(u[1]).toBeCloseTo(1 - 5 / 7, 9);
    expect(u[2]).toBe(1);
  });
  it("общий сбор still stops all production", () => {
    const s = mk();
    const t = { ...s, levers: { ...s.levers, toloka: { site: 7, until: s.gameMinutes + 600 } } };
    expect(productionScales(t)).toEqual([0, 0, 0, 0]);
    expect(builderCount(t)).toBe(20);
  });
});

describe("commands", () => {
  const s = day(people(town([building(1, "izba", 100), building(2, "smithy", 400)]), 3));
  it("setJobPriority validates", () => {
    expect(setJobPriority(s, "nope" as never, 1).ok).toBe(false);
    expect(setJobPriority(s, "food", 4 as never).ok).toBe(false);
    expect(setJobPriority(s, "food", 1.5 as never).ok).toBe(false);
    expect(setJobPriority(s, "food", -1 as never).ok).toBe(false);
    expect(must(setJobPriority(s, "food", 2))).toBe(s);
    expect(must(setJobPriority(s, "build", 3)).levers.jobs.build).toBe(3);
  });
  it("setStaff validates, and full staff clears the limit", () => {
    expect(setStaff(s, 99, 1).ok).toBe(false); // no such building
    expect(setStaff(s, 1, 0).ok).toBe(false); // a house
    expect(setStaff(s, 2, -1).ok).toBe(false);
    expect(setStaff(s, 2, 1.5).ok).toBe(false);
    expect(setStaff(s, 2, 4).ok).toBe(false); // the smithy has 3 jobs
    const one = must(setStaff(s, 2, 1));
    expect(one.buildings[2].staff).toBe(1);
    expect(at(one, 2)).toBe(1);
    const full = must(setStaff(one, 2, 3));
    expect(full.buildings[2].staff).toBeUndefined();
    expect(at(full, 2)).toBe(3);
    const unfinished = { ...s, buildings: { ...s.buildings, 2: building(2, "smithy", 400, "building") } };
    expect(setStaff(unfinished, 2, 1).ok).toBe(false);
  });
});

describe("report", () => {
  it("counts places, workers and what closes them", () => {
    let s = day(people(town([building(1, "izba", 100), building(2, "smithy", 400), building(3, "woodcutter", 700)]), 4));
    s = must(setStaff(s, 3, 1));
    s = must(setJobPriority(s, "crafts", 1));
    const r = jobReport(s);
    const crafts = r.groups.find((g) => g.key === "crafts")!;
    const mat = r.groups.find((g) => g.key === "materials")!;
    expect(crafts).toMatchObject({ places: 3, closedByPriority: 0 });
    expect(mat).toMatchObject({ places: 1, closedByStaff: 1 });
    expect(r.adults).toBe(4);
    const closed = jobReport(must(setJobPriority(s, "crafts", 0)));
    expect(closed.groups.find((g) => g.key === "crafts")).toMatchObject({ places: 0, workers: 0, closedByPriority: 3 });
    expect(closed.jobless).toBeGreaterThanOrEqual(3);
  });
});

describe("save", () => {
  const city: City = { name: "Череповец", lat: 59.12, lng: 37.9, foundedAt: NOW - 1000 };
  const load = (sim: SimState, patch: (raw: Record<string, unknown>) => void = () => {}) => {
    const raw = JSON.parse(JSON.stringify(sim)) as Record<string, unknown>;
    patch(raw);
    return parseSave({ version: 4, city, sim: { ...raw, roads: sim.roads, realTime: NOW } }, NOW)!.sim;
  };
  it("round-trips priorities and staff", () => {
    let s = day(people(town([building(1, "izba", 100), building(2, "smithy", 400)]), 3));
    s = must(setStaff(s, 2, 2));
    s = must(setJobPriority(s, "services", 0));
    s = must(setJobPriority(s, "build", 3));
    const l = load(s);
    expect(l.levers.jobs).toEqual(s.levers.jobs);
    expect(l.buildings[2].staff).toBe(2);
    expect(l.residents).toEqual(s.residents);
  });
  it("old saves load with normal priorities and no limits; junk falls back", () => {
    const s = day(people(town([building(1, "izba", 100), building(2, "smithy", 400)]), 3));
    const old = load(s, (raw) => {
      delete (raw.levers as Record<string, unknown>).jobs;
    });
    expect(old.levers.jobs).toEqual(emptyLevers().jobs);
    expect(old.buildings[2].staff).toBeUndefined();
    const junk = load(s, (raw) => {
      (raw.levers as Record<string, unknown>).jobs = { food: 7, crafts: "x", trade: 0, nope: 3 };
      (raw.buildings as Record<string, Record<string, unknown>>)[2].staff = -3;
    });
    expect(junk.levers.jobs).toEqual({ ...emptyLevers().jobs, trade: 0 });
    expect(junk.buildings[2].staff).toBeUndefined();
  });
});
