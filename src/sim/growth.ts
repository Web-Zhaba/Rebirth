import { DIG, emptyFinds } from "./excavation";
import { BUILDINGS, FRONT_SETBACK, houseCapacity, templatesOf, UPGRADE, type BuildingTemplate } from "./buildings";
import { jobsOf } from "./fields";
import { createFounders, peopleStats, vacantHouses } from "./people";
import { emptyProd, emptyStock } from "./production";
import { nextRandom } from "./rng";
import { distToEdge, ROAD_KINDS } from "./roads";
import type { Building, Demand, PeopleState, RoadEdge, RoadGraph, Site, SimState, ZoneCell, ZoneType } from "./types";
import { CELL_SIZE, paintCells, qkey } from "./zones";

export { nextRandom };
export type { Demand };
export const SPAWN_INTERVAL = 60; // game minutes between new buildings of one zone type
export const NO_SPAWN = -SPAWN_INTERVAL; // lastSpawn value that allows a spawn at once

// All demand tuning lives here.
export const DEMAND = {
  resBase: 1.5,
  resPerVacancy: 0.5, // per unfilled job
  craftShare: 0.2, // craft jobs wanted per resident
  craftJobs: 3, // jobs per workshop, for the craft demand count
  craftPerUnemployed: 1 / 6,
  tradeShare: 0.07,
  tradeJobs: 2,
};

const ZONE_ORDER: ZoneType[] = ["res", "craft", "trade"];
const EPS = 1e-9;
const BUCKET = 32; // m, spatial hash
const LOT_MARGIN = 1; // m, lots are expanded by this when testing cells and occupancy
const ROAD_SLACK = 2; // m, front of a lot may sit this far beyond the road edge
const KEEP_SHARE = 0.6;

type Growth = Pick<SimState, "buildings" | "nextBuildingId" | "rng" | "lastSpawn" | "stock" | "prod" | "coverage" | "landValue" | "chronicle" | "finds" | "articles"> & PeopleState;

// A fresh village at game minute `now`: the founders already live in their tents.
export function emptyGrowth(seed: number, now = 0): Growth {
  const f = createFounders(seed >>> 0, now);
  return {
    buildings: {},
    nextBuildingId: 1,
    rng: f.rng,
    lastSpawn: { res: NO_SPAWN, craft: NO_SPAWN, trade: NO_SPAWN },
    stock: emptyStock(),
    prod: emptyProd(),
    coverage: {},
    landValue: {},
    chronicle: [],
    finds: emptyFinds(),
    articles: [],
    ...f.people,
  };
}

export const seedOf = (foundedAt: number): number => (Math.floor(foundedAt) ^ 0x9e3779b9) >>> 0;

// ---------- stats and demand ----------

export interface TownStats {
  houseCap: number; // capacity of all houses, finished or not
  unfinishedHouses: number;
  craftJobs: number; // over all craft buildings, finished or not
  tradeJobs: number;
  jobsFinished: number; // jobs in finished workplaces
}

// `jobs` overrides the template's job count (a gumno's depends on its fields).
export function townStats(buildings: Record<number, Building>, jobs: (b: Building) => number = (b) => BUILDINGS[b.template]?.jobs ?? 0): TownStats {
  let houseCap = 0;
  let unfinishedHouses = 0;
  let craftJobs = 0;
  let tradeJobs = 0;
  let jobsFinished = 0;
  for (const b of Object.values(buildings)) {
    const t = BUILDINGS[b.template];
    if (!t) continue;
    if (b.zone === "res") {
      houseCap += houseCapacity(b);
      if (b.state !== "active") unfinishedHouses++;
    } else {
      const n = jobs(b);
      if (b.zone === "craft") craftJobs += n;
      else if (b.zone === "trade") tradeJobs += n;
      if (b.state === "active") jobsFinished += n;
    }
  }
  return { houseCap, unfinishedHouses, craftJobs, tradeJobs, jobsFinished };
}

// Wanted new buildings per zone type (may be negative).
export function demand(s: Pick<SimState, "buildings" | "roads" | "residents" | "households" | "gameMinutes" | "zones" | "prod" | "stock">): Demand {
  const st = townStats(s.buildings, (b) => jobsOf(b, s));
  const ps = peopleStats(s);
  const vacant = vacantHouses(s.buildings, s.households).length;
  const jobVacancies = st.jobsFinished - ps.employed;
  return {
    res: DEMAND.resBase + DEMAND.resPerVacancy * jobVacancies - vacant - st.unfinishedHouses + ps.tents,
    craft: (DEMAND.craftShare * ps.pop - st.craftJobs) / DEMAND.craftJobs + DEMAND.craftPerUnemployed * ps.unemployed,
    trade: (DEMAND.tradeShare * ps.pop - st.tradeJobs) / DEMAND.tradeJobs,
  };
}

// ---------- geometry ----------

const bucketKey = (bx: number, by: number) => bx * 65536 + by;
const bucketOf = (v: number) => Math.floor(v / BUCKET);

// Is (x, y) inside the building's lot rectangle expanded by `margin`?
function inLot(b: Building, x: number, y: number, margin: number): boolean {
  const { cx, cy, angle, w, d } = b.lot;
  const dx = x - cx;
  const dy = y - cy;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return Math.abs(dx * c + dy * s) <= (CELL_SIZE * w) / 2 + margin && Math.abs(-dx * s + dy * c) <= (CELL_SIZE * d) / 2 + margin;
}

function hashBy<T>(items: Iterable<T>, pos: (t: T) => [number, number]): Map<number, T[]> {
  const m = new Map<number, T[]>();
  for (const it of items) {
    const [x, y] = pos(it);
    const k = bucketKey(bucketOf(x), bucketOf(y));
    const list = m.get(k);
    if (list) list.push(it);
    else m.set(k, [it]);
  }
  return m;
}

function near<T>(h: Map<number, T[]>, x: number, y: number): T[] {
  const out: T[] = [];
  const bx = bucketOf(x);
  const by = bucketOf(y);
  for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) out.push(...(h.get(bucketKey(bx + ox, by + oy)) ?? []));
  return out;
}

// A cell is occupied when its centre lies in a building's lot rectangle (+1 m).
function occupancy(buildings: Record<number, Building>): (x: number, y: number) => boolean {
  const list = Object.values(buildings);
  if (list.length === 0) return () => false;
  const h = hashBy(list, (b) => [b.lot.cx, b.lot.cy]);
  return (x, y) => near(h, x, y).some((b) => inLot(b, x, y, LOT_MARGIN));
}

export function occupiedKeys(cells: readonly ZoneCell[], buildings: Record<number, Building>): Set<string> {
  const occ = occupancy(buildings);
  const out = new Set<string>();
  for (const c of cells) if (!c.block && c.zone !== "none" && occ(c.cx, c.cy)) out.add(c.key);
  return out;
}

// Unit vector pointing away from the road on `side`.
const away = (angle: number, side: 1 | -1): [number, number] => [-Math.sin(angle) * side, Math.cos(angle) * side];

export function makeBuilding(t: BuildingTemplate, c0: ZoneCell, c1: ZoneCell, id: number, now: number, site?: Site): Building {
  const { side, angle } = c0;
  const cx = (c0.cx + c1.cx) / 2;
  const cy = (c0.cy + c1.cy) / 2;
  const ux = Math.cos(angle);
  const uy = Math.sin(angle);
  const [vx, vy] = away(angle, side);
  const v0 = -(CELL_SIZE * t.d) / 2 + FRONT_SETBACK;
  const v1 = v0 + t.deep;
  const h = t.along / 2;
  const at = (u: number, v: number): [number, number] => [cx + ux * u + vx * v, cy + uy * u + vy * v];
  const pts: [number, number][] = [at(-h, v0), at(h, v0), at(h, v1), at(-h, v1)];
  // (u, v) is right-handed on the left side of the road only.
  const footprint = side === 1 ? pts : pts.reverse();
  const b: Building = {
    id,
    template: t.id,
    zone: t.zone,
    lot: { cx, cy, angle, w: t.w, d: t.d },
    side,
    footprint,
    height: t.height,
    state: "planned",
    labor: t.labor,
    done: 0,
    created: now,
    paid: false,
    level: 1,
    streak: 0,
  };
  if (site) b.site = site;
  if (t.id === DIG.template) b.radius = DIG.startRadius;
  return b;
}

// ---------- spawning ----------

interface Lot {
  c0: ZoneCell;
  fits: [BuildingTemplate, ZoneCell][]; // template and the far corner cell of its lot
}

function findLots(s: SimState, zone: ZoneType): Lot[] {
  const built = new Set<number>();
  for (const e of Object.values(s.roads.edges)) if (e.done >= e.labor) built.add(e.id);
  const occ = occupancy(s.buildings);
  const free = new Map<string, ZoneCell>();
  for (const c of s.zones.cells) {
    if (c.zone === zone && !c.block && built.has(c.edge) && !occ(c.cx, c.cy)) free.set(c.key, c);
  }
  const starts = [...free.values()].filter((c) => c.depth === 0);
  starts.sort((p, q) => p.edge - q.edge || q.side - p.side || p.i - q.i);
  const tpls = templatesOf(zone);
  const lots: Lot[] = [];
  for (const c0 of starts) {
    const fits: Lot["fits"] = [];
    for (const t of tpls) {
      let ok = true;
      for (let a = 0; a < t.w && ok; a++) {
        for (let b = 0; b < t.d && ok; b++) ok = free.has(`${c0.edge}:${c0.side}:${c0.i + a}:${b}`);
      }
      if (ok) fits.push([t, free.get(`${c0.edge}:${c0.side}:${c0.i + t.w - 1}:${t.d - 1}`)!]);
    }
    if (fits.length > 0) lots.push({ c0, fits });
  }
  return lots;
}

// At most one new building per zone type per game hour, when demand asks for it.
export function spawnBuildings(s: SimState): SimState {
  let cur = s;
  for (const zone of ZONE_ORDER) {
    if (cur.gameMinutes - cur.lastSpawn[zone] < SPAWN_INTERVAL) continue;
    if (demand(cur)[zone] < 1) continue;
    const lots = findLots(cur, zone);
    if (lots.length === 0) continue;
    const [r1, rng1] = nextRandom(cur.rng);
    const [r2, rng2] = nextRandom(rng1);
    const lot = lots[Math.min(lots.length - 1, Math.floor(r1 * lots.length))];
    const [t, far] = lot.fits[Math.min(lot.fits.length - 1, Math.floor(r2 * lot.fits.length))];
    const id = cur.nextBuildingId;
    cur = {
      ...cur,
      rng: rng2,
      nextBuildingId: id + 1,
      buildings: { ...cur.buildings, [id]: makeBuilding(t, lot.c0, far, id, cur.gameMinutes) },
      lastSpawn: { ...cur.lastSpawn, [zone]: cur.gameMinutes },
    };
  }
  return cur;
}

// ---------- placed buildings ----------

export type PlaceCheck = { ok: true } | { ok: false; reason: string };

const NO_PLACE = (reason: string): PlaceCheck => ({ ok: false, reason });
export const PLACE_MIN = { forest: 0.1, water: 0.05 }; // site shares the woodcutter and the fisher need

const BLOCK_REASON: Record<string, string> = {
  road: "Здесь дорога",
  overlap: "Здесь дорога",
  field: "Здесь поле",
  water: "Здесь вода",
  steep: "Слишком крутой склон",
  pending: "Местность ещё изучается",
};

// Can `t` stand on the lot whose depth-0 start cell is (edge, side, i)? The lot is t.w x t.d cells.
// Shared by the worker (which enforces it) and the placement tool (which previews it).
export function canPlace(
  s: Pick<SimState, "roads" | "zones" | "buildings">,
  t: BuildingTemplate,
  edge: number,
  side: 1 | -1,
  i: number,
  site: Site,
): PlaceCheck {
  if (t.zone !== "placed") return NO_PLACE("Это здание строится само");
  const e = s.roads.edges[edge];
  if (!e) return NO_PLACE("Нет такой дороги");
  if (e.done < e.labor) return NO_PLACE("Дорога ещё не построена");
  const byKey = new Map<string, ZoneCell>();
  for (const c of s.zones.cells) if (c.edge === edge && c.side === side) byKey.set(c.key, c);
  const occ = occupancy(s.buildings);
  const cells: ZoneCell[] = [];
  for (let a = 0; a < t.w; a++) {
    for (let d = 0; d < t.d; d++) {
      const c = byKey.get(`${edge}:${side}:${i + a}:${d}`);
      if (!c) return NO_PLACE("Не хватает места вдоль дороги");
      if (c.block) return NO_PLACE(BLOCK_REASON[c.block] ?? "Место занято");
      if (occ(c.cx, c.cy)) return NO_PLACE("Место занято зданием");
      cells.push(c);
    }
  }
  if (t.id === "woodcutter" && site.forest < PLACE_MIN.forest) return NO_PLACE("Рядом мало леса (нужно от 10 %)");
  if (t.id === "fisher" && site.water < PLACE_MIN.water) return NO_PLACE("Рядом нет воды (нужно от 5 %)");
  if (t.id === "quarry") {
    for (const c of cells) {
      const land = s.zones.terrain[qkey(c.cx, c.cy)]?.land;
      if (land === "water" || land === "wetland") return NO_PLACE("Каменоломню нельзя ставить на воде и болоте");
    }
  }
  return { ok: true };
}

// Adds a planned building on the lot and clears the painted zone under it. Call canPlace first.
export function placeBuilding(s: SimState, t: BuildingTemplate, edge: number, side: 1 | -1, i: number, site: Site): SimState {
  const key = (a: number, d: number) => `${edge}:${side}:${i + a}:${d}`;
  const c0 = s.zones.cells.find((c) => c.key === key(0, 0))!;
  const far = s.zones.cells.find((c) => c.key === key(t.w - 1, t.d - 1))!;
  const keys: string[] = [];
  for (let a = 0; a < t.w; a++) for (let d = 0; d < t.d; d++) keys.push(key(a, d));
  const id = s.nextBuildingId;
  return {
    ...s,
    nextBuildingId: id + 1,
    buildings: { ...s.buildings, [id]: makeBuilding(t, c0, far, id, s.gameMinutes, site) },
    zones: { ...s.zones, cells: paintCells(s.zones.cells, keys, "none"), rev: s.zones.rev + 1 },
  };
}

// ---------- construction ----------

// Spends person-hours FIFO (lowest id first); returns the same record when nothing changed.
export function advanceBuildings(buildings: Record<number, Building>, personHours: number): Record<number, Building> {
  let out = buildings;
  let left = personHours;
  for (const key of Object.keys(buildings)) {
    if (left <= EPS) break;
    const b = buildings[Number(key)];
    if (b.state === "active") {
      if (b.upgrade) {
        const up = b.upgrade;
        const rem = up.labor - up.done;
        const use = Math.max(0, Math.min(left, rem));
        left -= use;
        const done = use >= rem - EPS ? up.labor : up.done + use;
        if (out === buildings) out = { ...buildings };
        const { upgrade: _u, ...rest } = b;
        out[b.id] = done >= up.labor ? { ...rest, level: 2, height: b.height + UPGRADE.height } : { ...b, upgrade: { ...up, done } };
      }
      continue;
    }
    const remain = b.labor - b.done;
    const spend = Math.max(0, Math.min(left, remain));
    left -= spend;
    const done = spend >= remain - EPS ? b.labor : b.done + spend;
    if (out === buildings) out = { ...buildings };
    out[b.id] = { ...b, done, state: done >= b.labor ? "active" : "building" };
  }
  return out;
}

// ---------- reconcile ----------

// Drops buildings whose road or zoned ground is gone (no refund). Returns the same record when all survive.
export function reconcile(buildings: Record<number, Building>, roads: RoadGraph, cells: readonly ZoneCell[]): Record<number, Building> {
  const list = Object.values(buildings);
  if (list.length === 0) return buildings;
  const edges = Object.values(roads.edges);
  const hash = hashBy(cells, (c) => [c.cx, c.cy]);
  let out = buildings;
  for (const b of list) {
    if (!survives(b, edges, roads, hash)) {
      if (out === buildings) out = { ...buildings };
      delete out[b.id];
    }
  }
  return out;
}

function survives(b: Building, edges: RoadEdge[], roads: RoadGraph, hash: Map<number, ZoneCell[]>): boolean {
  const [vx, vy] = away(b.lot.angle, b.side);
  const front = (CELL_SIZE * b.lot.d) / 2;
  const fx = b.lot.cx - vx * front;
  const fy = b.lot.cy - vy * front;
  if (!edges.some((e) => distToEdge(roads, e, fx, fy) <= ROAD_KINDS[e.kind].width / 2 + ROAD_SLACK)) return false;
  if (b.zone === "placed") return true; // kept until its road goes or it is demolished
  let total = 0;
  let good = 0;
  for (const c of near(hash, b.lot.cx, b.lot.cy)) {
    if (!inLot(b, c.cx, c.cy, LOT_MARGIN)) continue;
    total++;
    if (!c.block && c.zone === b.zone) good++;
  }
  return total > 0 && good / total >= KEEP_SHARE - EPS;
}
