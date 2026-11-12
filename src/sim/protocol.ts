import type { Speed } from "./clock";
import type { Light, Rest, Trip } from "../map/life";
import type { AdminOp } from "./admin";
import type { SimDelta } from "./delta";
import type { StrokeSpan } from "./stroke";
import type { JobKey, Priority } from "./buildings";
import type { Rations } from "./levers";
import type { TradeOrder } from "./trade";
import type { FeatureKind } from "./types";
import type { BuildingQuery, ChronicleEntry, City, ClientSave, Finds, ResidentQuery, RoadKind, Site, StoredArticle, ZoneState } from "./types";

export interface ArticleInput {
  id: string;
  title: string;
  extract: string;
  url: string;
  lang: "ru" | "en";
  lat: number;
  lng: number;
  x?: number; // local metres of the article's point
  y?: number;
}

export type Cmd =
  // pts and labor are local meters / person-hours; labor has one entry per segment.
  // span: longest water run (m) of the line, for the bridge span limit; houses: lay them along both sides of the new road
  // (docs/PLAN-build.md «дорога с домами»), once its ground is surveyed
  | { type: "addRoad"; kind: RoadKind; pts: [number, number][]; snapTol: number; labor: number[]; span?: number; houses?: { template: string; onlyFoundations?: boolean } }
  | { type: "removeRoad"; edgeId: number }
  | { type: "upgradeRoad"; kind: RoadKind; edges: number[]; labor: number[]; span?: number } // labor: each edge built anew as `kind`; span: longest water run of the bridge
  | { type: "addField"; pts: [number, number][] }
  | { type: "removeField"; id: number }
  // Forest to clear; `forest` is the share 0..1 of the polygon that is forest, measured on the main thread.
  | { type: "addClearing"; pts: [number, number][]; forest: number }
  | { type: "removeClearing"; id: number }
  // A player-placed building on the lot starting at depth-0 cell (edge, side, i); `site` is measured on the main thread.
  | { type: "placeBuilding"; template: string; edge: number; side: 1 | -1; i: number; site: Site }
  | { type: "placeOnFoundation"; template: string; foundationId: string }
  // A row of houses, workshops or shops along roads (sim/stroke.ts); `drop` holds the keys of planned items left out.
  | { type: "placeStroke"; template: string; spans: StrokeSpan[]; onlyFoundations?: boolean; drop?: string[] }
  | { type: "cancelStroke"; ids: number[] } // undo of a stroke: its buildings nobody has started on
  // Dig a surveyed outline, or every outline of an old street (sim/digging.ts).
  | { type: "digFoundation"; foundationId: string }
  | { type: "digStreet"; streetId: string }
  // What to do with a find (sim/items.ts), and what a museum hall shows (sim/museum.ts; null empties the hall).
  | { type: "returnFind"; id: string }
  | { type: "useFind"; id: string }
  | { type: "setExhibition"; building: number; hall: number; theme: string | null }
  | { type: "arrangeExhibitions" } // the best themes in every hall of the town
  | { type: "demolish"; id: number }
  // Player levers (PLAN-pace.md section 8). A site key is a building id, or -id of a clearing; null clears the priority.
  | { type: "setPriority"; key: number | null }
  | { type: "callToloka"; key: number }
  | { type: "setSchedule"; strada: boolean }
  | { type: "setRations"; rations: Rations }
  | { type: "setAdultSchool"; on: boolean }
  | { type: "callSettlers" }
  | { type: "grantSupplies" } // the reward for a watched ad
  | { type: "setTrade"; order: TradeOrder | null } // what the markets swap every day
  // Jobs: hiring priority of a job group (or of construction), and the staff limit of a workplace.
  | { type: "setJobPriority"; group: JobKey; priority: Priority }
  | { type: "setStaff"; id: number; staff: number }
  // Research: start one when none is under way, queue (at most three), cancel the active one or drop a queued one.
  | { type: "startResearch"; techId: string }
  | { type: "queueResearch"; techId: string }
  | { type: "cancelResearch"; techId: string }
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
      streets: { id: string; name: string; lines?: [number, number][][] }[];
      features?: { id: string; kind: FeatureKind; x: number; y: number; name?: string; cls?: string }[];
    };

export type ToWorker =
  | { t: "load"; legacy: string | null; now: number }
  | { t: "found"; city: City; now: number }
  | { t: "cmd"; id: number; cmd: Cmd }
  | { t: "query"; id: number; q: { type: "building"; id: number } | { type: "resident"; id: number } }
  | { t: "flush" }
  // Session setting, not saved: 0 = paused. `now` keeps paused wall time from being owed later.
  | { t: "speed"; speed: Speed; now: number }
  // The tab was hidden or shown; hidden for long enough, the town runs at the slower hidden-tab rate.
  | { t: "visibility"; hidden: boolean; now: number }
  | { t: "reset" };

export interface CmdResult {
  ok: boolean;
  reason?: string;
  ids?: number[]; // the buildings a placeStroke laid, for its undo
}

export type FromWorker =
  | { t: "loaded"; save: ClientSave | null; migrated: boolean }
  // what changed since the previous state the main thread got ("loaded" carries all of it; see delta.ts): zones only
  // when their rev changed; the chronicle, finds and articles only when they changed
  | { t: "snapshot"; sim: SimDelta; zones?: ZoneState; chronicle?: ChronicleEntry[]; finds?: Finds; articles?: StoredArticle[] }
  | ({ t: "cmdResult"; id: number } & CmdResult)
  | { t: "queryResult"; id: number; data: BuildingQuery | ResidentQuery | null }
  // cosmetic, once per game day, whenever the families on their way change, and on load; not part of the sim state or saves
  | { t: "life"; day: number; trips: Trip[]; rests: Rest[]; traffic: Record<number, number>; lights: Light[] }
  | { t: "resetDone" }
  | { t: "error"; message: string };
