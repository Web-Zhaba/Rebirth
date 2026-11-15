import { L } from "../../i18n";
import type { BuildingRules } from "../types";

// A museum: a purpose of any old foundation, its halls by floor area (sim/museum.ts).
export const museum: BuildingRules = {
  id: "museum",
  name: L("Музей", "Museum"),
  zone: "placed",
  group: "services",
  lot: { w: 2, d: 2 },
  size: { along: 10, deep: 10, height: 6 },
  labor: 140,
  crew: 2,
  materials: { logs: 30, planks: 6, stone: 4 },
};
