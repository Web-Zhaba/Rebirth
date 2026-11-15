import { L } from "../../i18n";
import type { BuildingRules } from "../types";

export const fisher: BuildingRules = {
  id: "fisher",
  name: L("Рыболовный причал", "Fishing pier"),
  zone: "placed",
  group: "food",
  lot: { w: 1, d: 1 },
  size: { along: 6, deep: 6, height: 3 },
  labor: 70,
  crew: 4,
  materials: { logs: 10, planks: 2, stone: 0 },
  job: L("рыбак", "fisher"),
  firstBuilt: L("Построен первый рыболовный причал", "The first fishing pier is built"),
  reach: 100,
  needs: { water: 0.05 },
};
