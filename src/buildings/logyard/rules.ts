import { L } from "../../i18n";
import type { BuildingRules } from "../types";

// A store of logs and planks: a variant of the storehouse tool.
export const logyard: BuildingRules = {
  id: "logyard",
  name: L("Склад леса", "Timber yard"),
  zone: "placed",
  group: "services",
  lot: { w: 2, d: 2 },
  size: { along: 12, deep: 10, height: 4 },
  labor: 90,
  crew: 0,
  materials: { logs: 14, planks: 2, stone: 0 },
};
