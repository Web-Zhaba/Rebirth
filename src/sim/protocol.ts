import type { BuildingQuery, City, ClientSave, RoadKind, SimSnapshot, ZoneState, ZoneType } from "./types";

export type Cmd =
  // pts and labor are local meters / person-hours; labor has one entry per segment.
  | { type: "addRoad"; kind: RoadKind; pts: [number, number][]; snapTol: number; labor: number[] }
  | { type: "removeRoad"; edgeId: number }
  | { type: "paintZones"; keys: string[]; zone: "none" | ZoneType }
  | { type: "addField"; pts: [number, number][] }
  | { type: "removeField"; id: number };

export type ToWorker =
  | { t: "load"; legacy: string | null; now: number }
  | { t: "found"; city: City; now: number }
  | { t: "cmd"; id: number; cmd: Cmd }
  | { t: "query"; id: number; q: { type: "building"; id: number } }
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
  | { t: "loaded"; save: ClientSave | null; migrated: boolean; away: Away | null }
  // zones only when their rev changed since the previous snapshot
  | { t: "snapshot"; sim: SimSnapshot; zones?: ZoneState }
  | ({ t: "cmdResult"; id: number } & CmdResult)
  | { t: "queryResult"; id: number; data: BuildingQuery | null }
  | { t: "resetDone" }
  | { t: "error"; message: string };
