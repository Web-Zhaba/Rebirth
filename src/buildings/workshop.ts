import { SIGNS } from "../sim/weatherSigns";

// Shared by the rules of the four workshops (pottery, weaving, carpentry, smithy): hard frost and great heat slow the
// work indoors.
const W = { cold: 0.8, coldBelow: -10, hot: 0.85 };

export const workshopWeather = (w: { now: { temp: number } }): number => (w.now.temp < W.coldBelow ? W.cold : w.now.temp > SIGNS.hot ? W.hot : 1);
