import { emptyRoads, ROAD_KINDS } from "./roads";
import type { City, RoadEdge, RoadGraph, RoadNode, SaveV3 } from "./types";

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function parseCity(v: unknown): City | null {
  if (typeof v !== "object" || v === null) return null;
  const c = v as Record<string, unknown>;
  if (typeof c.name !== "string") return null;
  const name = c.name.trim();
  if (name.length < 1 || name.length > 40) return null;
  if (!isNum(c.lat) || c.lat < -90 || c.lat > 90) return null;
  if (!isNum(c.lng) || c.lng < -180 || c.lng > 180) return null;
  if (!isNum(c.foundedAt) || c.foundedAt <= 0) return null;
  return { name, lat: c.lat, lng: c.lng, foundedAt: c.foundedAt };
}

// Saves from before roads existed have no `roads`: that is an empty graph, not an error.
function parseRoads(v: unknown): RoadGraph | null {
  if (v === undefined) return emptyRoads();
  if (!isRecord(v) || !isRecord(v.nodes) || !isRecord(v.edges)) return null;
  if (!Number.isInteger(v.nextId) || (v.nextId as number) < 1) return null;
  const nextId = v.nextId as number;
  const nodes: Record<number, RoadNode> = {};
  for (const [key, raw] of Object.entries(v.nodes)) {
    if (!isRecord(raw) || !Number.isInteger(raw.id) || String(raw.id) !== key) return null;
    if (!isNum(raw.x) || !isNum(raw.y)) return null;
    const id = raw.id as number;
    if (id < 1 || id >= nextId) return null;
    nodes[id] = { id, x: raw.x, y: raw.y };
  }
  const edges: Record<number, RoadEdge> = {};
  for (const [key, raw] of Object.entries(v.edges)) {
    if (!isRecord(raw) || !Number.isInteger(raw.id) || String(raw.id) !== key) return null;
    const id = raw.id as number;
    if (id < 1 || id >= nextId || id in nodes) return null;
    if (!Number.isInteger(raw.a) || !Number.isInteger(raw.b) || raw.a === raw.b) return null;
    if (!((raw.a as number) in nodes) || !((raw.b as number) in nodes)) return null;
    if (typeof raw.kind !== "string" || !Object.hasOwn(ROAD_KINDS, raw.kind)) return null;
    if (!isNum(raw.length) || raw.length <= 0) return null;
    if (!isNum(raw.labor) || raw.labor < 0) return null;
    if (!isNum(raw.done) || raw.done < 0 || raw.done > raw.labor) return null;
    edges[id] = {
      id,
      a: raw.a as number,
      b: raw.b as number,
      kind: raw.kind as RoadEdge["kind"],
      length: raw.length,
      labor: raw.labor,
      done: raw.done,
    };
  }
  return { nodes, edges, nextId };
}

export function parseSaveV3(value: unknown, now: number): SaveV3 | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  if (v.version !== 3) return null;
  const city = parseCity(v.city);
  if (!city) return null;
  const sim = v.sim as Record<string, unknown> | null | undefined;
  if (typeof sim !== "object" || sim === null) return null;
  if (!isNum(sim.realTime) || sim.realTime <= 0 || sim.realTime > now + 60_000) return null;
  if (!isNum(sim.gameMinutes) || sim.gameMinutes < 0) return null;
  const roads = parseRoads(sim.roads);
  if (!roads) return null;
  return { version: 3, city, sim: { realTime: sim.realTime, gameMinutes: sim.gameMinutes, roads } };
}

// Old localStorage saves (v1, v2): keep the city, start a fresh village.
export function migrateLegacy(raw: string, now: number): SaveV3 | null {
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof v !== "object" || v === null) return null;
  const o = v as Record<string, unknown>;
  if (o.version !== 1 && o.version !== 2) return null;
  const city = parseCity(o.city);
  if (!city) return null;
  return { version: 3, city, sim: { realTime: now, gameMinutes: 0, roads: emptyRoads() } };
}
