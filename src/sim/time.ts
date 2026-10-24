export const START_MINUTE_OF_DAY = 6 * 60; // founding at 06:00 on day 1
export const DAY_MIN = 1440;
export const YEAR_MIN = 360 * DAY_MIN; // game minutes in a year (360 days)

// Index of the game day containing `gameMinutes` (days roll over at 00:00).
export const dayOf = (gameMinutes: number): number => Math.floor((Math.floor(gameMinutes) + START_MINUTE_OF_DAY) / DAY_MIN);
// Game minutes of the 00:00 that starts the day containing `gameMinutes`.
export const dayStart = (gameMinutes: number): number => dayOf(gameMinutes) * DAY_MIN - START_MINUTE_OF_DAY;

export const DAYS_PER_SEASON = 90;

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
