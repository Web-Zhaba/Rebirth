import type { City, RoadKind, SaveV3, SimState } from "./types";

export type Cmd =
  // pts and labor are local meters / person-hours; labor has one entry per segment.
  | { type: "addRoad"; kind: RoadKind; pts: [number, number][]; snapTol: number; labor: number[] }
  | { type: "removeRoad"; edgeId: number };

export type ToWorker =
  | { t: "load"; legacy: string | null; now: number }
  | { t: "found"; city: City; now: number }
  | { t: "cmd"; id: number; cmd: Cmd }
  | { t: "flush" }
  | { t: "reset" };

export interface Away {
  realMs: number;
  gameMinutes: number;
}

export interface CmdResult {
  ok: boolean;
  reason?: string;
}

export type FromWorker =
  | { t: "loaded"; save: SaveV3 | null; migrated: boolean; away: Away | null }
  | { t: "snapshot"; sim: SimState }
  | ({ t: "cmdResult"; id: number } & CmdResult)
  | { t: "resetDone" }
  | { t: "error"; message: string };
