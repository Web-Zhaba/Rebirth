import { L } from "../../i18n";
import type { BuildingRules } from "../types";

export const school: BuildingRules = {
  id: "school",
  name: L("Школа", "School"),
  zone: "placed",
  group: "services",
  lot: { w: 2, d: 2 },
  size: { along: 10, deep: 12, height: 6 },
  labor: 150,
  crew: 2,
  materials: { logs: 40, planks: 5, stone: 3 },
};
