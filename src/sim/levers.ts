import { JOB_KEYS, type JobKey, type Priority } from "./buildings";
import { dayStart } from "./time";

// Player levers (PLAN-pace.md section 8). All of them are off by default, so a town that never uses them behaves as before.

export type Rations = "reduced" | "normal" | "generous";

export interface Levers {
  priority: number | null; // site served first: a building id, or -id of a clearing
  toloka: { site: number; until: number } | null; // site key and the gameMinutes the call lasts to (the end of that workday)
  tolokaReady: number; // gameMinutes from which a new толока may be called
  strada: boolean; // «Долгий день»: the long workday
  rations: Rations;
  adultSchool: boolean; // «Взрослые в школу»: illiterate grown-ups learn in class instead of working
  jobs: Record<JobKey, Priority>; // hiring priority per job group, and the builders' floor ("build"); 2 = normal
}

export const emptyJobs = (): Record<JobKey, Priority> => Object.fromEntries(JOB_KEYS.map((k) => [k, 2])) as Record<JobKey, Priority>;

export const emptyLevers = (): Levers => ({ priority: null, toloka: null, tolokaReady: 0, strada: false, rations: "normal", adultSchool: false, jobs: emptyJobs() });

export const WORKDAY = { start: 7, end: 19 };
export const STRADA = { start: 5, end: 21 };
export const STRADA_MOOD = -8;
export const TOLOKA_COOLDOWN = 3 * 1440; // game minutes
export const CALL = { food: 300, wares: 10, minMinutes: 360, maxMinutes: 1440 }; // cost of a call for settlers; arrival window

export const RATIONS: Record<Rations, { name: string; food: number; mood: number }> = {
  reduced: { name: "Урезанные", food: 0.75, mood: -10 },
  normal: { name: "Обычные", food: 1, mood: 0 },
  generous: { name: "Щедрые", food: 1.25, mood: 8 },
};

// Anything that may carry levers: the state itself (or a part of it), or the levers.
type Source = { levers?: Levers } | Levers | undefined | null;
const pick = (l: Source): Levers | undefined => (l && "rations" in l ? l : (l as { levers?: Levers } | null | undefined)?.levers);

// Work hours of the day: 07-19, or 05-21 in the «Долгий день».
export const workHours = (l?: Source): { start: number; end: number } => (pick(l)?.strada ? STRADA : WORKDAY);
export const isWorkHour = (hour: number, l?: Source): boolean => {
  const w = workHours(l);
  return hour >= w.start && hour < w.end;
};
export const workLength = (l?: Source): number => {
  const w = workHours(l);
  return w.end - w.start;
};
// Share of the normal food the town eats.
export const rationFood = (l?: Source): number => RATIONS[pick(l)?.rations ?? "normal"].food;
// Added to the mood target of every household.
export const leverMood = (l?: Source): number => (pick(l)?.strada ? STRADA_MOOD : 0) + RATIONS[pick(l)?.rations ?? "normal"].mood;

export const tolokaActive = (l: Source, now: number): boolean => {
  const t = pick(l)?.toloka;
  return !!t && now < t.until;
};

// Game minute of the end of work on the day of `now`.
export const workEndAt = (now: number, l?: Source): number => dayStart(now) + workHours(l).end * 60;
