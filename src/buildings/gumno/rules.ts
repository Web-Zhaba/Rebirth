import { L } from "../../i18n";
import type { BuildingRules } from "../types";
import { fieldWork } from "../../sim/weatherSigns";

export const gumno: BuildingRules = {
  id: "gumno",
  name: L("Ферма", "Farm"),
  zone: "placed",
  group: "food",
  lot: { w: 2, d: 2 },
  size: { along: 12, deep: 14, height: 7 },
  labor: 70,
  crew: 0,
  materials: { logs: 24, planks: 3, stone: 3 },
  job: L("фермер — Ферма", "farmer — Farm"),
  firstBuilt: L("Построена первая ферма", "The first farm is built"),
  sizeClass: "store",
  usesTools: true,
  reach: 400, // m from the lot centre to the centroid of a field it works (sim/fields.ts)
  produce: { good: "food", fromFields: true },
  weather: fieldWork,
};
