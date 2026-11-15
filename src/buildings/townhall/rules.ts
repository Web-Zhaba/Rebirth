import { L } from "../../i18n";
import type { BuildingRules } from "../types";

// Administration (sim/governance.ts): clerks who manage the town; a kind of the administration tool, one per town.
export const townhall: BuildingRules = {
  id: "townhall",
  name: L("Ратуша", "Town hall"),
  zone: "placed",
  group: "services",
  lot: { w: 2, d: 3 },
  size: { along: 14, deep: 12, height: 9 },
  labor: 300,
  crew: 4,
  materials: { logs: 60, planks: 12, stone: 15 },
  sizeClass: "hall",
  onePerTown: L("Ратуша уже есть: управление расширяют районные управы", "There is a town hall already: district offices extend the administration"),
};
