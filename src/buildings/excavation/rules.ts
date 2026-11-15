import { L } from "../../i18n";
import type { BuildingRules } from "../types";

// Digging one surveyed outline (sim/digging.ts): a site of the artel on the old ring, gone once it is dug; 8
// person-hours per 100 m2.
export const excavation: BuildingRules = {
  id: "excavation",
  name: L("Раскопки фундамента", "Foundation dig"),
  zone: "placed",
  group: null,
  lot: { w: 1, d: 1 },
  size: { along: 10, deep: 10, height: 0.5 },
  labor: 8,
  crew: 0,
  materials: { logs: 0, planks: 0, stone: 0 },
  workSite: true, // a work site on an old foundation, not a building on it (sim/digging.ts): drawn on the ruins layer
};
