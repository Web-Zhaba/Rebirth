import { recordChronicle } from "./chronicle";
import { dailyServices } from "./coverage";
import { allocateClearings, clearingsFirst, CREW } from "./buildings";
import { advanceBuildings, advanceClearings, reportBuilt, spawnBuildings } from "./growth";
import { builderCount, dailyStep, immigrationStep, productionScale } from "./people";
import { EVENING, eveningStep, isEvening } from "./evening";
import { goalStep } from "./goals";
import { settleLevers } from "./leverCmds";
import { daySummary } from "./summary";
import { dailyEconomy, payMaterials, produceStep, reportShortages } from "./production";
import { isWorkHour, tolokaActive, workHours, type Levers } from "./levers";
import { spendOnRoads } from "./roads";
import { calendar, dayOf, START_MINUTE_OF_DAY } from "./time";
import type { SimState } from "./types";

export { START_MINUTE_OF_DAY };

export const BASE_TICK = 10; // game minutes
export const LIVE_MS_PER_GAME_MINUTE = 250; // live play at 1x: 1 real second = 4 game minutes
export const OFFLINE_MS_PER_GAME_MINUTE = 1000; // catch-up: 1 real second = 1 game minute
export const TICK_MS = BASE_TICK * OFFLINE_MS_PER_GAME_MINUTE; // one tick of a catch-up, real ms
export const OFFLINE_CAP = 24 * 3600 * 1000; // real ms
export const NIGHT_BOOST = 4; // live play runs this much faster at night
const NIGHT_START = 22;
const NIGHT_END = 5;
export { calendar, DAYS_PER_SEASON, type Calendar } from "./time";

export type Speed = 0 | 1 | 2 | 4;
// How wall time is spent: the chosen speed (0 = paused), or the fixed catch-up rate.
export interface Pace {
  speed: Speed;
  offline: boolean;
}
export const OFFLINE: Pace = { speed: 1, offline: true };

export const isNight = (gameMinutes: number): boolean => {
  const h = calendar(gameMinutes).hour;
  return h >= NIGHT_START || h < NIGHT_END;
};

// Real ms that the tick starting at `gameMinutes` costs; Infinity while paused. Offline ignores speed and night.
export function tickMs(gameMinutes: number, pace: Pace): number {
  if (pace.speed === 0) return Infinity;
  if (pace.offline) return TICK_MS;
  return (BASE_TICK * LIVE_MS_PER_GAME_MINUTE) / (pace.speed * (isNight(gameMinutes) ? NIGHT_BOOST : 1));
}

// The game clock interpolated between snapshots (live play), never past the next tick.
export function clockAt(gameMinutes: number, realTime: number, now: number, speed: Speed): number {
  if (speed === 0) return gameMinutes;
  const msPerMinute = tickMs(gameMinutes, { speed, offline: false }) / BASE_TICK;
  return gameMinutes + Math.min(Math.max(0, (now - realTime) / msPerMinute), BASE_TICK - 0.001);
}

// «начнут в 07:00» while the artel is off work (evening, night, early morning), else null; for queued roads and sites.
export function queuedLabel(gameMinutes: number, levers?: Levers): string | null {
  const h = calendar(gameMinutes).hour;
  return isWorkHour(h, levers) ? null : `начнут в ${String(workHours(levers).start).padStart(2, "0")}:00`;
}

export function step(s: SimState): SimState {
  const hour = calendar(s.gameMinutes).hour;
  const working = isWorkHour(hour, s.levers);
  let roads = s.roads;
  let buildings = s.buildings;
  let stock = s.stock;
  let events = s.events;
  let clearUse = new Map<number, number>();
  if (working) {
    // The artel (every adult without a regular job): roads first; the hands left go to buildings, which take their
    // materials from the stock when work on them starts, and to forest clearings, ahead of the buildings when logs run short.
    // On a толока every hand goes to its site, none to the roads.
    const toloka = tolokaActive(s.levers, s.gameMinutes);
    const hours = (builderCount(s) * BASE_TICK) / 60;
    const r = toloka ? { roads: s.roads, left: hours } : spendOnRoads(s.roads, hours);
    roads = r.roads;
    const lever = { priority: s.levers.priority, focus: toloka ? s.levers.toloka!.site : null };
    const crew = (CREW * BASE_TICK) / 60; // person-hours of one crew in a tick
    const first = clearingsFirst(s.stock);
    const paid = payMaterials(s.buildings, s.stock, r.left, s.finds.foundations, crew, s.clearings, first, lever);
    clearUse = allocateClearings(paid.buildings, s.clearings, r.left, crew, first, lever);
    buildings = advanceBuildings(paid.buildings, r.left, crew, s.clearings, first, lever);
    stock = paid.stock;
    events = reportShortages(s.buildings, paid.buildings, s.stock, events, s.gameMinutes);
    events = reportBuilt(s.buildings, buildings, events, s.gameMinutes);
  }
  let cur: SimState = advanceClearings({ ...s, roads, buildings, stock, events }, clearUse);
  if (working) cur = produceStep(cur, BASE_TICK / 60, productionScale(s));
  else if (isEvening(hour, s.levers)) cur = eveningStep(cur, BASE_TICK / 60);
  let next: SimState = { ...cur, gameMinutes: s.gameMinutes + BASE_TICK };
  if (calendar(next.gameMinutes).hour === EVENING.to && hour !== EVENING.to) next = { ...next, summary: daySummary(next) }; // a tick crossed 22:00
  if (dayOf(next.gameMinutes) !== dayOf(s.gameMinutes)) next = dailyServices(dailyStep(dailyEconomy(next))); // a tick crossed 00:00
  return recordChronicle(s, settleLevers(spawnBuildings(goalStep(s, immigrationStep(next, BASE_TICK)))));
}

// Moves the simulated time up so that at most `cap` real ms are left to catch up on.
export const capGap = (s: SimState, now: number, cap = OFFLINE_CAP): SimState => (now - s.realTime > cap ? { ...s, realTime: now - cap } : s);

// Caps the gap to `cap` real ms, then spends wall time up to `now` on whole ticks at `pace`; paused, wall time is
// simply dropped. `onStep` sees every tick (prev, next).
export function advanceTo(s: SimState, now: number, pace: Pace = OFFLINE, cap = OFFLINE_CAP, onStep?: (prev: SimState, next: SimState) => void): SimState {
  let cur = capGap(s, now, cap);
  if (pace.speed === 0) return cur.realTime < now ? { ...cur, realTime: now } : cur;
  for (let ms = tickMs(cur.gameMinutes, pace); cur.realTime + ms <= now; ms = tickMs(cur.gameMinutes, pace)) {
    const next = { ...step(cur), realTime: cur.realTime + ms };
    onStep?.(cur, next);
    cur = next;
  }
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
