import type { JobGroup, Materials } from "../sim/buildings";
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
}
