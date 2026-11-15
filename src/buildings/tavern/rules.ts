import { L } from "../../i18n";
import type { BuildingRules } from "../types";

export const tavern: BuildingRules = {
  id: "tavern",
  name: L("Таверна", "Tavern"),
  zone: "trade",
  group: "trade",
  lot: { w: 3, d: 3 },
  size: { along: 16, deep: 12, height: 8 },
  labor: 330,
  crew: 8,
  materials: { logs: 130, planks: 15, stone: 12 },
};
