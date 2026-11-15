import { L } from "../../i18n";
import type { BuildingRules } from "../types";

// Administration (sim/governance.ts): a district office; a kind of the administration tool.
export const office: BuildingRules = {
  id: "office",
  name: L("Районная управа", "District office"),
  zone: "placed",
  group: "services",
  lot: { w: 2, d: 2 },
  size: { along: 10, deep: 10, height: 7 },
  labor: 160,
  crew: 2,
  materials: { logs: 30, planks: 6, stone: 6 },
  sizeClass: "hall",
};
