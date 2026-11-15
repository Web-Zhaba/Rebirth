import { L } from "../../i18n";
import type { BuildingRules } from "../types";

// Food without fields (sim/fields.ts FOOD_RATE): a hunter's hut.
export const hunter: BuildingRules = {
  id: "hunter",
  name: L("Охотничий пост", "Hunting post"),
  zone: "placed",
  group: "food",
  lot: { w: 1, d: 1 },
  size: { along: 6, deep: 6, height: 3 },
  labor: 50,
  crew: 4,
  materials: { logs: 7, planks: 2, stone: 0 },
};
