import { L } from "../../i18n";
import type { BuildingRules } from "../types";
import { rainy, stormy } from "../../sim/weatherSigns";

// Weather: bees fly only on warm, dry, calm days.
const W = { coldBelow: 10, wind: 8 };

// Alternative food: bees.
export const apiary: BuildingRules = {
  id: "apiary",
  name: L("Пасека", "Apiary"),
  zone: "placed",
  group: "food",
  lot: { w: 1, d: 1 },
  size: { along: 7, deep: 6, height: 2 },
  labor: 50,
  crew: 3,
  materials: { logs: 5, planks: 2, stone: 0 },
  job: L("пасечник", "beekeeper"),
  firstBuilt: L("Поставлена первая пасека", "The first apiary is set up"),
  dryLand: true,
  // kg of food equivalent of the honey (an apiary feeds 1-2 adults a year); the weather decides most of it
  produce: { good: "food", perHour: 0.3, season: [0.3, 1, 0.7, 0] },
  weather: (w) => (w.now.temp < W.coldBelow || rainy(w) || w.now.snow || stormy(w) || w.now.wind > W.wind ? 0 : 1),
  openGround: true, // never on an old foundation
  outdoors: true, // worked in the open: the workers show on the plot
};
