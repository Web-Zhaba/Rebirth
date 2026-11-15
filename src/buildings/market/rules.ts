import { L } from "../../i18n";
import type { BuildingRules } from "../types";

export const market: BuildingRules = {
  id: "market",
  name: L("Рынок", "Market"),
  zone: "placed",
  group: "trade",
  lot: { w: 2, d: 3 },
  size: { along: 15, deep: 16, height: 5 },
  labor: 260,
  crew: 8,
  materials: { logs: 50, planks: 10, stone: 3 },
  job: L("торгует на Рынке", "trades at the Market"),
  firstBuilt: L("Построен первый рынок", "The first market is built"),
  sizeClass: "store",
  trades: true, // its workers swap goods with the neighbours (sim/trade.ts, the market window)
  outdoors: true, // worked in the open: the workers show on the plot
  oldKinds: ["marketplace"], // old buildings of these kinds come back as it
};
