import { L } from "../../i18n";
import type { BuildingRules } from "../types";

export const carpentry: BuildingRules = {
  id: "carpentry",
  name: L("Столярная мастерская", "Carpentry workshop"),
  zone: "craft",
  group: "crafts",
  lot: { w: 2, d: 3 },
  size: { along: 12, deep: 9, height: 6 },
  labor: 190,
  crew: 8,
  materials: { logs: 38, planks: 5, stone: 3 },
};
