import { L } from "../../i18n";
import type { BuildingRules } from "../types";

export const school: BuildingRules = {
  id: "school",
  name: L("Школа", "School"),
  zone: "placed",
  group: "services",
  lot: { w: 2, d: 2 },
  size: { along: 10, deep: 12, height: 6 },
  labor: 150,
  crew: 2,
  materials: { logs: 40, planks: 5, stone: 3 },
  job: L("учитель — Школа", "teacher — School"),
  firstBuilt: L("Построена первая школа", "The first school is built"),
  sizeClass: "hall",
  service: { name: L("Школа", "School"), reach: 800, mood: 3, color: "#3f9a76" },
};
