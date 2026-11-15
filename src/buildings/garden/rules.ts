import { L } from "../../i18n";
import type { BuildingRules } from "../types";

// Food without fields (sim/fields.ts FOOD_RATE): a kitchen garden by the houses.
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
};
