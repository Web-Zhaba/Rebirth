import { L } from "../../i18n";
import type { BuildingRules } from "../types";

export const fisher: BuildingRules = {
  id: "fisher",
  name: L("Рыболовный причал", "Fishing pier"),
  zone: "placed",
  group: "food",
  lot: { w: 1, d: 1 },
  size: { along: 6, deep: 6, height: 3 },
  labor: 70,
  crew: 4,
  materials: { logs: 10, planks: 2, stone: 0 },
};
