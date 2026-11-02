import { YEAR_MIN } from "./time";
import type { Building, Household, Needs, NeedsStats, Resident } from "./types";

// Personal needs (design: docs/PLAN-needs.md). Every resident carries four 0..100 values; a satisfied need is 100.
// Unmet needs cost work, walking speed, mood and, at the bottom, health; a low mood costs work, births, learning
// and keeps newcomers away, and it is the loudest reason a family leaves.
//
// All factors are exactly 1 for a fed, rested, sociable and warm resident with a household mood of 60 or more, so a
// town that keeps its people content behaves as before. Only a deficit changes anything.

export const NEED_NAMES: Record<keyof Needs, string> = {
  food: "Сытость",
  rest: "Отдых",
  social: "Общение",
  warmth: "Тепло",
};

export const NEEDS = {
  // Satiety falls by `foodDecay` on a day when the barns feed nobody; a full day's rations restore `foodMeal`, so a
  // fed resident recovers from a shortage over several days instead of staying hungry forever.
  foodDecay: 55,
  foodMeal: 75,
  // A working adult spends this much rest per work hour; the night returns a share of the remaining fatigue:
  // 50 % in a house (+5 % at level 2), 35 % in a tent, and only 30 % of that in a cold house.
  workHour: 2.5,
  houseRecover: 0.5,
  tentRecover: 0.35,
  level2Recover: 0.05,
  coldRecover: 0.6,
  // Company: the day takes this much; family, wares, an evening gathering and school return it.
  socialDecay: 12,
  socialFamily: 10,
  socialWares: 3,
  socialGather: 6,
  socialSchool: 2,
  // Warmth: a household without firewood loses this much a day, a warm one recovers this much.
  coldDrop: 40,
  warmRecover: 20,
  warmTent: 12,
  // Mood: the target drops by up to this much when every need is empty, and never rises above 0 for full needs.
  moodWeight: 30,
  // Mood below this starts to cost work; the factor reaches moodWorkMin at mood 0.
  moodWorkFrom: 55,
  moodWorkMin: 0.6,
  // Productivity curves: 1 at `from`, `min` at 0.
  work: { foodFrom: 70, foodMin: 0.6, restFrom: 60, restMin: 0.7, socialFrom: 50, socialMin: 0.9, warmthFrom: 50, warmthMin: 0.85, min: 0.1 },
  move: { foodFrom: 60, foodMin: 0.85, restFrom: 60, restMin: 0.85, warmthFrom: 50, warmthMin: 0.9, min: 0.5 },
  // Extra chance of death a day, on top of the age table: starvation, exhaustion, freezing.
  death: { starveFrom: 20, starve: 0.02, tiredFrom: 10, tired: 0.004, freezeFrom: 25, freeze: 0.012 },
  // Below these a need is called out in the warnings and the inspector.
  warn: { food: 30, rest: 30, social: 30, warmth: 30 },
  leaveRisk: 0.6, // +60 % departure chance at empty needs
  birthMin: 0.4,
  learnMin: 0.4,
};

export const MOOD_NEUTRAL = 60;
const FULL: Readonly<Needs> = { food: 100, rest: 100, social: 100, warmth: 100 };

const clamp100 = (v: number): number => Math.min(100, Math.max(0, v));

export const fullNeeds = (): Needs => ({ ...FULL });

// Needs of a resident; saves from before the needs system count as fully satisfied.
export const needsOf = (r: Pick<Resident, "needs"> | undefined): Needs => r?.needs ?? FULL;

// Weighted satisfaction 0..100: hunger weighs most, warmth least.
export const satisfaction = (n: Needs): number => n.food * 0.4 + n.rest * 0.25 + n.social * 0.2 + n.warmth * 0.15;

// The average satisfaction of a household (members that still exist).
export function householdSatisfaction(members: readonly number[], residents: Record<number, Resident>): number {
  let sum = 0;
  let n = 0;
  for (const id of members) {
    const r = residents[id];
    if (!r) continue;
    sum += satisfaction(needsOf(r));
    n++;
  }
  return n > 0 ? sum / n : 100;
}

// A linear deficit curve: 1 at `from` and above, `min` at 0.
const curve = (v: number, from: number, min: number): number => (v >= from ? 1 : Math.max(min, min + ((1 - min) * Math.max(0, v)) / from));

// How well a resident works, from the needs alone (0..1).
export function needWorkFactor(n: Needs): number {
  const W = NEEDS.work;
  return Math.max(W.min, curve(n.food, W.foodFrom, W.foodMin) * curve(n.rest, W.restFrom, W.restMin) * curve(n.social, W.socialFrom, W.socialMin) * curve(n.warmth, W.warmthFrom, W.warmthMin));
}

// How fast a resident walks, from the needs alone (0..1).
export function needMoveFactor(n: Needs): number {
  const M = NEEDS.move;
  return Math.max(M.min, curve(n.food, M.foodFrom, M.foodMin) * curve(n.rest, M.restFrom, M.restMin) * curve(n.warmth, M.warmthFrom, M.warmthMin));
}

// How much a household mood of `mood` (0..100) costs work; 1 from the neutral mood up.
export function moodWorkFactor(mood: number): number {
  if (mood >= NEEDS.moodWorkFrom) return 1;
  return Math.max(NEEDS.moodWorkMin, NEEDS.moodWorkMin + ((1 - NEEDS.moodWorkMin) * Math.max(0, mood)) / NEEDS.moodWorkFrom);
}

// Personal productivity: the needs and the mood of the household together (0..1).
export const residentWorkFactor = (r: Resident, mood: number): number => Math.max(0.1, needWorkFactor(needsOf(r)) * moodWorkFactor(mood));

// Personal walking speed factor (0..1).
export const residentMoveFactor = (r: Resident): number => needMoveFactor(needsOf(r));

// The mood-target term of unmet needs: 0 at full satisfaction, down to -moodWeight at none.
export const needMoodTerm = (satisfactionValue: number): number => (satisfactionValue >= 100 ? 0 : (NEEDS.moodWeight * (satisfactionValue - 100)) / 100);

// Chance of dying of a need today, on top of the age table. Children under 5 and people over 60 are the frail.
export function deathChanceFromNeeds(n: Needs, age: number): number {
  const D = NEEDS.death;
  const frail = age < 5 || age >= 60 ? 2 : 1;
  let p = 0;
  if (n.food < D.starveFrom) p += D.starve * frail * (1 - n.food / D.starveFrom);
  if (n.rest < D.tiredFrom) p += D.tired * frail * (1 - n.rest / D.tiredFrom);
  if (n.warmth < D.freezeFrom) p += D.freeze * frail * (1 - n.warmth / D.freezeFrom);
  return p;
}

// A content household has children more readily; a lonely, exhausted one less.
export const birthFactor = (mood: number, satisfactionValue: number): number =>
  Math.max(NEEDS.birthMin, moodWorkFactor(mood) * (0.6 + (0.4 * satisfactionValue) / 100));

// A hungry or exhausted child learns slower.
export const learningFactor = (mood: number, n: Needs): number => Math.max(NEEDS.learnMin, moodWorkFactor(mood) * (0.5 + (0.5 * n.rest) / 100));

// The departure chance of a household scales with how badly its needs are met (1 when they are full).
export const leaveRisk = (satisfactionValue: number): number => 1 + NEEDS.leaveRisk * (1 - satisfactionValue / 100);

// The average productivity of the adults: what the construction artel and the town panel show.
// Both objects are replaced when jobs, needs or mood change, so the cache is exact.
const crewCache = new WeakMap<object, WeakMap<object, number>>();
export function crewEfficiency(s: Pick<{ residents: Record<number, Resident>; households: Record<number, Household>; gameMinutes: number }, "residents" | "households" | "gameMinutes">): number {
  let byHouseholds = crewCache.get(s.residents);
  if (!byHouseholds) {
    byHouseholds = new WeakMap();
    crewCache.set(s.residents, byHouseholds);
  }
  const hit = byHouseholds.get(s.households);
  if (hit !== undefined) return hit;
  let sum = 0;
  let n = 0;
  for (const r of Object.values(s.residents)) {
    const age = (s.gameMinutes - r.born) / YEAR_MIN;
    if (age < 16 || age >= 60 || r.inClass) continue;
    sum += residentWorkFactor(r, s.households[r.household]?.mood ?? MOOD_NEUTRAL);
    n++;
  }
  const value = n > 0 ? sum / n : 1;
  byHouseholds.set(s.households, value);
  return value;
}

// What is short for one resident, in the words of the inspector; empty when nothing is.
export function needProblems(n: Needs): string[] {
  const out: string[] = [];
  if (n.food < NEEDS.warn.food) out.push("голод");
  if (n.rest < NEEDS.warn.rest) out.push("усталость");
  if (n.social < NEEDS.warn.social) out.push("одиночество");
  if (n.warmth < NEEDS.warn.warmth) out.push("холод");
  return out;
}

export interface NeedsDay {
  now: number;
  fed: number; // share of the day's food need that the barns met, 0..1
  served: number; // share of the household's wares need, 0..1
  gather: boolean; // the household has a tavern or a chapel to gather at
  cold: boolean; // the household had no firewood
  hours: number; // length of the workday in hours
}

// One day of a resident's needs: hunger from the town's meals, rest from work and sleep, company from family,
// wares, gatherings and school, warmth from the firewood.
export function needsAfterDay(r: Resident, h: Household, home: Building | undefined, day: NeedsDay): Needs {
  const n = needsOf(r);
  const age = (day.now - r.born) / YEAR_MIN;
  const working = age >= 16 && age < 60 && !r.inClass;

  const food = clamp100(n.food - NEEDS.foodDecay + NEEDS.foodMeal * Math.min(1, Math.max(0, day.fed)));

  let rest = n.rest;
  if (working) rest -= NEEDS.workHour * day.hours;
  const recover = (h.home === null ? NEEDS.tentRecover : NEEDS.houseRecover + (home && home.level >= 2 ? NEEDS.level2Recover : 0)) * (day.cold ? NEEDS.coldRecover : 1);
  rest = clamp100(rest + (100 - rest) * recover);

  let social = n.social - NEEDS.socialDecay;
  if (h.members.length > 1) social += NEEDS.socialFamily;
  social += NEEDS.socialWares * Math.min(1, Math.max(0, day.served));
  if (day.gather) social += NEEDS.socialGather;
  if (age >= 7 && age < 15) social += NEEDS.socialSchool;
  social = clamp100(social);

  const warmth = clamp100(day.cold ? n.warmth - NEEDS.coldDrop : n.warmth + (h.home === null ? NEEDS.warmTent : NEEDS.warmRecover));

  return { food, rest, social, warmth };
}

// The town's needs as the panel and the top bar show them.
export function needsStats(residents: Record<number, Resident>, households?: Record<number, Household>, now?: number): NeedsStats {
  const avg: Needs = { food: 0, rest: 0, social: 0, warmth: 0 };
  let n = 0;
  let starving = 0;
  let tired = 0;
  let lonely = 0;
  let freezing = 0;
  let work = 0;
  let workers = 0;
  for (const r of Object.values(residents)) {
    const needs = needsOf(r);
    avg.food += needs.food;
    avg.rest += needs.rest;
    avg.social += needs.social;
    avg.warmth += needs.warmth;
    n++;
    if (needs.food < NEEDS.warn.food) starving++;
    if (needs.rest < NEEDS.warn.rest) tired++;
    if (needs.social < NEEDS.warn.social) lonely++;
    if (needs.warmth < NEEDS.warn.warmth) freezing++;
    if (now !== undefined) {
      const age = (now - r.born) / YEAR_MIN;
      if (age < 16 || age >= 60 || r.inClass) continue;
    }
    work += residentWorkFactor(r, households?.[r.household]?.mood ?? MOOD_NEUTRAL);
    workers++;
  }
  return {
    avg: n > 0 ? { food: avg.food / n, rest: avg.rest / n, social: avg.social / n, warmth: avg.warmth / n } : { ...FULL },
    starving,
    tired,
    lonely,
    freezing,
    work: workers > 0 ? work / workers : 1,
  };
}

// At least one resident at the starvation line: what the "Люди истощены" event and warning hang on.
export const starvingResidents = (residents: Record<number, Resident>): number => Object.values(residents).filter((r) => needsOf(r).food < NEEDS.death.starveFrom).length;
