import type { Land } from "../world/landcover";

export interface City {
  name: string;
  lat: number;
  lng: number;
  foundedAt: number; // epoch ms
}

export type RoadKind = "path" | "dirt";

// Coordinates are local meters (src/world/frame.ts), x east, y north.
export interface RoadNode {
  id: number;
  x: number;
  y: number;
}

export interface RoadEdge {
  id: number;
  a: number; // node ids
  b: number;
  kind: RoadKind;
  length: number; // m
  labor: number; // person-hours to build
  done: number; // person-hours spent; built when done >= labor
}

export interface RoadGraph {
  nodes: Record<number, RoadNode>;
  edges: Record<number, RoadEdge>;
  nextId: number; // shared id counter for nodes and edges
}

export type ZoneType = "res" | "craft" | "trade";
export type ZoneBlock = "road" | "overlap" | "field" | "water" | "steep" | "pending";

// One 8 x 8 m lot beside a road edge (see sim/zones.ts for the geometry).
export interface ZoneCell {
  key: string; // `${edge}:${side}:${i}:${depth}`
  edge: number;
  side: 1 | -1; // +1 left of a -> b, -1 right
  i: number;
  depth: number; // 0..3
  cx: number;
  cy: number;
  angle: number; // direction of the road, radians
  zone: "none" | ZoneType;
  block: ZoneBlock | null;
}

export interface Field {
  id: number;
  pts: [number, number][]; // counter-clockwise
  area: number; // m2
}

export interface TerrainInfo {
  land: Land;
  slope: number; // degrees
}

export interface ZoneState {
  cells: ZoneCell[];
  fields: Field[];
  terrain: Record<string, TerrainInfo>; // keyed by qkey (4 m grid)
  rev: number; // bumped on every change of cells, fields or terrain
}

export type BuildingState = "planned" | "building" | "active";

export interface Building {
  id: number;
  template: string; // key of BUILDINGS
  zone: ZoneType | "placed"; // "placed": put down by the player, not grown on a zone
  // Local meters; centre of the lot rectangle, angle = road direction.
  lot: { cx: number; cy: number; angle: number; w: number; d: number };
  side: 1 | -1; // side of the road, as in ZoneCell
  footprint: [number, number][]; // 4 corners, counter-clockwise
  height: number; // m
  state: BuildingState;
  labor: number; // person-hours
  done: number;
  created: number; // gameMinutes
  paid: boolean; // materials taken from the stock (done when construction starts)
  site?: Site; // terrain shares measured when a placed building was put down
  level: number; // 1, or 2 for an izba rebuilt after the upgrade
  streak: number; // days in a row a house met the upgrade conditions
  upgrade?: Upgrade; // the rebuild into level 2 in progress; the house stays active meanwhile
}

// Work on a finished house: labor and materials are taken like those of a new building.
export interface Upgrade {
  labor: number; // person-hours
  done: number;
  paid: boolean;
}

// Shares 0..1 of forest, water and rock/sand around a placed building.
export interface Site {
  forest: number;
  water: number;
  rock: number;
}

export interface Resident {
  id: number;
  first: string;
  last: string; // personal form (feminine for women)
  sex: "m" | "f";
  born: number; // gameMinutes, may be negative
  household: number;
  spouse: number | null;
  job: number | null; // building id of the workplace
  commute: number | null; // minutes one way
  idleDays: number; // days in a row without any work
  literate: boolean;
  school: number; // days of school attended (children 7-14 in the reach of a staffed school)
}

export interface Household {
  id: number;
  last: string; // masculine form of the family name
  home: number | null; // building id; null = tents at the founding point
  members: number[];
  arrived: number; // gameMinutes
  founder: boolean; // came with the founding party: never emigrates
  mood: number; // 0..100
}

export type EventKind = "birth" | "death" | "marriage" | "arrival" | "departure" | "movein" | "farm" | "food";

export interface TownEvent {
  at: number; // gameMinutes
  kind: EventKind;
  text: string;
}

// Notable moments kept forever (PLAN.md section 11); `kind` is a machine key, `text` the Russian line.
export interface ChronicleEntry {
  at: number; // gameMinutes
  kind: string;
  text: string;
}

export interface PeopleState {
  residents: Record<number, Resident>;
  households: Record<number, Household>;
  nextPersonId: number;
  nextHouseholdId: number;
  events: TownEvent[]; // ring buffer, last 50
}

export interface Stock {
  food: number; // kg of grain equivalent
  logs: number; // m3
  planks: number; // m3
  stone: number; // t
  wares: number; // pieces
}

// A field's progress in one year (rye is sown in spring and reaped in autumn of the same year).
export interface FieldWork {
  year: number;
  sowH: number; // person-hours of sowing done
  harvH: number; // person-hours of harvest done
  reaped: number; // kg
}

export interface ProdFlags {
  year: number; // year the four event flags below belong to
  sowing: boolean; // "sowing started" was announced
  harvest: boolean;
  done: boolean;
  closed: boolean; // harvest window already settled (lost grain announced)
  hungry: boolean; // food ran out and no recovery since
  rot: number; // kg of food lost to full barns since the last announcement
}

export interface ProdState {
  fields: Record<number, FieldWork>;
  flags: ProdFlags;
  today: Record<number, number>; // building id -> units made since 00:00 (kg of grain for a gumno)
  yesterday: Record<number, number>;
}

export interface SimState extends PeopleState {
  stock: Stock;
  prod: ProdState;
  realTime: number; // epoch ms simulated up to
  gameMinutes: number; // since founding
  roads: RoadGraph;
  zones: ZoneState;
  chronicle: ChronicleEntry[]; // oldest first, capped at 1000
  buildings: Record<number, Building>;
  nextBuildingId: number;
  rng: number; // uint32 state of the growth generator
  lastSpawn: Record<ZoneType, number>; // gameMinutes of the last new building per zone
  // Derived once per game day (and on load): bit i of coverage[house] is set when service i covers it.
  coverage: Record<number, number>;
  landValue: Record<number, number>; // house id -> 0..100
}

export type Window = "sowing" | "harvest" | null;

export interface EconomyStats {
  foodCap: number;
  foodPerDay: number;
  foodDays: number; // Infinity is sent as 999
  yesterday: Stock; // production per good (food includes the harvest)
  fields: { count: number; ha: number; assignedHa: number; sown: number; reaped: number; expected: number; window: Window };
  avgMood: number;
  forage: number; // kg of food a day the idle adults gather
  outlook: number; // 0..1, can the food last to the end of the next harvest window
}

export type ServiceId = "well" | "market" | "chapel" | "school" | "healer";

export interface ServiceStats {
  houses: number; // finished houses
  covered: Record<ServiceId, number>; // houses covered per service
  literate: number; // share 0..1 of adults
  avgLandValue: number;
  level2: number; // houses of level 2
}

export interface PeopleStats {
  pop: number;
  adults: number; // 16-59
  children: number; // under 16
  employed: number; // adults with a regular job
  builders: number; // adults without a job while construction work exists
  unemployed: number; // adults without a job and without construction work
  tents: number; // households living in tents
  avgCommute: number; // minutes, over the employed
  households: number;
}

export interface Demand {
  res: number;
  craft: number;
  trade: number;
}

// What the worker streams every tick: no individual residents, only aggregates.
// Zones and the chronicle travel separately, only when they changed.
export type SimSnapshot = Omit<SimState, "zones" | "chronicle" | "residents" | "households" | "nextPersonId" | "nextHouseholdId" | "prod"> & {
  people: PeopleStats & { demand: Demand };
  economy: EconomyStats;
  services: ServiceStats;
  houseMood: Record<number, number>; // house id -> mood of its household, for the overlay
};

// What the main thread keeps.
export type ClientState = SimSnapshot & { zones: ZoneState; chronicle: ChronicleEntry[] };

export interface ClientSave {
  version: 3;
  city: City;
  sim: ClientState;
}

export interface PersonInfo {
  id: number;
  name: string;
  age: number;
  sex: "m" | "f";
  role: string; // occupation text
  literate: boolean;
}

export interface WorkerInfo {
  id: number;
  name: string;
  age: number;
  commute: number | null;
  idle: boolean; // counted with the construction artel (no work for them at the moment)
}

export interface ProductionInfo {
  good: keyof Stock | null; // what the building makes; null for a barn
  yesterday: number; // units made yesterday (kg of grain for a gumno)
  site?: Site;
  missing?: string; // input the workshop lacks
  storage?: number; // kg of food a barn holds
  fields?: { count: number; ha: number; sown: number; reaped: number; expected: number };
}

export type BuildingQuery =
  | {
      kind: "house";
      households: { id: number; last: string; mood: number; people: PersonInfo[] }[];
      level: number;
      landValue: number;
      services: ServiceId[]; // covering this house
      upgrading: boolean;
    }
  | {
      kind: "workplace";
      capacity: number;
      workers: WorkerInfo[];
      production?: ProductionInfo;
      service?: { id: ServiceId; reach: number; covered: number; houses: number; working: boolean };
    };

export interface SaveV3 {
  version: 3;
  city: City;
  sim: SimState;
}
