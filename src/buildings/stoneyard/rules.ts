import { L } from "../../i18n";
import type { BuildingRules } from "../types";

// A store of stone: a variant of the storehouse tool.
export const stoneyard: BuildingRules = {
  id: "stoneyard",
  name: L("Склад камня", "Stone yard"),
  zone: "placed",
  group: "services",
  lot: { w: 2, d: 2 },
  size: { along: 12, deep: 12, height: 2 },
  labor: 70,
  crew: 0,
  materials: { logs: 6, planks: 1, stone: 2 },
};
