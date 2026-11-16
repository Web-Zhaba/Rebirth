import { L } from "../../i18n";
import type { BuildingRules } from "../types";
import { SIGNS } from "../../sim/weatherSigns";

// Weather: nothing grows in frost; drought and waterlogged beds cut the work.
const W = { frostBelow: -1, drought: 0.4, mud: 0.7 };

// Food without fields: a kitchen garden by the houses.
export const garden: BuildingRules = {
  id: "garden",
  name: L("Огород", "Vegetable garden"),
  zone: "placed",
  group: "food",
  lot: { w: 2, d: 2 },
  size: { along: 10, deep: 10, height: 1 },
  labor: 35,
  crew: 6,
  materials: { logs: 3, planks: 1, stone: 0 },
  job: L("работает в Огороде", "works in the Vegetable garden"),
  firstBuilt: L("Разбит первый огород", "The first vegetable garden is laid out"),
  dryLand: true,
  produce: { good: "food", perHour: 0.2, season: [1, 1, 1, 0] }, // kg; the beds lie fallow in winter
  weather: (w) => {
    if (w.now.temp < W.frostBelow) return 0;
    return (w.soil < SIGNS.drought ? W.drought : 1) * (w.soil > SIGNS.waterlogged ? W.mud : 1);
  },
  openGround: true, // never on an old foundation
  outdoors: true, // worked in the open: the workers show on the plot
};
