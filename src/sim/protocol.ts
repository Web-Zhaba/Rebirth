import type { City, SaveV3, SimState } from "./types";

export type ToWorker =
  | { t: "load"; legacy: string | null; now: number }
  | { t: "found"; city: City; now: number }
  | { t: "flush" }
  | { t: "reset" };

export interface Away {
  realMs: number;
  gameMinutes: number;
}

export type FromWorker =
  | { t: "loaded"; save: SaveV3 | null; migrated: boolean; away: Away | null }
  | { t: "snapshot"; sim: SimState }
  | { t: "resetDone" }
  | { t: "error"; message: string };
