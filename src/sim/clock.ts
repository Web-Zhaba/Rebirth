import { dailyServices } from "./coverage";
import { advanceBuildings, spawnBuildings } from "./growth";
import { builderCount, dailyStep, productionScale } from "./people";
import { dailyEconomy, payMaterials, produceStep } from "./production";
import { spendOnRoads, WORK_END, WORK_START } from "./roads";
import { calendar, dayOf, START_MINUTE_OF_DAY } from "./time";
import type { SimState } from "./types";

export { START_MINUTE_OF_DAY };

// 1 real second = 1 game minute.
export const MS_PER_GAME_MINUTE = 1000;
export const BASE_TICK = 10; // game minutes
export const TICK_MS = BASE_TICK * MS_PER_GAME_MINUTE;
export const OFFLINE_CAP = 24 * 3600 * 1000; // real ms
export { calendar, DAYS_PER_SEASON, type Calendar } from "./time";

export function step(s: SimState): SimState {
  const hour = calendar(s.gameMinutes).hour;
  const working = hour >= WORK_START && hour < WORK_END;
  let roads = s.roads;
  let buildings = s.buildings;
  let stock = s.stock;
  if (working) {
    // The artel (every adult without a regular job): roads first, whatever hands are left go to buildings,
    // which take their materials from the stock when work on them starts.
    const r = spendOnRoads(s.roads, (builderCount(s) * BASE_TICK) / 60);
    roads = r.roads;
    const paid = payMaterials(s.buildings, s.stock, r.left);
    buildings = advanceBuildings(paid.buildings, r.left);
    stock = paid.stock;
  }
  let cur: SimState = { ...s, roads, buildings, stock };
  if (working) cur = produceStep(cur, BASE_TICK / 60, productionScale(s));
  let next: SimState = { ...cur, realTime: s.realTime + TICK_MS, gameMinutes: s.gameMinutes + BASE_TICK };
  if (dayOf(next.gameMinutes) !== dayOf(s.gameMinutes)) next = dailyServices(dailyStep(dailyEconomy(next))); // a tick crossed 00:00
  return spawnBuildings(next);
}

// Caps the gap to `cap` real ms, then runs whole ticks up to `now`.
export function advanceTo(s: SimState, now: number, cap = OFFLINE_CAP): SimState {
  let cur = s;
  if (now - cur.realTime > cap) cur = { ...cur, realTime: now - cap };
  while (cur.realTime + TICK_MS <= now) cur = step(cur);
  return cur;
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
