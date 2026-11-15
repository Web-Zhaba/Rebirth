import { L } from "../../i18n";
import type { BuildingRules } from "../types";

// An old building kept as a monument, one of the purposes of an old foundation: no jobs, no residents; its
// shape, size and cost come from the foundation it stands on.
export const restored: BuildingRules = {
  id: "restored",
  name: L("Памятник", "Monument"),
  zone: "placed",
  group: null,
  lot: { w: 1, d: 1 },
  size: { along: 8, deep: 8, height: 8 },
  labor: 50,
  crew: 0,
  materials: { logs: 6, planks: 1.5, stone: 4 },
};
