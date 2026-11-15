import { L } from "../../i18n";
import type { BuildingRules } from "../types";
import { rainy } from "../../sim/weatherSigns";

// Weather: hard frost and rain slow the sawing.
const W = { cold: 0.85, coldBelow: -20, rain: 0.9 };

export const sawpit: BuildingRules = {
  id: "sawpit",
  name: L("Лесопилка", "Sawmill"),
  zone: "placed",
  group: "materials",
  lot: { w: 1, d: 1 },
  size: { along: 7, deep: 6, height: 4 },
  labor: 55,
  crew: 4,
  materials: { logs: 9, planks: 2, stone: 0 },
  job: L("рабочий лесопилки", "sawmill worker"),
  firstBuilt: L("Построена первая лесопилка", "The first sawmill is built"),
  usesTools: true,
  produce: { good: "planks", perHour: 0.02, pace: true, input: { good: "logs", per: 1.6, missing: L("брёвна", "logs") } }, // m3
  weather: (w) => (w.now.temp < W.coldBelow ? W.cold : 1) * (rainy(w) ? W.rain : 1),
  openGround: true, // never on an old foundation
  outdoors: true, // worked in the open: the workers show on the plot
};
