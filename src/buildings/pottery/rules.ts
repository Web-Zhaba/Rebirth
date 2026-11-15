import { L } from "../../i18n";
import type { BuildingRules } from "../types";

export const pottery: BuildingRules = {
  id: "pottery",
  name: L("Гончарня", "Pottery"),
  zone: "craft",
  group: "crafts",
  lot: { w: 2, d: 2 },
  size: { along: 10, deep: 8, height: 5 },
  labor: 130,
  crew: 6,
  materials: { logs: 18, planks: 2, stone: 7 },
  job: L("гончар — Гончарня", "potter — Pottery"),
  firstBuilt: L("Построена первая гончарня", "The first pottery is built"),
  usesTools: true,
};
