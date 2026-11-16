import { L } from "../../i18n";
import type { BuildingRules } from "../types";
import { heavy, rainy, SIGNS } from "../../sim/weatherSigns";

// Weather: rain (heavy rain most), hard frost and deep snow slow the quarrying.
const W = { heavy: 0.35, light: 0.7, cold: 0.5, coldBelow: -15, deepSnow: 0.4 };

export const quarry: BuildingRules = {
  id: "quarry",
  name: L("Карьер", "Quarry"),
  zone: "placed",
  group: "materials",
  lot: { w: 2, d: 2 },
  size: { along: 14, deep: 14, height: 3 },
  labor: 120,
  crew: 8,
  materials: { logs: 7, planks: 1, stone: 0 },
  job: L("рабочий карьера", "quarry worker"),
  firstBuilt: L("Построен первый карьер", "The first quarry is opened"),
  usesTools: true,
  dryLand: true,
  produce: { good: "stone", perHour: 0.15, pace: true }, // t; a quarry works on any land (rock nearby changes nothing)
  weather: (w) => (heavy(w) ? W.heavy : rainy(w) ? W.light : 1) * (w.now.temp < W.coldBelow ? W.cold : 1) * (w.snowpack > SIGNS.deepSnow ? W.deepSnow : 1),
  openGround: true, // never on an old foundation
  outdoors: true, // worked in the open: the workers show on the plot
};
