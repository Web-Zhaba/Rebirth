import { L } from "../../i18n";
import type { BuildingRules } from "../types";

export const woodcutter: BuildingRules = {
  id: "woodcutter",
  name: L("Лесозаготовка", "Woodcutter"),
  zone: "placed",
  group: "materials",
  lot: { w: 1, d: 1 },
  size: { along: 7, deep: 6, height: 3 },
  labor: 45,
  crew: 5,
  materials: { logs: 10, planks: 1, stone: 0 },
};
