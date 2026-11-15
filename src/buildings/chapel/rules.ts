import { L } from "../../i18n";
import type { BuildingRules } from "../types";

export const chapel: BuildingRules = {
  id: "chapel",
  name: L("Храм", "Temple"),
  zone: "placed",
  group: "services",
  lot: { w: 1, d: 2 },
  size: { along: 7, deep: 12, height: 10 },
  labor: 180,
  crew: 1,
  materials: { logs: 35, planks: 4, stone: 6 },
};
