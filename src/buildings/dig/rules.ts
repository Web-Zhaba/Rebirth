import { L } from "../../i18n";
import type { BuildingRules } from "../types";

// Excavation: a dig that grows and finds the old town (sim/excavation.ts).
export const dig: BuildingRules = {
  id: "dig",
  name: L("Раскоп", "Dig"),
  zone: "placed",
  group: "services",
  lot: { w: 1, d: 1 },
  size: { along: 6, deep: 6, height: 1 },
  labor: 30,
  crew: 6,
  materials: { logs: 2, planks: 0.5, stone: 0 },
  job: L("землекоп — Раскоп", "digger — Dig"),
  firstBuilt: L("Заложен первый раскоп", "The first dig is opened"),
};
