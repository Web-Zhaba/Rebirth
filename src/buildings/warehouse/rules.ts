import { L } from "../../i18n";
import type { BuildingRules } from "../types";

// A store of the goods: a variant of the storehouse tool.
export const warehouse: BuildingRules = {
  id: "warehouse",
  name: L("Товарный склад", "Warehouse"),
  zone: "placed",
  group: "services",
  lot: { w: 2, d: 2 },
  size: { along: 10, deep: 10, height: 6 },
  labor: 140,
  crew: 0,
  materials: { logs: 26, planks: 6, stone: 3 },
  store: { goods: 500 }, // pieces
  sizeClass: "store",
  oldKinds: ["wholesale"], // old buildings of these kinds come back as it
};
