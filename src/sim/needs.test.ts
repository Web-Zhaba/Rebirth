import { describe, expect, it } from "vitest";
import {
  birthFactor,
  crewEfficiency,
  deathChanceFromNeeds,
  fullNeeds,
  householdSatisfaction,
  learningFactor,
  leaveRisk,
  MOOD_NEUTRAL,
  moodWorkFactor,
  needMoodTerm,
  needMoveFactor,
  needProblems,
  needsAfterDay,
  needsOf,
  needsStats,
  needWorkFactor,
  residentWorkFactor,
  satisfaction,
  starvingResidents,
  type NeedsDay,
} from "./needs";
import { YEAR_MIN } from "./time";
import type { Building, Household, Resident } from "./types";

const resident = (o: Partial<Resident> = {}): Resident => ({
  id: 1,
  first: "Иван",
  last: "Тестов",
  sex: "m",
  born: -30 * YEAR_MIN,
  household: 1,
  spouse: null,
  job: null,
  commute: null,
  idleDays: 0,
  literate: false,
  school: 0,
  needs: fullNeeds(),
  ...o,
});

const household = (o: Partial<Household> = {}): Household => ({ id: 1, last: "Тестов", home: null, members: [1], arrived: 0, founder: false, mood: MOOD_NEUTRAL, ...o });

const house = (level = 1): Building => ({ level }) as Building;

const day = (o: Partial<NeedsDay> = {}): NeedsDay => ({ now: 0, fed: 1, served: 1, gather: false, cold: false, hours: 12, ...o });

describe("needs: baseline", () => {
  it("a fed, rested, sociable and warm resident with a neutral mood has no penalty anywhere", () => {
    const r = resident();
    expect(needWorkFactor(fullNeeds())).toBe(1);
    expect(needMoveFactor(fullNeeds())).toBe(1);
    expect(moodWorkFactor(MOOD_NEUTRAL)).toBe(1);
    expect(moodWorkFactor(80)).toBe(1);
    expect(residentWorkFactor(r, MOOD_NEUTRAL)).toBe(1);
    expect(needMoodTerm(100)).toBe(0);
    expect(deathChanceFromNeeds(fullNeeds(), 30)).toBe(0);
    expect(birthFactor(MOOD_NEUTRAL, 100)).toBe(1);
    expect(learningFactor(MOOD_NEUTRAL, fullNeeds())).toBe(1);
    expect(leaveRisk(100)).toBe(1);
    expect(needProblems(fullNeeds())).toEqual([]);
  });

  it("a resident of an old save counts as fully satisfied", () => {
    expect(needsOf({ needs: undefined })).toEqual({ food: 100, rest: 100, social: 100, warmth: 100 });
  });
});

describe("needs: a day", () => {
  it("a full meal keeps satiety and lets a hungry resident recover; an empty barn empties it in two days", () => {
    const r = resident();
    expect(needsAfterDay(r, household(), house(), day()).food).toBe(100);
    const half = needsAfterDay(r, household(), house(), day({ fed: 0.5 }));
    expect(half.food).toBeCloseTo(82.5);
    const empty = needsAfterDay({ ...r, needs: half }, household(), house(), day({ fed: 0 }));
    expect(empty.food).toBeCloseTo(27.5);
    const gone = needsAfterDay({ ...r, needs: empty }, household(), house(), day({ fed: 0 }));
    expect(gone.food).toBe(0);
    expect(starvingResidents({ 1: { ...r, needs: gone } })).toBe(1);
    expect(starvingResidents({ 1: { ...r, needs: half } })).toBe(0);
    // a full barn brings a starving resident back over several days, not at once
    expect(needsAfterDay({ ...r, needs: gone }, household(), house(), day()).food).toBeCloseTo(20);
    expect(needsAfterDay({ ...r, needs: { ...gone, food: 95 } }, household(), house(), day()).food).toBe(100);
  });

  it("a workday costs rest; the night returns a share of the remaining fatigue, less in a tent and in the cold", () => {
    const r = resident();
    expect(needsAfterDay(r, household({ home: 1 }), house(), day()).rest).toBeCloseTo(85); // 70 after work, half of 30 back
    expect(needsAfterDay(r, household(), undefined, day()).rest).toBeCloseTo(80.5); // 70 + 35 % of 30
    expect(needsAfterDay(r, household({ home: 1 }), house(), day({ hours: 16 })).rest).toBeCloseTo(80); // 60 + half of 40
    expect(needsAfterDay(r, household({ home: 1 }), house(), day({ cold: true })).rest).toBeCloseTo(79); // 70 + 30 % of 30
    expect(needsAfterDay({ ...r, born: 0 }, household(), undefined, day()).rest).toBe(100); // a child does not work
    // repeated normal days settle near 70, repeated days in tents near 44
    let houseRest = 100;
    let tentRest = 100;
    for (let d = 0; d < 40; d++) {
      houseRest = needsAfterDay({ ...r, needs: { ...fullNeeds(), rest: houseRest } }, household({ home: 1 }), house(), day()).rest;
      tentRest = needsAfterDay({ ...r, needs: { ...fullNeeds(), rest: tentRest } }, household(), undefined, day()).rest;
    }
    expect(houseRest).toBeCloseTo(70, 0);
    expect(tentRest).toBeCloseTo(44.3, 0);
  });

  it("company comes from family, the market, an evening gathering and school", () => {
    const two = household({ members: [1, 2] });
    expect(needsAfterDay(resident(), two, house(), day({ served: 0 })).social).toBeCloseTo(98);
    expect(needsAfterDay(resident(), household(), house(), day({ served: 0 })).social).toBeCloseTo(88);
    expect(needsAfterDay(resident(), household(), house(), day({ served: 0, gather: true })).social).toBeCloseTo(94);
    expect(needsAfterDay(resident(), household(), house(), day()).social).toBeCloseTo(91);
    expect(needsAfterDay({ ...resident(), born: -8 * YEAR_MIN }, two, house(), day({ served: 0 })).social).toBe(100);
  });

  it("a cold household loses warmth, a warm one recovers it", () => {
    expect(needsAfterDay(resident(), household(), house(), day({ cold: true })).warmth).toBe(60);
    expect(needsAfterDay(resident(), household(), house(), day()).warmth).toBe(100);
    expect(needsAfterDay({ ...resident(), needs: { food: 100, rest: 100, social: 100, warmth: 10 } }, household({ home: 1 }), house(), day()).warmth).toBe(30);
  });
});

describe("needs: costs", () => {
  it("mood falls with unmet needs and never rises for them", () => {
    expect(needMoodTerm(100)).toBe(0);
    expect(needMoodTerm(50)).toBeCloseTo(-15);
    expect(needMoodTerm(0)).toBeCloseTo(-30);
  });

  it("hunger and fatigue cut work; an unhappy household cuts it further", () => {
    const hungry = { ...fullNeeds(), food: 0 };
    const tired = { ...fullNeeds(), rest: 0 };
    expect(needWorkFactor(hungry)).toBeCloseTo(0.6);
    expect(needWorkFactor(tired)).toBeCloseTo(0.7);
    expect(needWorkFactor({ ...fullNeeds(), social: 0, warmth: 0 })).toBeCloseTo(0.9 * 0.85);
    expect(moodWorkFactor(35)).toBeCloseTo(0.6 + (0.4 * 35) / 55);
    expect(moodWorkFactor(0)).toBe(0.6);
    expect(residentWorkFactor(resident({ needs: hungry }), MOOD_NEUTRAL)).toBeCloseTo(0.6);
    expect(residentWorkFactor(resident(), 35)).toBeLessThan(0.9);
  });

  it("a weak resident also walks slower, within a floor", () => {
    expect(needMoveFactor(fullNeeds())).toBe(1);
    expect(needMoveFactor({ food: 30, rest: 30, social: 100, warmth: 30 })).toBeLessThan(0.9);
    expect(needMoveFactor({ food: 0, rest: 0, social: 0, warmth: 0 })).toBeCloseTo(0.85 * 0.85 * 0.9);
    expect(needMoveFactor({ food: 0, rest: 0, social: 0, warmth: 0 })).toBeGreaterThanOrEqual(0.5);
    expect(residentWorkFactor(resident({ needs: { food: 0, rest: 0, social: 0, warmth: 0 } }), 0)).toBeGreaterThanOrEqual(0.1);
  });

  it("starvation, exhaustion and cold add their own chance of death, worst for the frail", () => {
    const all = { food: 0, rest: 0, social: 100, warmth: 0 };
    expect(deathChanceFromNeeds(fullNeeds(), 30)).toBe(0);
    expect(deathChanceFromNeeds({ ...fullNeeds(), food: 0 }, 30)).toBeCloseTo(0.02);
    expect(deathChanceFromNeeds(all, 30)).toBeCloseTo(0.036);
    expect(deathChanceFromNeeds(all, 3)).toBeCloseTo(0.072);
    expect(deathChanceFromNeeds(all, 70)).toBeCloseTo(0.072);
  });

  it("happiness helps births, learning and staying; misery drives families out", () => {
    expect(birthFactor(35, 50)).toBeLessThan(1);
    expect(learningFactor(35, { food: 100, rest: 30, social: 100, warmth: 100 })).toBeLessThan(1);
    expect(leaveRisk(100)).toBe(1);
    expect(leaveRisk(50)).toBeCloseTo(1.3);
    expect(leaveRisk(0)).toBeCloseTo(1.6);
  });

  it("needs stats count the residents below the warning line and the average strength of the adults", () => {
    const now = 0;
    const fed = resident({ id: 1, born: -30 * YEAR_MIN });
    const hungry = resident({ id: 2, born: -30 * YEAR_MIN, needs: { food: 10, rest: 10, social: 10, warmth: 10 } });
    const child = resident({ id: 3, born: 0, needs: { food: 100, rest: 100, social: 100, warmth: 100 } });
    const stats = needsStats({ 1: fed, 2: hungry, 3: child }, { 1: household({ mood: MOOD_NEUTRAL }) }, now);
    expect(stats.avg.food).toBeCloseTo((100 + 10 + 100) / 3);
    expect(stats.starving).toBe(1);
    expect(stats.tired).toBe(1);
    expect(stats.lonely).toBe(1);
    expect(stats.freezing).toBe(1);
    expect(stats.work).toBeGreaterThan(0.6);
    expect(stats.work).toBeLessThan(0.8); // the content adult 1 and the hungry one about 0.4; children are not counted
  });

  it("the construction artel is only as strong as its adults", () => {
    const now = 0;
    const s = { residents: { 1: resident({ id: 1, born: -30 * YEAR_MIN }), 2: resident({ id: 2, born: -30 * YEAR_MIN, needs: { food: 0, rest: 100, social: 100, warmth: 100 } }) }, households: { 1: household() }, gameMinutes: now };
    expect(crewEfficiency(s)).toBeCloseTo((1 + 0.6) / 2);
    expect(crewEfficiency({ ...s, residents: { 1: resident({ id: 1, born: 0 }) } })).toBe(1); // no adult workers
  });

  it("household satisfaction is the mean of its members and the problems are named in words", () => {
    const residents = { 1: resident({ id: 1 }), 2: resident({ id: 2, needs: { food: 0, rest: 100, social: 100, warmth: 100 } }) };
    expect(householdSatisfaction([1, 2], residents)).toBeCloseTo((100 + (satisfaction({ food: 0, rest: 100, social: 100, warmth: 100 }))) / 2);
    expect(householdSatisfaction([], residents)).toBe(100);
    expect(needProblems({ food: 0, rest: 0, social: 0, warmth: 0 })).toEqual(["голод", "усталость", "одиночество", "холод"]);
  });
});
