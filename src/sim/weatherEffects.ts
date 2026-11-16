import type { WeatherState } from "./weather";
import { BUILDINGS } from "./buildings";
import { heavy, rainy, SIGNS, stormy } from "./weatherSigns";

export { fieldWork } from "./weatherSigns";

// What the weather does to work, food and people. Pure factor functions; every number is in EFFECTS (the plain signs
// of the weather come from sim/weatherSigns.ts; each workplace's own weather is in its rules,
// src/buildings/<id>/rules.ts). The calm state (no site: tests, old saves) gives exactly 1 everywhere and no fuel, no
// spoilage.

export const EFFECTS = {
  ...SIGNS,
  // the year of an orchard: frost nights in spring (blossom), a dry or hot summer
  orchardYear: { frostBelow: -1, frostNights: 3, cutMin: 0.4, cutMax: 0.8, cutPerNight: 0.1, droughtCut: 0.5, droughtSoil: 0.35, hotCut: 0.05, hotCutMax: 0.3 },
  // brushwood: m3 a day per idle adult, the share of it under snow
  brush: { m3: 0.03, snow: 0.4 },
  cellarHeat: 0.9, // share of the heat spoilage a cellar removes (a barn: 0.5)
  build: { rain: 0.6, heavy: 0.3, snow: 0.5, storm: 0.3, cold: 0.4, coldBelow: -15, hot: 0.8, thaw: 0.7 },
  // firewood: m³ per household per real year, spread over the heating degree-days of a real year (base 12 °C)
  firewoodYear: 10,
  hddBase: 12,
  hddRef: 2500,
  unheatedMood: -12,
  unheatedDeath: 0.04, // death rate +4 % per °C below zero, at most x2
  unheatedDeathMax: 2,
  foodCold: 0.01, // food need +1 % per °C below 10, at most +30 %
  foodColdMax: 0.3,
  foodColdBase: 10,
  spoilHeat: 0.0005, // share of the food a day per °C above 15 (x (0.5 + soil moisture)); barns halve it
  spoilHeatBase: 15,
  spoilWet: 0.001, // share a day outside the barns after a day of heavy rain
  wetDayMm: 12,
  rotReport: 20, // kg of spoiled food that is worth a line when the weather spoils it
  mood: { storm: -4, extreme: -4, mild: 2, hotAllDay: 26, coldAllDay: -12, mildFrom: 8, mildTo: 24 },
  frostFrom: -2, // °C, a night colder than this takes grain (see applyFrost)
  frostSown: 0.2, // share of the fields sown from which a frost matters
};

const E = EFFECTS;
const meanOf = (w: WeatherState) => (w.yesterday.min + w.yesterday.max) / 2;

// Share of the hours a workplace of `template` works today (multiplies the season tables).
export function workFactor(template: string, w: WeatherState): number {
  if (!w.site) return 1;
  return BUILDINGS[template]?.weather?.(w) ?? 1;
}

// Share of the artel's person-hours and of its crew size that rain, cold and storms leave.
export function buildFactor(w: WeatherState): number {
  if (!w.site) return 1;
  const B = E.build;
  const t = w.now.temp;
  let f = 1;
  if (heavy(w)) f *= B.heavy;
  else if (rainy(w)) f *= B.rain;
  else if (w.now.snow && w.now.precip > 0) f *= B.snow;
  if (stormy(w)) f *= B.storm;
  if (t < B.coldBelow) f *= B.cold;
  else if (t > E.hot) f *= B.hot;
  if (t > 0 && t < 4 && w.soil > 0.8) f *= B.thaw; // thaw mud on the roads
  return f;
}

// m³ of firewood a household burns per day: by the heating degree-days of the day that ended.
export function firewoodDaily(w: WeatherState): number {
  if (!w.site) return 0;
  return (E.firewoodYear * Math.max(0, E.hddBase - meanOf(w))) / E.hddRef; // the year-scale of both sides cancels
}

// Food need x this (cold burns energy).
export function foodNeedFactor(w?: WeatherState): number {
  if (!w?.site) return 1;
  return 1 + Math.min(E.foodColdMax, E.foodCold * Math.max(0, E.foodColdBase - meanOf(w)));
}

// Share of the food stock that spoils today. `sheltered` is the share of it that lies in barns, `cellar` the share in
// cellars (0..1 together).
export function spoilage(w: WeatherState, sheltered: number, cellar = 0): number {
  if (!w.site) return 0;
  const heat = E.spoilHeat * Math.max(0, meanOf(w) - E.spoilHeatBase) * (0.5 + w.soil);
  const wet = w.yesterday.rain > E.wetDayMm ? E.spoilWet : 0;
  return heat * (1 - 0.5 * sheltered - E.cellarHeat * cellar) + wet * (1 - sheltered - cellar);
}

// What the orchard's year has met so far (ProdState.orchard): spring frost nights, summer days with their drought
// stress and heat days. Counted once a day by `orchardDay`.
export interface OrchardYear {
  year: number;
  frost: number; // spring nights below the limit
  stress: number; // summed daily drought stress in summer
  days: number; // summer days counted
  hot: number; // summer days above the heat limit
}
export const emptyOrchard = (year = 1): OrchardYear => ({ year, frost: 0, stress: 0, days: 0, hot: 0 });

// Counts the day that ended (`season` is its season: 0 spring, 1 summer) into the year's record.
export function orchardDay(o: OrchardYear, w: WeatherState, year: number, season: number): OrchardYear {
  if (!w.site) return o;
  const cur = o.year === year ? o : emptyOrchard(year);
  const Y = E.orchardYear;
  if (season === 0 && w.yesterday.min < Y.frostBelow) return { ...cur, frost: cur.frost + 1 };
  if (season === 1) return { ...cur, days: cur.days + 1, stress: cur.stress + Math.max(0, 1 - w.soil / Y.droughtSoil), hot: cur.hot + (w.yesterday.max > E.hot ? 1 : 0) };
  return cur;
}

// Share of the orchard's full yield the year allows: frost at the blossom, drought, heat. 1 in the calm state.
export function orchardQuality(o: OrchardYear): number {
  const Y = E.orchardYear;
  const frost = o.frost >= Y.frostNights ? 1 - Math.min(Y.cutMax, Y.cutMin + Y.cutPerNight * (o.frost - Y.frostNights)) : 1;
  const water = 1 - (o.days > 0 ? Y.droughtCut * (o.stress / o.days) : 0);
  const heat = 1 - Math.min(Y.hotCutMax, Y.hotCut * o.hot);
  return frost * water * heat;
}

// Shift of every household's mood target for the day that ended (storm now, a whole day of heat or cold, a clear mild day).
export function moodShift(w: WeatherState): number {
  if (!w.site) return 0;
  const M = E.mood;
  const mean = meanOf(w);
  if (stormy(w) || w.yesterday.min > M.hotAllDay || w.yesterday.max < M.coldAllDay) return M.storm;
  return w.yesterday.rain < 0.5 && w.now.cloud < 0.4 && mean >= M.mildFrom && mean <= M.mildTo ? M.mild : 0;
}

// Death-rate multiplier of a household without fuel.
export function mortalityFactor(w: WeatherState, unheated: boolean | undefined): number {
  if (!w.site || !unheated) return 1;
  return Math.min(E.unheatedDeathMax, 1 + E.unheatedDeath * Math.max(0, -meanOf(w)));
}

// A frost that the fields feel (the caller checks the window): the night minimum is below the limit.
export const frostNight = (w: WeatherState): boolean => !!w.site && w.yesterday.min < E.frostFrom;
