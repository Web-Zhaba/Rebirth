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

export interface SimState {
  realTime: number; // epoch ms simulated up to
  gameMinutes: number; // since founding
  roads: RoadGraph;
  zones: ZoneState;
  buildings: Record<number, Building>;
  nextBuildingId: number;
  rng: number; // uint32 state of the growth generator
  lastSpawn: Record<ZoneType, number>; // gameMinutes of the last new building per zone
}

// What the worker streams every tick; zones travel separately, only when `rev` changed.
export type SimSnapshot = Omit<SimState, "zones">;

export interface SaveV3 {
  version: 3;
  city: City;
  sim: SimState;
}
