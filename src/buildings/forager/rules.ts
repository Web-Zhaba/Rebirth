import { L } from "../../i18n";
import type { BuildingRules } from "../types";

// Alternative food (sim/fields.ts FOOD_RATE): picking berries, mushrooms and nuts in the forest.
export const forager: BuildingRules = {
  id: "forager",
  name: L("Сбор в лесу", "Forager"),
  zone: "placed",
  group: "food",
  lot: { w: 1, d: 1 },
  size: { along: 6, deep: 6, height: 2 },
  labor: 40,
  crew: 6,
  materials: { logs: 3, planks: 1, stone: 0 },
  job: L("собирает в лесу", "forages in the forest"),
  firstBuilt: L("Начат первый сбор в лесу", "Foraging in the forest begins"),
  reach: 150,
  needs: { forest: 0.2 },
};
