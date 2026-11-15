import { L } from "../../i18n";
import type { BuildingRules } from "../types";
import { stormy } from "../../sim/weatherSigns";

// Weather: a storm keeps the hunters home; fresh snow shows the tracks.
const W = { storm: 0.4, tracks: 1.3 };

// Food without fields: a hunter's hut.
export const hunter: BuildingRules = {
  id: "hunter",
  name: L("Охотничий пост", "Hunting post"),
  zone: "placed",
  group: "food",
  lot: { w: 1, d: 1 },
  size: { along: 6, deep: 6, height: 3 },
  labor: 50,
  crew: 4,
  materials: { logs: 7, planks: 2, stone: 0 },
  job: L("охотник — Охотничий пост", "hunter — Hunting post"),
  firstBuilt: L("Поставлен первый охотничий пост", "The first hunting post is set up"),
  produce: { good: "food", perHour: 0.15, season: [0.5, 0.5, 1, 2] }, // kg; game comes down to the houses in the cold
  weather: (w) => (stormy(w) ? W.storm : 1) * (w.now.snow ? W.tracks : 1),
};
