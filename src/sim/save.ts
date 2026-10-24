import { LANDS } from "../world/landcover";
import { BUILDINGS } from "./buildings";
import { emptyGrowth, NO_SPAWN, seedOf } from "./growth";
import { createFounders, isFinishedHouse, isWorkplace, MAX_EVENTS } from "./people";
import { emptyRoads, ROAD_KINDS } from "./roads";
import type {
  Building,
  City,
  EventKind,
  Field,
  Household,
  PeopleState,
  Resident,
  RoadEdge,
  RoadGraph,
  RoadNode,
  SaveV3,
  TerrainInfo,
  TownEvent,
  ZoneBlock,
  ZoneCell,
  ZoneState,
  ZoneType,
} from "./types";
import { emptyZones } from "./zones";

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

const ZONES = ["none", "res", "craft", "trade"];
const BLOCKS = ["road", "overlap", "field", "water", "steep", "pending"];

const isPoint = (p: unknown): p is [number, number] => Array.isArray(p) && p.length === 2 && isNum(p[0]) && isNum(p[1]);

// Saves from before zoning have no `zones`: that is an empty state, not an error.
function parseZones(v: unknown): ZoneState | null {
  if (v === undefined) return emptyZones();
  if (!isRecord(v) || !Array.isArray(v.cells) || !Array.isArray(v.fields) || !isRecord(v.terrain)) return null;
  if (!Number.isInteger(v.rev) || (v.rev as number) < 0) return null;
  const cells: ZoneCell[] = [];
  for (const raw of v.cells) {
    if (!isRecord(raw) || typeof raw.key !== "string") return null;
    if (!Number.isInteger(raw.edge) || !Number.isInteger(raw.i) || (raw.i as number) < 0) return null;
    if (raw.side !== 1 && raw.side !== -1) return null;
    if (!Number.isInteger(raw.depth) || (raw.depth as number) < 0 || (raw.depth as number) > 3) return null;
    if (!isNum(raw.cx) || !isNum(raw.cy) || !isNum(raw.angle)) return null;
    if (typeof raw.zone !== "string" || !ZONES.includes(raw.zone)) return null;
    if (raw.block !== null && (typeof raw.block !== "string" || !BLOCKS.includes(raw.block))) return null;
    cells.push({
      key: raw.key,
      edge: raw.edge as number,
      side: raw.side,
      i: raw.i as number,
      depth: raw.depth as number,
      cx: raw.cx,
      cy: raw.cy,
      angle: raw.angle,
      zone: raw.zone as ZoneCell["zone"],
      block: raw.block as ZoneBlock | null,
    });
  }
  const fields: Field[] = [];
  for (const raw of v.fields) {
    if (!isRecord(raw) || !Number.isInteger(raw.id) || (raw.id as number) < 1) return null;
    if (!Array.isArray(raw.pts) || raw.pts.length < 3 || !raw.pts.every(isPoint)) return null;
    if (!isNum(raw.area) || raw.area <= 0) return null;
    fields.push({ id: raw.id as number, pts: (raw.pts as [number, number][]).map((p) => [p[0], p[1]]), area: raw.area });
  }
  const terrain: Record<string, TerrainInfo> = {};
  for (const [key, raw] of Object.entries(v.terrain)) {
    if (!isRecord(raw) || typeof raw.land !== "string" || !(LANDS as readonly string[]).includes(raw.land) || !isNum(raw.slope)) return null;
    terrain[key] = { land: raw.land as TerrainInfo["land"], slope: raw.slope };
  }
  return { cells, fields, terrain, rev: v.rev as number };
}

const STATES = ["planned", "building", "active"];

function parseBuildings(v: unknown, nextId: unknown): Record<number, Building> | null {
  if (!isRecord(v) || !Number.isInteger(nextId) || (nextId as number) < 1) return null;
  const out: Record<number, Building> = {};
  for (const [key, raw] of Object.entries(v)) {
    if (!isRecord(raw) || !Number.isInteger(raw.id) || String(raw.id) !== key) return null;
    const id = raw.id as number;
    if (id < 1 || id >= (nextId as number)) return null;
    if (typeof raw.template !== "string" || !Object.hasOwn(BUILDINGS, raw.template)) return null;
    if (raw.zone !== BUILDINGS[raw.template].zone) return null;
    if (raw.side !== 1 && raw.side !== -1) return null;
    const lot = raw.lot;
    if (!isRecord(lot) || !isNum(lot.cx) || !isNum(lot.cy) || !isNum(lot.angle)) return null;
    if (!Number.isInteger(lot.w) || !Number.isInteger(lot.d) || (lot.w as number) < 1 || (lot.d as number) < 1) return null;
    if (!Array.isArray(raw.footprint) || raw.footprint.length !== 4 || !raw.footprint.every(isPoint)) return null;
    if (!isNum(raw.height) || raw.height <= 0) return null;
    if (typeof raw.state !== "string" || !STATES.includes(raw.state)) return null;
    if (!isNum(raw.labor) || raw.labor <= 0 || !isNum(raw.done) || raw.done < 0 || raw.done > raw.labor) return null;
    if (!isNum(raw.created)) return null;
    out[id] = {
      id,
      template: raw.template,
      zone: raw.zone as ZoneType,
      lot: { cx: lot.cx, cy: lot.cy, angle: lot.angle, w: lot.w as number, d: lot.d as number },
      side: raw.side,
      footprint: (raw.footprint as [number, number][]).map((p) => [p[0], p[1]]),
      height: raw.height,
      state: raw.state as Building["state"],
      labor: raw.labor,
      done: raw.done,
      created: raw.created,
    };
  }
  return out;
}

const EVENT_KINDS = ["birth", "death", "marriage", "arrival", "departure", "movein"];
const nonNegInt = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0;

// Structurally broken people data gives null (the caller starts over with founders). References to
// buildings that do not exist are repaired instead: such households go back to tents, such workers
// lose the job. Missing people data (older saves) also gives null.
function parsePeople(sim: Record<string, unknown>, buildings: Record<number, Building>): PeopleState | null {
  const { residents: rawR, households: rawH } = sim;
  if (!isRecord(rawR) || !isRecord(rawH)) return null;
  if (!Number.isInteger(sim.nextPersonId) || (sim.nextPersonId as number) < 1) return null;
  if (!Number.isInteger(sim.nextHouseholdId) || (sim.nextHouseholdId as number) < 1) return null;
  const nextPerson = sim.nextPersonId as number;
  const nextHouse = sim.nextHouseholdId as number;
  const residents: Record<number, Resident> = {};
  for (const [key, r] of Object.entries(rawR)) {
    if (!isRecord(r) || !Number.isInteger(r.id) || String(r.id) !== key) return null;
    const id = r.id as number;
    if (id < 1 || id >= nextPerson) return null;
    if (typeof r.first !== "string" || typeof r.last !== "string" || r.first === "" || r.last === "") return null;
    if (r.sex !== "m" && r.sex !== "f") return null;
    if (!isNum(r.born)) return null;
    if (!Number.isInteger(r.household) || (r.spouse !== null && !Number.isInteger(r.spouse))) return null;
    if (r.job !== null && !Number.isInteger(r.job)) return null;
    if (r.commute !== null && (!isNum(r.commute) || r.commute < 0)) return null;
    if (!nonNegInt(r.idleDays)) return null;
    residents[id] = {
      id,
      first: r.first,
      last: r.last,
      sex: r.sex,
      born: r.born,
      household: r.household as number,
      spouse: r.spouse as number | null,
      job: r.job as number | null,
      commute: r.commute as number | null,
      idleDays: r.idleDays,
    };
  }
  const households: Record<number, Household> = {};
  const homes = new Set<number>();
  const seen = new Set<number>();
  for (const [key, h] of Object.entries(rawH)) {
    if (!isRecord(h) || !Number.isInteger(h.id) || String(h.id) !== key) return null;
    const id = h.id as number;
    if (id < 1 || id >= nextHouse) return null;
    if (typeof h.last !== "string" || h.last === "" || !isNum(h.arrived)) return null;
    if (!Array.isArray(h.members) || h.members.length === 0) return null;
    const members: number[] = [];
    for (const m of h.members) {
      if (!Number.isInteger(m) || !residents[m as number] || residents[m as number].household !== id || seen.has(m as number)) return null;
      seen.add(m as number);
      members.push(m as number);
    }
    let home: number | null = null;
    if (h.home !== null) {
      if (!Number.isInteger(h.home)) return null;
      if (isFinishedHouse(buildings[h.home as number]) && !homes.has(h.home as number)) {
        home = h.home as number;
        homes.add(home);
      }
    }
    households[id] = { id, last: h.last, home, members, arrived: h.arrived };
  }
  if (seen.size !== Object.keys(residents).length) return null; // a resident in no household
  for (const r of Object.values(residents)) {
    if (!households[r.household]) return null;
    if (r.spouse !== null) {
      const sp = residents[r.spouse];
      if (!sp || sp.spouse !== r.id || sp.household !== r.household) return null;
    }
    if (r.job !== null && !isWorkplace(buildings[r.job])) {
      r.job = null;
      r.commute = null;
    }
  }
  const events: TownEvent[] = [];
  if (Array.isArray(sim.events)) {
    for (const e of sim.events) {
      if (isRecord(e) && isNum(e.at) && typeof e.kind === "string" && EVENT_KINDS.includes(e.kind) && typeof e.text === "string") {
        events.push({ at: e.at, kind: e.kind as EventKind, text: e.text });
      }
    }
  }
  return { residents, households, nextPersonId: nextPerson, nextHouseholdId: nextHouse, events: events.slice(-MAX_EVENTS) };
}

// Saves from before growth have none of these fields: defaults, not an error. Broken buildings
// reset the buildings only; a broken generator state or spawn clock is replaced by a default.
// Saves without (or with broken) residents get the founders back.
function parseGrowth(sim: Record<string, unknown>, city: City, gameMinutes: number) {
  const g = emptyGrowth(seedOf(city.foundedAt), gameMinutes);
  if (sim.buildings !== undefined) {
    const b = parseBuildings(sim.buildings, sim.nextBuildingId);
    if (b) {
      g.buildings = b;
      g.nextBuildingId = sim.nextBuildingId as number;
    }
  }
  const rngOk = Number.isInteger(sim.rng) && (sim.rng as number) >= 0 && (sim.rng as number) < 2 ** 32;
  let rng = rngOk ? (sim.rng as number) : seedOf(city.foundedAt);
  let people = parsePeople(sim, g.buildings);
  if (!people) {
    const f = createFounders(rng, gameMinutes);
    people = f.people;
    rng = f.rng;
  }
  g.rng = rng;
  Object.assign(g, people);
  const ls = sim.lastSpawn;
  if (isRecord(ls) && isNum(ls.res) && isNum(ls.craft) && isNum(ls.trade)) {
    g.lastSpawn = { res: ls.res, craft: ls.craft, trade: ls.trade };
  } else g.lastSpawn = { res: NO_SPAWN, craft: NO_SPAWN, trade: NO_SPAWN };
  return g;
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
  // Cells are rebuilt from roads on load, so broken zone data only costs the paint,
  // never the whole town (a rejected save would send the player back to founding).
  const zones = parseZones(sim.zones) ?? emptyZones();
  return { version: 3, city, sim: { realTime: sim.realTime, gameMinutes: sim.gameMinutes, roads, zones, ...parseGrowth(sim, city, sim.gameMinutes) } };
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
  return { version: 3, city, sim: { realTime: now, gameMinutes: 0, roads: emptyRoads(), zones: emptyZones(), ...emptyGrowth(seedOf(city.foundedAt)) } };
}
