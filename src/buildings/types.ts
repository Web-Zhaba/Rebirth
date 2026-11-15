import type { JobGroup, Materials, StoreRoom } from "../sim/buildings";
import type { ZoneType } from "../sim/types";

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
}

export interface ServiceRules {
  name: string; // of the service ("Water" for a well)
  reach: number; // m by road
  mood: number; // added to the mood target of covered households
  color: string; // of the service's map layer
}
