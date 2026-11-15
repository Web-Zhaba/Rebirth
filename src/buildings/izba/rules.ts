import { L } from "../../i18n";
import type { BuildingRules } from "../types";

export const izba: BuildingRules = {
  id: "izba",
  name: L("Дом", "House"),
  zone: "res",
  group: null,
  lot: { w: 2, d: 3 },
  size: { along: 8, deep: 9, height: 5 },
  labor: 30,
  crew: 6,
  materials: { logs: 17, planks: 1.5, stone: 1 },
};
