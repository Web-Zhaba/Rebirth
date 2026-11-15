import { L } from "../../i18n";
import type { BuildingRules } from "../types";

export const chapel: BuildingRules = {
  id: "chapel",
  name: L("Храм", "Temple"),
  zone: "placed",
  group: "services",
  lot: { w: 1, d: 2 },
  size: { along: 7, deep: 12, height: 10 },
  labor: 180,
  crew: 1,
  materials: { logs: 35, planks: 4, stone: 6 },
  job: L("служит в Храме", "serves at the Temple"),
  firstBuilt: L("Построен первый храм", "The first temple is built"),
  sizeClass: "hall",
  service: { name: L("Храм", "Temple"), reach: 1000, mood: 7, color: "#8e6bb0" },
};
