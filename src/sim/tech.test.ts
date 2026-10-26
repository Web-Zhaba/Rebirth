import { describe, expect, it } from "vitest";
import { BUILDINGS } from "./buildings";
import { emptyGrowth } from "./growth";
import { parseProgress } from "./research";
import { parseSave } from "./save";
import { emptyRoads } from "./roads";
import { ALL_UNLOCKS, allResearched, allUnlocked, bridgeSpanBonus, buildSpeedMul, cropOf, eraTwoMet, fieldYieldMul, initialProgress, INSIGHTS, isUnlocked, lockReason, migrateProgress, provenUnlocks, TECH_BY_ID, TECHS, UNLOCK_NAME, validateTechs, workshopMul } from "./tech";
import type { Building, City, Resident, SimState } from "./types";
import { emptyZones } from "./zones";

const NOW = 1_800_000_000_000;
const city: City = { name: "Тест", lat: 59, lng: 37, foundedAt: NOW - 1e6 };

function bld(id: number, template: string): Building {
  const t = BUILDINGS[template];
  return { id, template, zone: t.zone, lot: { cx: id * 20, cy: 10, angle: 0, w: t.w, d: t.d }, side: 1, footprint: [[0, 0], [1, 0], [1, 1], [0, 1]], height: t.height, state: "active", labor: t.labor, done: t.labor, created: 0, paid: true, level: 1, streak: 0 };
}
const town = (bs: Building[] = []): SimState => ({ realTime: NOW, gameMinutes: 1000, roads: emptyRoads(), zones: emptyZones(), ...emptyGrowth(7, 1000), buildings: Object.fromEntries(bs.map((b) => [b.id, b])), nextBuildingId: bs.length + 1 });
const people = (s: SimState, n: number): SimState => {
  const residents: Record<number, Resident> = {};
  for (let i = 1; i <= n; i++) residents[i] = { id: i, first: "Иван", last: "Тестов", sex: "m", born: -1e6, household: 1, spouse: null, job: null, commute: null, idleDays: 0, literate: false, school: 0 };
  return { ...s, residents };
};
const old = (sim: SimState, goals?: unknown) => JSON.parse(JSON.stringify({ version: 4, city, sim: { ...sim, progress: undefined, goals } }));

describe("tech graph", () => {
  it("is a sound tree", () => {
    expect(validateTechs()).toEqual([]);
    expect(TECHS.filter((t) => t.era === 1)).toHaveLength(15);
    expect(TECHS.filter((t) => t.era === 2).map((t) => t.id)).toEqual(["paving", "stonebridge", "trusses", "cellars", "beekeeping", "letters"]);
  });
  it("catches a cycle, a missing prerequisite, a lower era and a doubled key", () => {
    const t = (id: string, requires: string[], era: 1 | 2 = 1, unlocks: string[] = []) => ({ ...TECHS[0], id, requires, era, unlocks });
    expect(validateTechs([t("a", ["b"]), t("b", ["a"])]).some((p) => p.includes("cycle"))).toBe(true);
    expect(validateTechs([t("a", ["zz"])])[0]).toContain("unknown");
    expect(validateTechs([t("a", ["b"], 1), t("b", [], 2)])[0]).toContain("era");
    expect(validateTechs([t("a", [], 1, ["k"]), t("b", [], 1, ["k"])])[0]).toContain("opened by");
  });
  it("opens every unlock key with exactly one tech", () => {
    for (const k of ALL_UNLOCKS) expect(TECHS.filter((t) => t.unlocks.includes(k))).toHaveLength(1);
    for (const k of ["sawpit", "barn", "quarry", "fisher", "garden", "hunter", "cellar", "forager", "orchard", "apiary", "market", "chapel", "school", "healer", "zone:craft", "zone:trade", "upgrade", "road:stone", "road:stonebridge"]) expect(k in UNLOCK_NAME).toBe(true);
  });
  it("insights point at real techs", () => {
    for (const i of INSIGHTS) expect(i.tech === null || TECH_BY_ID.has(i.tech)).toBe(true);
  });
});

describe("unlocks", () => {
  it("isUnlocked and lockReason follow the researched techs and the era", () => {
    const p = { ...initialProgress(), techs: ["carpentry"] };
    expect(isUnlocked(p, "sawpit")).toBe(true);
    expect(isUnlocked(p, "barn")).toBe(false);
    expect(lockReason({ progress: p }, "sawpit")).toBeNull();
    expect(lockReason({ progress: p }, "barn")).toBe("Технология: Хранение запасов");
    expect(lockReason({ progress: p }, "craft")).toBe("Технология: Ремёсла");
    expect(lockReason({ progress: p }, "stone")).toBe("Эпоха II");
    expect(lockReason({ progress: { ...p, era: 2 } }, "stonebridge")).toBe("Технология: Каменные мосты");
    expect(lockReason({ progress: p }, "well")).toBeNull();
    expect(lockReason({ progress: allResearched() }, "school")).toBeNull();
  });
});

describe("test helpers", () => {
  it("allUnlocked opens everything and changes no number", () => {
    for (const k of ALL_UNLOCKS) expect(isUnlocked(allUnlocked(), k)).toBe(true);
    expect(fieldYieldMul(allUnlocked())).toBe(1);
    expect(buildSpeedMul(allUnlocked())).toBe(1);
  });
});

describe("modifiers", () => {
  it("add up over the researched techs", () => {
    const none = initialProgress();
    expect([fieldYieldMul(none), workshopMul(none), buildSpeedMul(none)]).toEqual([1, 1, 1]);
    const all = allResearched();
    expect(fieldYieldMul(all)).toBeCloseTo(1.1);
    expect(workshopMul(all)).toBeCloseTo(1.1);
    expect(buildSpeedMul(all)).toBeCloseTo(1.1);
    expect(cropOf({ weather: { crop: 0.8 }, progress: all })).toBeCloseTo(0.88);
    expect(cropOf({})).toBe(1);
    expect(bridgeSpanBonus(all, "bridge")).toBe(30);
    expect(bridgeSpanBonus(all, "stonebridge")).toBe(40);
    expect(bridgeSpanBonus({ techs: ["joinery"] }, "bridge")).toBe(15);
  });
});

describe("era II condition", () => {
  it("needs 100 residents and 12 era I techs", () => {
    const era1 = TECHS.filter((t) => t.era === 1).map((t) => t.id);
    const s = people(town(), 100);
    expect(eraTwoMet({ ...s, progress: { ...initialProgress(), techs: era1.slice(0, 11) } })).toBe(false);
    expect(eraTwoMet({ ...s, progress: { ...initialProgress(), techs: era1.slice(0, 12) } })).toBe(true);
    expect(eraTwoMet({ ...people(town(), 99), progress: { ...initialProgress(), techs: era1 } })).toBe(false);
  });
});

describe("old saves", () => {
  it("a save with goals gives the techs its paid unlocks cover, with prerequisites", () => {
    const sim = parseSave(old(town([bld(1, "izba")]), { done: ["izbas2", "logs20"], unlocks: ["sawpit", "barn", "cellar", "hunter", "forager", "quarry", "zone:craft"] }), NOW + 1)!.sim;
    for (const id of ["carpentry", "storage", "foraging", "cellars", "stonework", "crafts"]) expect(sim.progress.techs).toContain(id);
    expect(sim.progress.techs).not.toContain("fishing");
    expect(sim.progress.techs).not.toContain("threefield"); // modifier-only techs are not guessed
    expect(sim.progress.era).toBe(1);
    expect(sim.chronicle.filter((e) => e.kind.startsWith("tech:"))).toEqual([]);
    expect(sim.events).toEqual([]);
  });
  it("a goals record with only done goals pays their unlocks", () => {
    const sim = parseSave(old(town(), { done: ["sow2", "harvest"], unlocks: [] }), NOW + 1)!.sim;
    for (const id of ["fishing", "gardening", "storage", "faith", "stonework", "carpentry", "orchards"]) expect(sim.progress.techs).toContain(id);
  });
  it("a save without goals takes what the buildings prove, and never closes a built template", () => {
    const s = town([bld(1, "market"), bld(2, "hunter"), { ...bld(3, "izba"), level: 2 }]);
    expect(provenUnlocks(s).sort()).toEqual(["hunter", "market", "upgrade"]);
    const sim = parseSave(old(s), NOW + 1)!.sim;
    for (const k of ["market", "zone:trade", "zone:craft", "hunter", "forager", "upgrade", "sawpit"]) expect(isUnlocked(sim.progress, k)).toBe(true);
    expect(isUnlocked(sim.progress, "chapel")).toBe(false);
  });
  it("a town with a school keeps it though era II is not met", () => {
    const sim = parseSave(old(town([bld(1, "school")])), NOW + 1)!.sim;
    expect(isUnlocked(sim.progress, "school")).toBe(true);
    expect(sim.progress.era).toBe(1);
  });
  it("a big old town starts in era II", () => {
    const p = migrateProgress(people(town(), 100), { done: ["izbas2", "logs20", "sow2", "pop25", "harvest", "pop50", "craft5"], unlocks: [] });
    expect(p.era).toBe(2);
  });
  it("progress round-trips through the save", () => {
    const progress = { era: 2, techs: ["carpentry", "faith"], research: { active: { techId: "stonework", done: 1.5 }, queue: ["crafts"] }, insights: ["masonry"], restored: { learn: 3 } };
    const sim = parseSave(JSON.parse(JSON.stringify({ version: 4, city, sim: { ...town(), progress } })), NOW + 1)!.sim;
    expect(sim.progress).toEqual(progress);
  });
  it("the goal and unlock event kinds still parse, and the new ones too", () => {
    const events = [{ at: 1, kind: "goal", text: "a" }, { at: 2, kind: "unlock", text: "b", pos: [1, 2] }, { at: 3, kind: "tech", text: "c" }, { at: 4, kind: "era", text: "d" }];
    const sim = parseSave(JSON.parse(JSON.stringify({ version: 4, city, sim: { ...town(), events } })), NOW + 1)!.sim;
    expect(sim.events.map((e) => e.kind)).toEqual(["goal", "unlock", "tech", "era"]);
  });
});

describe("parseProgress", () => {
  it("gives null for nothing and repairs entry by entry", () => {
    expect(parseProgress(undefined)).toBeNull();
    expect(parseProgress([])).toBeNull();
    const p = parseProgress({
      era: 9,
      techs: ["carpentry", "carpentry", "nope", 5, "storage"],
      research: { active: { techId: "carpentry", done: 1 }, queue: ["crafts", "crafts", "nope", "trade", "faith", "healing", "housing"] },
      insights: ["masonry", "bogus", "masonry"],
      restored: { learn: 2, bogus: 4, build: -1, farm: "x" },
    })!;
    expect(p.era).toBe(2);
    expect(p.techs).toEqual(["carpentry", "storage"]);
    expect(p.research.active).toBeNull(); // already researched
    expect(p.research.queue).toEqual(["crafts", "trade", "faith"]);
    expect(p.insights).toEqual(["masonry"]);
    expect(p.restored).toEqual({ learn: 2 });
  });
  it("keeps a good active entry and drops a broken one", () => {
    expect(parseProgress({ research: { active: { techId: "crafts", done: 2 } } })!.research.active).toEqual({ techId: "crafts", done: 2 });
    expect(parseProgress({ research: { active: { techId: "crafts", done: -1 } } })!.research.active).toBeNull();
    expect(parseProgress({ research: { active: 7, queue: "x" } })!.research).toEqual({ active: null, queue: [] });
  });
});
