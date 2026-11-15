import { L } from "../../i18n";
import type { BuildingRules } from "../types";

export const well: BuildingRules = {
  id: "well",
  name: L("Колодец", "Well"),
  zone: "placed",
  group: "services",
  lot: { w: 1, d: 1 },
  size: { along: 2, deep: 2, height: 2 },
  labor: 30,
  crew: 0,
  materials: { logs: 2, planks: 0.5, stone: 3 },
};
