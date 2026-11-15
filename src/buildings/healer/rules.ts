import { L } from "../../i18n";
import type { BuildingRules } from "../types";

export const healer: BuildingRules = {
  id: "healer",
  name: L("Лечебница", "Infirmary"),
  zone: "placed",
  group: "services",
  lot: { w: 1, d: 2 },
  size: { along: 8, deep: 8, height: 5 },
  labor: 80,
  crew: 1,
  materials: { logs: 14, planks: 2, stone: 1 },
};
