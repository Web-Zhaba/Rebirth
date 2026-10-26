import type { Speed } from "./clock";
import type { Light, Trip } from "../map/lifeLayer";
import type { AdminOp } from "./admin";
import type { Away } from "./away";
import type { JobKey, Priority } from "./buildings";
import type { Rations } from "./levers";
import type { BuildingQuery, ChronicleEntry, City, ClientSave, Finds, RoadKind, SimSnapshot, Site, StoredArticle, ZoneState, ZoneType } from "./types";

export type { Away };

export interface ArticleInput {
  id: string;
  title: string;
  extract: string;
  url: string;
  lang: "ru" | "en";
  lat: number;
  lng: number;
}

export type Cmd =
  // pts and labor are local meters / person-hours; labor has one entry per segment.
  | { type: "addRoad"; kind: RoadKind; pts: [number, number][]; snapTol: number; labor: number[]; span?: number } // span: longest water run (m) of the line, for the bridge span limit
  | { type: "removeRoad"; edgeId: number }
  | { type: "paintZones"; keys: string[]; zone: "none" | ZoneType }
  | { type: "addField"; pts: [number, number][] }
  | { type: "removeField"; id: number }
  // Forest to clear; `forest` is the share 0..1 of the polygon that is forest, measured on the main thread.
  | { type: "addClearing"; pts: [number, number][]; forest: number }
  | { type: "removeClearing"; id: number }
  // A player-placed building on the lot starting at depth-0 cell (edge, side, i); `site` is measured on the main thread.
  | { type: "placeBuilding"; template: string; edge: number; side: 1 | -1; i: number; site: Site }
  | { type: "demolish"; id: number }
  // Player levers (PLAN-pace.md section 8). A site key is a building id, or -id of a clearing; null clears the priority.
  | { type: "setPriority"; key: number | null }
  | { type: "callToloka"; key: number }
  | { type: "setSchedule"; strada: boolean }
  | { type: "setRations"; rations: Rations }
  | { type: "setAdultSchool"; on: boolean }
  | { type: "callSettlers" }
  // Jobs: hiring priority of a job group (or of construction), and the staff limit of a workplace.
  | { type: "setJobPriority"; group: JobKey; priority: Priority }
  | { type: "setStaff"; id: number; staff: number }
  // Research: start one when none is under way, queue (at most three), cancel the active one or drop a queued one.
  | { type: "startResearch"; techId: string }
  | { type: "queueResearch"; techId: string }
  | { type: "cancelResearch"; techId: string }
  // The answer to the pending event: its id and the option (0 or 1).
  | { type: "choose"; id: string; option: 0 | 1 }
  // Admin panel cheats.
  | { type: "admin"; op: AdminOp }
  // Wikipedia articles found near the dig discs (validated, deduplicated by id and capped by the sim).
  | { type: "addArticles"; articles: ArticleInput[] }
  // New finds of a dig site: foundations in local meters, named places and one entry per street name.
  | {
      type: "recordFinds";
      digId: number;
      foundations: { id: string; ring: [number, number][]; area: number }[];
      pois: { id: string; name: string; cls: string; x: number; y: number }[];
      streets: { id: string; name: string }[];
    };

export type ToWorker =
  | { t: "load"; legacy: string | null; now: number }
  | { t: "found"; city: City; now: number }
  | { t: "cmd"; id: number; cmd: Cmd }
  | { t: "query"; id: number; q: { type: "building"; id: number } }
  | { t: "flush" }
  // Session setting, not saved: 0 = paused. `now` keeps paused wall time from being owed later.
  | { t: "speed"; speed: Speed; now: number }
  // The tab was hidden or shown; hidden for long enough, the town runs at the offline rate.
  | { t: "visibility"; hidden: boolean; now: number }
  | { t: "reset" };

export interface CmdResult {
  ok: boolean;
  reason?: string;
}

export type FromWorker =
  | { t: "loaded"; save: ClientSave | null; migrated: boolean; away: Away | null }
  // zones only when their rev changed; the chronicle, finds and articles only when they changed since the previous snapshot
  | { t: "snapshot"; sim: SimSnapshot; zones?: ZoneState; chronicle?: ChronicleEntry[]; finds?: Finds; articles?: StoredArticle[] }
  // catch-up in progress (game minutes); no snapshots or life messages until it ends
  | { t: "progress"; done: number; total: number }
  // the summary of a catch-up after the tab was hidden (a catch-up at load reports it in "loaded")
  | { t: "away"; away: Away }
  | ({ t: "cmdResult"; id: number } & CmdResult)
  | { t: "queryResult"; id: number; data: BuildingQuery | null }
  // cosmetic, once per game day, whenever the families on their way change, and on load, never during catch-up; not part of the sim state or saves
  | { t: "life"; day: number; trips: Trip[]; traffic: Record<number, number>; lights: Light[] }
  | { t: "resetDone" }
  | { t: "error"; message: string };
