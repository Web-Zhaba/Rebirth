import { L } from "../../i18n";
import type { BuildingRules } from "../types";

export const market: BuildingRules = {
  id: "market",
  name: L("Рынок", "Market"),
  zone: "placed",
  group: "trade",
  lot: { w: 2, d: 3 },
  size: { along: 15, deep: 16, height: 5 },
  labor: 260,
  crew: 8,
  materials: { logs: 50, planks: 10, stone: 3 },
};
