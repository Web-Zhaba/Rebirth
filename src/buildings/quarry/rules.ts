import { L } from "../../i18n";
import type { BuildingRules } from "../types";

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
};
