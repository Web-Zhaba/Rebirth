import { describe, expect, it } from "vitest";
import { queuedLabel, step } from "./clock";
import { BUILDINGS } from "./buildings";
import { refreshServices } from "./coverage";
import { EVENING, eveningRate, eveningStep, gatherHouses } from "./evening";
import { toSnapshot } from "./handler";
import { emptyGrowth } from "./growth";
import { computeLife } from "./life";
import { lightOpacity } from "../map/lifeLayer";
import { dailyEconomy } from "./production";
import { addRoad, emptyRoads } from "./roads";
import { parseSave } from "./save";
import { daySummary, summaryShown } from "./summary";
import { YEAR_DAYS, YEAR_MIN } from "./time";
import type { Building, DaySummary, Household, Resident, RoadGraph, SimState } from "./types";
import { emptyZones } from "./zones";

const NOW = 1_800_000_000_000;
const at = (day: number, hour = 0, minute = 0) => (day - 1) * 1440 + hour * 60 + minute - 360;
const SUMMER = 3; // day of the year
const WINTER = 3 * 8 + 2;

const roadAlong = (len = 2000): RoadGraph => {
  const pts = Array.from({ length: Math.floor(len / 100) + 1 }, (_, i): [number, number] => [i * 100, 0]);
  const r = addRoad(emptyRoads(), pts, "dirt", 1, pts.slice(1).map(() => 0));
  if (!r.ok) throw new Error(r.reason);
  return r.graph;
};

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

function town(bs: Building[], gm: number, roads: RoadGraph = roadAlong()): SimState {
  const buildings: Record<number, Building> = {};
  for (const b of bs) buildings[b.id] = b;
  return { realTime: NOW, gameMinutes: gm, roads, zones: emptyZones(), ...emptyGrowth(7, gm), stock: { food: 1750, logs: 0, planks: 0, stone: 0, wares: 20 }, buildings, nextBuildingId: bs.length + 1 };
}

interface HSpec {
  home: number | null;
  adults?: number;
  kids?: number;
  job?: number; // workplace of the first adult
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
      residents[id] = { id, first: "Иван", last: "Тестов", sex: "m", born: s.gameMinutes - age * YEAR_MIN, household: hid, spouse: null, job, commute: job === null ? null : 5, idleDays: 0, literate: false, school: 0 };
      members.push(id);
    };
    for (let k = 0; k < (sp.adults ?? 1); k++) add(30, k === 0 ? (sp.job ?? null) : null);
    for (let k = 0; k < (sp.kids ?? 0); k++) add(5, null);
    households[hid] = { id: hid, last: "Тестов", home: sp.home, members, arrived: 0, founder: false, mood: sp.mood ?? 60 };
  });
  return { ...s, residents, households, nextPersonId: pid, nextHouseholdId: specs.length + 1, events: [] };
}

// An unfinished house far away: construction work exists, so jobless adults are builders, not idle.
const busy = (s: SimState): SimState => ({ ...s, buildings: { ...s.buildings, 900: bld(900, "izba", 1900, "planned") } });

const evening = (day = SUMMER, hour = 19, minute = 0) => at(day, hour, minute);
// Two houses: 3 adults and 2 kids at home, 1 adult in a tent.
const homes = (gm: number) =>
  folk(busy(town([bld(1, "izba", 100), bld(2, "izba", 300)], gm)), [{ home: 1, adults: 2, kids: 2 }, { home: 2, adults: 1 }, { home: null, adults: 1 }]);

describe("evening home crafts", () => {
  it("adults at home make 0.01 pcs an hour each", () => {
    const s = homes(evening());
    expect(eveningRate(s)).toBeCloseTo(0.03);
    expect(eveningStep(s, 1).stock.wares).toBeCloseTo(20.03);
    expect(toSnapshot(s).economy.eveningWares).toBeCloseTo(0.03);
  });
  it("doubles in winter", () => {
    const s = homes(evening(WINTER));
    expect(eveningRate(s)).toBeCloseTo(0.06);
    expect(eveningStep(s, 1).stock.wares).toBeCloseTo(20.06);
  });
  it("counts only adults: children, the old and tent dwellers do not", () => {
    let s = homes(evening());
    s = { ...s, residents: { ...s.residents, 1: { ...s.residents[1], born: s.gameMinutes - 70 * YEAR_MIN } } };
    expect(eveningRate(s)).toBeCloseTo(0.02);
    expect(eveningRate(folk(town([], evening()), [{ home: null, adults: 3 }]))).toBe(0);
  });
  it("the step makes wares only from 19:00 to 22:00", () => {
    const wares = (gm: number) => step(homes(gm)).stock.wares;
    expect(wares(evening(SUMMER, 19))).toBeCloseTo(20 + 0.03 / 6);
    expect(wares(evening(SUMMER, 21, 50)) - 20).toBeCloseTo(0.03 / 6 - 0, 5);
    for (const [h, m] of [[18, 50], [22, 0], [23, 0], [3, 0], [6, 50]]) expect(wares(evening(SUMMER, h, m)), `${h}:${m}`).toBe(20);
  });
  it("the evening wares count in the day's output", () => {
    const s = eveningStep(homes(evening()), 10);
    expect(daySummary(s).lines.find((l) => l.kind === "made")?.text).toContain("товаров");
  });
});

describe("gatherings", () => {
  // The tavern at x=100 with a worker; houses at x=300 (in reach) and x=1800 (out of reach).
  const gather = () =>
    refreshServices(
      busy(
        folk(town([bld(1, "tavern", 100), bld(2, "izba", 300), bld(3, "izba", 1800), bld(4, "izba", 200)], at(13, 12)), [{ home: 4, job: 1 }, { home: 2 }, { home: 3 }]),
      ),
    );
  it("finds the houses in reach of a staffed tavern", () => {
    const g = gatherHouses(gather());
    expect(g.has(2)).toBe(true);
    expect(g.has(3)).toBe(false);
  });
  it("an unstaffed tavern gathers nobody", () => {
    const s = gather();
    expect(gatherHouses({ ...s, residents: { ...s.residents, 1: { ...s.residents[1], job: null } } }).size).toBe(0);
  });
  it("covered households gain a bounded mood term, the others do not", () => {
    const d = dailyEconomy(gather());
    const base = d.households[3].mood; // out of reach
    expect(d.households[2].mood - base).toBeCloseTo(EVENING.gatherMood * 0.25);
    expect(d.households[2].mood).toBeLessThan(100);
    // the term moves the target, not the mood: it fades when the tavern is gone
    const gone = dailyEconomy({ ...gather(), buildings: { ...gather().buildings, 1: bld(1, "tavern", 100, "planned") } });
    expect(gone.households[2].mood).toBeCloseTo(gone.households[3].mood);
  });
  it("a chapel covering the house counts too", () => {
    const s = gather();
    const chapel = refreshServices({ ...s, buildings: { ...s.buildings, 5: bld(5, "chapel", 500) }, residents: { ...s.residents, 99: { ...s.residents[1], id: 99, job: 5 } } });
    expect(gatherHouses({ ...chapel, buildings: { ...chapel.buildings, 1: bld(1, "tavern", 100, "planned") } }).has(2)).toBe(true);
  });
});

describe("day summary", () => {
  const day = (gm = evening(SUMMER, 21, 50)) => {
    let s = homes(gm);
    const from = at(SUMMER, 0);
    s = {
      ...s,
      prod: { ...s.prod, today: { 0: 2 } },
      events: [
        { at: from - 100, kind: "built", text: "Вчера построено", pos: [1, 1] },
        { at: from + 500, kind: "built", text: "Построено: Изба", pos: [100, 5] },
        { at: from + 600, kind: "arrival", text: "Семья приехала", pos: [9, 9] },
        { at: from + 700, kind: "birth", text: "Родился Иван" },
        { at: from + 800, kind: "shortage", text: "Не хватает брёвен: часть работы делают вручную", pos: [50, 5] },
      ],
    };
    return s;
  };
  it("is assembled when the clock reaches 22:00, from today's events and output", () => {
    const before = day();
    expect(before.summary).toBeNull();
    const s = step(before);
    expect(s.summary).not.toBeNull();
    expect(s.summary!.at).toBe(at(SUMMER, 22));
    const by = (k: string) => s.summary!.lines.filter((l) => l.kind === k);
    expect(by("built")).toEqual([{ kind: "built", text: "Построено: Изба", pos: [100, 5] }]);
    expect(by("arrived")[0]).toMatchObject({ pos: [9, 9] });
    expect(by("born")[0].text).toBe("Родилось: 1");
    expect(by("made")[0].text).toContain("товаров");
    expect(by("problem")[0]).toMatchObject({ pos: [50, 5] });
    expect(s.summary!.lines.some((l) => l.text.includes("Вчера"))).toBe(false);
  });
  it("reports idle hands and famine as problems", () => {
    const s0 = day();
    const idle = { ...s0, buildings: { ...s0.buildings } };
    delete idle.buildings[900];
    const s = daySummary({ ...idle, prod: { ...idle.prod, flags: { ...idle.prod.flags, hungry: true } } });
    const problems = s.lines.filter((l) => l.kind === "problem").map((l) => l.text);
    expect(problems).toContain("Люди голодают");
    expect(problems.some((t) => t.startsWith("Без дела"))).toBe(true);
  });
  it("is made only at 22:00 and replaced by the next one", () => {
    expect(step({ ...day(), gameMinutes: at(SUMMER, 21, 40) }).summary).toBeNull();
    const first = step(day()).summary!;
    // a quiet day later: nothing of the first one is left
    const next = step({ ...folk(town([], at(SUMMER + 1, 21, 50)), [{ home: null }]), summary: first }).summary!;
    expect(next.at).toBe(at(SUMMER + 1, 22));
    expect(next.lines.some((l) => l.kind === "built")).toBe(false);
    // the day's output starts over at 00:00
    const mid = dailyEconomy({ ...eveningStep(homes(evening()), 10), gameMinutes: at(SUMMER + 1, 0) });
    expect(daySummary(mid).lines.some((l) => l.kind === "made")).toBe(false);
  });
  it("shows from 22:00 to 07:00", () => {
    const sum: DaySummary = { at: at(SUMMER, 22), lines: [] };
    expect(summaryShown(sum, at(SUMMER, 21, 59))).toBe(false);
    expect(summaryShown(sum, at(SUMMER, 22))).toBe(true);
    expect(summaryShown(sum, at(SUMMER + 1, 6, 59))).toBe(true);
    expect(summaryShown(sum, at(SUMMER + 1, 7))).toBe(false);
    expect(summaryShown(null, at(SUMMER, 23))).toBe(false);
  });
  it("travels in the snapshot", () => {
    expect(toSnapshot(step(day())).summary?.at).toBe(at(SUMMER, 22));
  });
});

describe("lights and walkers", () => {
  const s0 = () =>
    busy(folk(town([bld(1, "tavern", 100), bld(2, "izba", 300), bld(3, "izba", 400), bld(4, "carpentry", 600), bld(5, "izba", 200)], at(13, 12)), [{ home: 5, job: 1 }, { home: 2, job: 4 }]));
  it("occupied houses glow, vacant ones stay dark", () => {
    const l = computeLife(s0()).lights.filter((x) => x.kind === "house");
    expect(l).toHaveLength(2);
  });
  it("a workshop without inputs shows no light; with planks it does", () => {
    const kinds = (planks: number) => computeLife({ ...s0(), stock: { ...s0().stock, planks } }).lights.filter((x) => x.kind === "work").length;
    expect(kinds(0)).toBe(0);
    expect(kinds(5)).toBe(1);
  });
  it("the staffed tavern glows and draws evening walkers", () => {
    const life = computeLife(s0());
    expect(life.lights.filter((x) => x.kind === "tavern")).toHaveLength(1);
    const guests = life.trips.filter((t) => t.depart >= 19 * 60 && t.depart < 22 * 60);
    expect(guests.length).toBeGreaterThan(0);
    expect(lightOpacity("tavern", 20)).toBeGreaterThanOrEqual(0.5);
    expect(lightOpacity("tavern", 22)).toBeGreaterThan(0.8);
    expect(lightOpacity("tavern", 12)).toBe(0);
  });
});

describe("save", () => {
  const city = { name: "Т", lat: 59, lng: 37, foundedAt: NOW - 1000 };
  const base = { version: 4, city, sim: { realTime: NOW, gameMinutes: 50 } };
  it("an old save without a summary loads with none", () => {
    expect(parseSave(base, NOW)!.sim.summary).toBeNull();
  });
  it("round-trips the summary", () => {
    const summary: DaySummary = { at: 1000, lines: [{ kind: "built", text: "Построено", pos: [1.5, 2] }, { kind: "problem", text: "Нет пищи" }] };
    const save = parseSave(JSON.parse(JSON.stringify({ ...base, sim: { ...base.sim, summary } })), NOW)!;
    expect(save.sim.summary).toEqual(summary);
  });
  it("drops broken lines and a broken summary", () => {
    const bad = { at: 5, lines: [{ kind: "nope", text: "x" }, { kind: "made", text: 3 }, { kind: "born", text: "ok", pos: "x" }] };
    expect(parseSave({ ...base, sim: { ...base.sim, summary: bad } }, NOW)!.sim.summary).toEqual({ at: 5, lines: [{ kind: "born", text: "ok" }] });
    expect(parseSave({ ...base, sim: { ...base.sim, summary: { at: "x", lines: [] } } }, NOW)!.sim.summary).toBeNull();
  });
});

describe("night planning label", () => {
  it("shows outside work hours only", () => {
    expect(queuedLabel(at(SUMMER, 12))).toBeNull();
    expect(queuedLabel(at(SUMMER, 7))).toBeNull();
    expect(queuedLabel(at(SUMMER, 19))).toBe("начнут в 07:00");
    expect(queuedLabel(at(SUMMER, 23))).toBe("начнут в 07:00");
    expect(queuedLabel(at(SUMMER, 5))).toBe("начнут в 07:00");
  });
  it("year constant sanity", () => {
    expect(YEAR_DAYS).toBe(32);
  });
});
