import { L } from "../../i18n";
import type { BuildingRules } from "../types";

export const sawpit: BuildingRules = {
  id: "sawpit",
  name: L("Лесопилка", "Sawmill"),
  zone: "placed",
  group: "materials",
  lot: { w: 1, d: 1 },
  size: { along: 7, deep: 6, height: 4 },
  labor: 55,
  crew: 4,
  materials: { logs: 9, planks: 2, stone: 0 },
};
