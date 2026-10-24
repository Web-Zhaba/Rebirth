export const START_MINUTE_OF_DAY = 6 * 60; // founding at 06:00 on day 1
export const DAY_MIN = 1440;
export const YEAR_MIN = 360 * DAY_MIN; // game minutes in a year (360 days)

// Index of the game day containing `gameMinutes` (days roll over at 00:00).
export const dayOf = (gameMinutes: number): number => Math.floor((Math.floor(gameMinutes) + START_MINUTE_OF_DAY) / DAY_MIN);
// Game minutes of the 00:00 that starts the day containing `gameMinutes`.
export const dayStart = (gameMinutes: number): number => dayOf(gameMinutes) * DAY_MIN - START_MINUTE_OF_DAY;
