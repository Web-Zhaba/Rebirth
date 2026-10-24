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
  zone: ZoneType;
  // Local meters; centre of the lot rectangle, angle = road direction.
  lot: { cx: number; cy: number; angle: number; w: number; d: number };
  side: 1 | -1; // side of the road, as in ZoneCell
  footprint: [number, number][]; // 4 corners, counter-clockwise
  height: number; // m
  state: BuildingState;
  labor: number; // person-hours
  done: number;
  created: number; // gameMinutes
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
}

export interface Household {
  id: number;
  last: string; // masculine form of the family name
  home: number | null; // building id; null = tents at the founding point
  members: number[];
  arrived: number; // gameMinutes
}

export type EventKind = "birth" | "death" | "marriage" | "arrival" | "departure" | "movein";

export interface TownEvent {
  at: number; // gameMinutes
  kind: EventKind;
  text: string;
}

export interface PeopleState {
  residents: Record<number, Resident>;
  households: Record<number, Household>;
  nextPersonId: number;
  nextHouseholdId: number;
  events: TownEvent[]; // ring buffer, last 50
}

export interface SimState extends PeopleState {
  realTime: number; // epoch ms simulated up to
  gameMinutes: number; // since founding
  roads: RoadGraph;
  zones: ZoneState;
  buildings: Record<number, Building>;
  nextBuildingId: number;
  rng: number; // uint32 state of the growth generator
  lastSpawn: Record<ZoneType, number>; // gameMinutes of the last new building per zone
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
// Zones travel separately, only when `rev` changed.
export type SimSnapshot = Omit<SimState, "zones" | "residents" | "households" | "nextPersonId" | "nextHouseholdId"> & {
  people: PeopleStats & { demand: Demand };
};

// What the main thread keeps.
export type ClientState = SimSnapshot & { zones: ZoneState };

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
}

export interface WorkerInfo {
  id: number;
  name: string;
  age: number;
  commute: number | null;
}

export type BuildingQuery =
  | { kind: "house"; households: { id: number; last: string; people: PersonInfo[] }[] }
  | { kind: "workplace"; capacity: number; workers: WorkerInfo[] };

export interface SaveV3 {
  version: 3;
  city: City;
  sim: SimState;
}
