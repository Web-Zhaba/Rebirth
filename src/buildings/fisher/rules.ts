import { L } from "../../i18n";
import type { BuildingRules } from "../types";
import { SIGNS, stormy } from "../../sim/weatherSigns";

// Weather: a storm keeps the boats in, ice leaves only fishing through holes.
const W = { storm: 0.2, ice: 0.35 };

export const fisher: BuildingRules = {
  id: "fisher",
  name: L("Рыболовный причал", "Fishing pier"),
  zone: "placed",
  group: "food",
  lot: { w: 1, d: 1 },
  size: { along: 6, deep: 6, height: 3 },
  labor: 70,
  crew: 4,
  materials: { logs: 10, planks: 2, stone: 0 },
  job: L("рыбак", "fisher"),
  firstBuilt: L("Построен первый рыболовный причал", "The first fishing pier is built"),
  reach: 100,
  needs: { water: 0.05 },
  produce: { good: "food", perHour: 0.6, season: [1, 1, 1, 0.5] }, // kg; buffed on purpose: food without fields
  weather: (w) => (stormy(w) ? W.storm : 1) * (w.ice > SIGNS.iceAbove ? W.ice : 1),
};
