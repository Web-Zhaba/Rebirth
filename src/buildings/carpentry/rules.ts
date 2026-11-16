import { L } from "../../i18n";
import type { BuildingRules } from "../types";
import { workshopWeather } from "../workshop";

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
  job: L("столяр — Столярная мастерская", "carpenter — Carpentry workshop"),
  firstBuilt: L("Построена первая столярная мастерская", "The first carpentry workshop is built"),
  usesTools: true,
  // pieces of furnishings, each taking planks (m3)
  produce: { good: "furniture", perHour: 0.015, input: { good: "planks", per: 0.03, missing: L("доски", "planks") } },
  weather: workshopWeather,
};
