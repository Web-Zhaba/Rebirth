import { L } from "../../i18n";
import type { BuildingRules } from "../types";
import { rainy, SIGNS, stormy } from "../../sim/weatherSigns";

// Weather: the wet forest and storms keep pickers home; snow cover stops it.
const W = { rain: 0.5, storm: 0.3 };

// Alternative food: picking berries, mushrooms and nuts in the forest.
export const forager: BuildingRules = {
  id: "forager",
  name: L("Сбор в лесу", "Forager"),
  zone: "placed",
  group: "food",
  lot: { w: 1, d: 1 },
  size: { along: 6, deep: 6, height: 2 },
  labor: 40,
  crew: 6,
  materials: { logs: 3, planks: 1, stone: 0 },
  job: L("собирает в лесу", "forages in the forest"),
  firstBuilt: L("Начат первый сбор в лесу", "Foraging in the forest begins"),
  reach: 150,
  needs: { forest: 0.2 },
  produce: { good: "food", perHour: 0.13, season: [0.3, 1, 1.4, 0] }, // kg; a staffed forager feeds about 4 adults a year
  weather: (w) => {
    if (w.snowpack > SIGNS.groundSnow) return 0;
    return stormy(w) ? W.storm : rainy(w) ? W.rain : 1;
  },
  openGround: true, // never on an old foundation
  outdoors: true, // worked in the open: the workers show on the plot
};
