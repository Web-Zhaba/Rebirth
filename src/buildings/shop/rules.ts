import { L } from "../../i18n";
import type { BuildingRules } from "../types";

export const shop: BuildingRules = {
  id: "shop",
  name: L("Магазин", "Shop"),
  zone: "trade",
  group: "trade",
  lot: { w: 1, d: 2 },
  size: { along: 7, deep: 8, height: 5 },
  labor: 100,
  crew: 4,
  materials: { logs: 24, planks: 3, stone: 2 },
  job: L("работает в Магазине", "works at the Shop"),
  firstBuilt: L("Построен первый магазин", "The first shop is built"),
  service: { name: L("Магазин", "Shop"), reach: 800, mood: 5, color: "#c9803a" },
};
