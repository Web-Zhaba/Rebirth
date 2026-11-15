import { L } from "../../i18n";
import type { BuildingRules } from "../types";

export const weaver: BuildingRules = {
  id: "weaver",
  name: L("Ткацкая мастерская", "Weaving workshop"),
  zone: "craft",
  group: "crafts",
  lot: { w: 2, d: 2 },
  size: { along: 10, deep: 8, height: 5 },
  labor: 120,
  crew: 6,
  materials: { logs: 20, planks: 3, stone: 1 },
};
