import { L } from "../../i18n";
import type { BuildingRules } from "../types";

export const barn: BuildingRules = {
  id: "barn",
  name: L("Амбар", "Barn"),
  zone: "placed",
  group: "services",
  lot: { w: 2, d: 2 },
  size: { along: 12, deep: 10, height: 7 },
  labor: 160,
  crew: 0,
  materials: { logs: 32, planks: 10, stone: 3 },
};
