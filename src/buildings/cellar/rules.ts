import { L } from "../../i18n";
import type { BuildingRules } from "../types";

// A cellar that keeps the food stock better than a barn.
export const cellar: BuildingRules = {
  id: "cellar",
  name: L("Погреб", "Cellar"),
  zone: "placed",
  group: "services",
  lot: { w: 1, d: 1 },
  size: { along: 6, deep: 6, height: 2 },
  labor: 110,
  crew: 0,
  materials: { logs: 16, planks: 5, stone: 6 },
};
