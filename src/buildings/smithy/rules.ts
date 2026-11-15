import { L } from "../../i18n";
import type { BuildingRules } from "../types";
import { workshopWeather } from "../workshop";

export const smithy: BuildingRules = {
  id: "smithy",
  name: L("Кузница", "Smithy"),
  zone: "craft",
  group: "crafts",
  lot: { w: 2, d: 2 },
  size: { along: 10, deep: 8, height: 5 },
  labor: 160,
  crew: 6,
  materials: { logs: 18, planks: 2, stone: 9 },
  job: L("кузнец — Кузница", "smith — Smithy"),
  firstBuilt: L("Построена первая кузница", "The first smithy is built"),
  // pieces of tools, each taking logs for charcoal (m3)
  produce: { good: "tools", perHour: 0.015, input: { good: "logs", per: 0.05, missing: L("брёвна (на уголь)", "logs (for charcoal)") } },
  weather: workshopWeather,
  oldKinds: ["car_repair"], // old buildings of these kinds come back as it
};
