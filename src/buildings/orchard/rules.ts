import { L } from "../../i18n";
import type { BuildingRules } from "../types";
import { rainy, stormy } from "../../sim/weatherSigns";

// Weather: picking in the wet and in a storm goes slower.
const W = { rain: 0.7, storm: 0.5 };

// Alternative food: fruit trees.
export const orchard: BuildingRules = {
  id: "orchard",
  name: L("Сад", "Orchard"),
  zone: "placed",
  group: "food",
  lot: { w: 2, d: 3 },
  size: { along: 15, deep: 20, height: 3 },
  labor: 100,
  crew: 4,
  materials: { logs: 7, planks: 1, stone: 0 },
  job: L("садовник — Сад", "gardener — Orchard"),
  firstBuilt: L("Заложен первый сад", "The first orchard is planted"),
  dryLand: true,
  // kg; a bearing orchard feeds 5-7 adults a year, scaled by the year's quality (sim/weatherEffects.ts orchardQuality)
  produce: { good: "food", perHour: 0.8, season: [0, 0, 1, 0], ripens: true },
  weather: (w) => (stormy(w) ? W.storm : 1) * (rainy(w) ? W.rain : 1),
};
