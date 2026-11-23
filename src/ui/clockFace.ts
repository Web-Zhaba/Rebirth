import { calendar } from "../sim/clock";
import { dayPhase, pad, type DayPhase } from "./topbarModel";

// What the top bar's clock shows for one game minute. Pure, so the format it used to build inline stays pinned by a
// test: the minute no longer re-renders the whole bar, but its text must not change with that (perf/reports/ui.md, the clock).
export interface ClockFace {
  time: string; // "07:05", two digits either side
  needle: number; // 0..100, where the minute sits in the day: the ruler's needle
  phase: DayPhase; // morning, day, evening, night
  year: number;
  season: number; // 0 spring .. 3 winter
  dayOfSeason: number; // 1..DAYS_PER_SEASON
}

export function clockFace(gameMinutes: number): ClockFace {
  const c = calendar(gameMinutes);
  return {
    time: `${pad(c.hour)}:${pad(c.minute)}`,
    needle: ((c.hour * 60 + c.minute) / 1440) * 100,
    phase: dayPhase(c.hour),
    year: c.year,
    season: c.season,
    dayOfSeason: c.dayOfSeason,
  };
}
