import { advanceConstruction, WORKERS, WORK_END, WORK_START } from "./roads";
import type { SimState } from "./types";

// 1 real second = 1 game minute.
export const MS_PER_GAME_MINUTE = 1000;
export const BASE_TICK = 10; // game minutes
export const TICK_MS = BASE_TICK * MS_PER_GAME_MINUTE;
export const OFFLINE_CAP = 24 * 3600 * 1000; // real ms
export const START_MINUTE_OF_DAY = 6 * 60; // founding at 06:00 on day 1
export const DAYS_PER_SEASON = 90;

export function step(s: SimState): SimState {
  const hour = calendar(s.gameMinutes).hour;
  const working = hour >= WORK_START && hour < WORK_END;
  const roads = working ? advanceConstruction(s.roads, (WORKERS * BASE_TICK) / 60) : s.roads;
  return { realTime: s.realTime + TICK_MS, gameMinutes: s.gameMinutes + BASE_TICK, roads };
}

// Caps the gap to `cap` real ms, then runs whole ticks up to `now`.
export function advanceTo(s: SimState, now: number, cap = OFFLINE_CAP): SimState {
  let cur = s;
  if (now - cur.realTime > cap) cur = { ...cur, realTime: now - cap };
  while (cur.realTime + TICK_MS <= now) cur = step(cur);
  return cur;
}

export interface Calendar {
  year: number;
  season: number; // 0 spring .. 3 winter
  dayOfSeason: number; // 1..90
  dayOfYear: number; // 1..360
  hour: number;
  minute: number;
}

export function calendar(gameMinutes: number): Calendar {
  const total = Math.floor(gameMinutes) + START_MINUTE_OF_DAY;
  const day = Math.floor(total / 1440);
  const minOfDay = total - day * 1440;
  const dayInYear = day % (DAYS_PER_SEASON * 4);
  return {
    year: Math.floor(day / (DAYS_PER_SEASON * 4)) + 1,
    season: Math.floor(dayInYear / DAYS_PER_SEASON),
    dayOfSeason: (dayInYear % DAYS_PER_SEASON) + 1,
    dayOfYear: dayInYear + 1,
    hour: Math.floor(minOfDay / 60),
    minute: minOfDay % 60,
  };
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// 0 (night) .. 1 (day); dawn 5-7, dusk 19-21.
export function daylight(hour: number): number {
  const h = ((hour % 24) + 24) % 24;
  return smooth(5, 7, h) * (1 - smooth(19, 21, h));
}
