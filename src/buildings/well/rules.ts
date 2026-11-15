import { L } from "../../i18n";
import type { BuildingRules } from "../types";

export const well: BuildingRules = {
  id: "well",
  name: L("Колодец", "Well"),
  zone: "placed",
  group: "services",
  lot: { w: 1, d: 1 },
  size: { along: 2, deep: 2, height: 2 },
  labor: 30,
  crew: 0,
  materials: { logs: 2, planks: 0.5, stone: 3 },
  job: L("работает у колодца", "works at the well"),
  firstBuilt: L("Построен первый колодец", "The first well is built"),
  service: { name: L("Вода", "Water"), reach: 150, mood: 8, color: "#4f86a8" },
  water: true, // a lost bucket goes back to a well (sim/items.ts)
};
