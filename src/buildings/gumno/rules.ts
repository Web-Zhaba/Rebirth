import { L } from "../../i18n";
import type { BuildingRules } from "../types";

export const gumno: BuildingRules = {
  id: "gumno",
  name: L("Ферма", "Farm"),
  zone: "placed",
  group: "food",
  lot: { w: 2, d: 2 },
  size: { along: 12, deep: 14, height: 7 },
  labor: 70,
  crew: 0,
  materials: { logs: 24, planks: 3, stone: 3 },
};
