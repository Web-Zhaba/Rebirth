import { L } from "../../i18n";
import type { BuildingRules } from "../types";
import { rainy, SIGNS, stormy } from "../../sim/weatherSigns";

// Weather: a storm keeps the fellers home, deep snow slows them, frozen ground under a little snow eases the hauling
// (sledges), a cold thaw rain stops most of the work.
const W = { storm: 0.3, deepSnow: 0.8, haul: 1.15, thaw: 0.6 };

export const woodcutter: BuildingRules = {
  id: "woodcutter",
  name: L("Лесозаготовка", "Woodcutter"),
  zone: "placed",
  group: "materials",
  lot: { w: 1, d: 1 },
  size: { along: 7, deep: 6, height: 3 },
  labor: 45,
  crew: 5,
  materials: { logs: 10, planks: 1, stone: 0 },
  job: L("лесоруб", "woodcutter"),
  firstBuilt: L("Построена первая лесозаготовка", "The first woodcutter is set up"),
  usesTools: true,
  reach: 150,
  needs: { forest: 0.1 },
  produce: { good: "logs", perHour: 0.4, pace: true, forest: true }, // m3 per worker-hour
  weather: (w) => {
    const t = w.now.temp;
    let f = 1;
    if (stormy(w)) f *= W.storm;
    if (w.snowpack > SIGNS.deepSnow) f *= W.deepSnow;
    else if (w.frozen > 0.5 && w.snowpack > SIGNS.groundSnow) f *= W.haul;
    if (t > 0 && t < 4 && rainy(w)) f *= W.thaw;
    return f;
  },
  openGround: true, // never on an old foundation
  outdoors: true, // worked in the open: the workers show on the plot
};
