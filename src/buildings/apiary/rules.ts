import { L } from "../../i18n";
import type { BuildingRules } from "../types";

// Alternative food (sim/fields.ts FOOD_RATE): bees.
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
};
