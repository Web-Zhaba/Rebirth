import { L } from "../../i18n";
import type { BuildingRules } from "../types";

// Alternative food (sim/fields.ts FOOD_RATE): fruit trees.
export const orchard: BuildingRules = {
  id: "orchard",
  name: L("Сад", "Orchard"),
  zone: "placed",
  group: "food",
  lot: { w: 2, d: 3 },
  size: { along: 15, deep: 20, height: 3 },
  labor: 100,
  crew: 4,
  materials: { logs: 7, planks: 1, stone: 0 },
  job: L("садовник — Сад", "gardener — Orchard"),
  firstBuilt: L("Заложен первый сад", "The first orchard is planted"),
  dryLand: true,
};
