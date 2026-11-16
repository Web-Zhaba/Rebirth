import type { JobGroup, Materials, StoreRoom } from "../sim/buildings";
import type { Stock, ZoneType } from "../sim/types";
import type { WeatherState } from "../sim/weather";

// The contracts between one building's folder (src/buildings/<id>/) and the game. A folder holds:
// - rules.ts: the building's numbers and rules; it runs in the sim worker, so it imports only types, i18n and leaf
//   helpers, never map/, ui/, view/ or engine/.
// - model.ts: its 3D model (main thread).
// - ui.ts: its icon, colour and texts in the interface (main thread).
// The registries next to this file (rules.ts, ...) list every folder, one per layer.

// What a building is in the rules. Sizes are real-world ones (a log house of 8 x 9 m, a workshop of 10 x 8 m) and a
// workplace employs a real crew, so a town needs a few buildings of a kind, not dozens. Labor is paced for play, not
// history: a village raised houses together, and a house takes about one game day of the founding party's work.
export interface BuildingRules {
  id: string; // the template id, a save key: never rename without a save migration
  name: string;
  zone: ZoneType | "placed"; // the class: res (house), craft (workshop), trade (shop), placed (any other)
  group: JobGroup | null; // job group of a workplace (houses and sites without workers: null)
  lot: { w: number; d: number }; // lot in cells: w along the road, d deep
  size: { along: number; deep: number; height: number }; // footprint along the road and across it, height; m
  labor: number; // person-hours to build
  crew: number; // people a house holds (all its families), or the jobs of a workplace
  homes?: number; // families a house holds when built (default: 1 for a house, 0 for any other building)
  materials: Materials; // m3 of logs, m3 of planks, t of stone

  // Optional parts: a building without one has none of it.
  job?: string; // what its worker is called in the resident card (default: "works — <name>")
  firstBuilt?: string; // the chronicle's line when the first one is finished
  store?: StoreRoom; // room of a finished store per group of goods (sim/storage.ts), in the units of the stock
  sizeClass?: "store" | "hall"; // size limits on an old foundation (sim/foundationLots.ts); absent: a heated building
  service?: ServiceRules; // it serves the houses within reach by road (sim/services.ts)
  usesTools?: boolean; // its work wears tools out (sim/goods.ts TOOL_WEAR)
  reach?: number; // m around it that it works: the circle of the placement preview and of the reach layer
  needs?: { forest?: number; water?: number }; // the least share of forest or water within `reach`, sampled when placed
  dryLand?: boolean; // not on water or marsh
  onePerTown?: string; // one in a town: why another can't be placed
  foundationOnly?: boolean; // stands only on an old foundation
  workSite?: boolean; // a work site on an old foundation, not a building on it: it never counts as built there
  monument?: boolean; // an old building kept as a monument (sim/monuments.ts)
  evenings?: boolean; // the homes around send a guest each evening (sim/evening.ts, sim/life.ts walks and lights)
  seats?: number; // pupils it teaches at once (sim/school.ts); its workers are the teachers
  trades?: boolean; // its workers swap goods with the neighbours (sim/trade.ts)
  water?: boolean; // a source of water: a lost bucket goes back to one (sim/items.ts)
  openGround?: boolean; // open ground or bound to its surroundings (a garden, a pier, a log yard): never on an old foundation
  outdoors?: boolean; // worked in the open: the workers show on the plot (sim/life.ts), the rest work indoors
  oldKinds?: readonly string[]; // kinds of old buildings (OpenStreetMap) that come back as this one, restored as they were
  manages?: number; // an office of the administration: residents it manages when all its clerks are at work
  seat?: boolean; // the seat of the town's head: once built it opens the government and the orders (sim/government.ts)
  keeps?: "dry" | "cool"; // a food store that keeps its food better than the camp (a barn dry, a cellar cool)
  produce?: Produce; // what its workers make (sim/production.ts)
  weather?: (w: WeatherState) => number; // share of the hours it works in this weather (default: all of them)
}

// What a workplace makes. A recipe: so much of a good per worker-hour, carted to the nearest store with room, made from
// an input taken from the stock. A workplace that takes an input stops when no store has room for its output, unless
// both lie in the same store (a sawmill frees timber room as it works); food never stops, it rots instead.
export interface Recipe {
  good: keyof Stock;
  perHour: number; // units per worker-hour (kg, m3, t, pieces)
  pace?: boolean; // a building material: PACE times faster than in history (sim/production.ts)
  forest?: boolean; // times the forest share around its site (sampled when placed)
  season?: readonly [number, number, number, number]; // factor of each season, spring .. winter
  ripens?: boolean; // planted trees: nothing until they bear (sim/fields.ts ORCHARD_YEARS), then the year decides
  input?: { good: keyof Stock; per: number; missing: string }; // taken per unit made; "missing" names it when out
}
// The farm: the harvest of the fields it works (sim/fields.ts).
export interface FieldHarvest {
  good: "food";
  fromFields: true;
}
export type Produce = Recipe | FieldHarvest;

export interface ServiceRules {
  name: string; // of the service ("Water" for a well)
  reach: number; // m by road
  mood: number; // added to the mood target of covered households
  color: string; // of the service's map layer
}
