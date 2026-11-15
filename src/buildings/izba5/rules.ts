import { L } from "../../i18n";
import type { BuildingRules } from "../types";

// A large house: two families from the start.
export const izba5: BuildingRules = {
  id: "izba5",
  name: L("Большой дом", "Large house"),
  zone: "res",
  group: null,
  lot: { w: 2, d: 4 },
  size: { along: 11, deep: 13, height: 7 },
  labor: 70,
  crew: 14,
  homes: 2,
  materials: { logs: 40, planks: 4, stone: 3 },
};
