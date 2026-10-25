import { DIG, emptyFinds } from "./excavation";
import { allocateLabor, BUILDINGS, FRONT_SETBACK, houseCapacity, templatesOf, UPGRADE, type BuildingTemplate } from "./buildings";
import { fieldCentroid, jobsOf } from "./fields";
import { createFounders, peopleStats, vacantHouses } from "./people";
import { clearingLogs } from "./clearing";
import { emptyProd, emptyStock, handHours, say } from "./production";
import { nextRandom } from "./rng";
import { distToEdge, ROAD_KINDS } from "./roads";
import type { Building, Clearing, Demand, GrowthAdvice, GrowthWhy, PeopleState, RoadEdge, RoadGraph, Site, SimState, TownEvent, ZoneCell, ZoneState, ZoneType } from "./types";
import { CELL_SIZE, paintCells, pointInPolygon, qkey, qpoint, regenerateCells } from "./zones";

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

type Growth = Pick<SimState, "buildings" | "clearings" | "nextBuildingId" | "rng" | "lastSpawn" | "stock" | "prod" | "coverage" | "landValue" | "chronicle" | "finds" | "articles" | "incoming" | "attract"> & PeopleState;

// A fresh village at game minute `now`: the founders already live in their tents.
export function emptyGrowth(seed: number, now = 0): Growth {
  const f = createFounders(seed >>> 0, now);
  return {
    buildings: {},
    clearings: [],
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
    incoming: [],
    attract: 0,
    ...f.people,
  };
}

export const seedOf = (foundedAt: number): number => (Math.floor(foundedAt) ^ 0x9e3779b9) >>> 0;

// ---------- stats and demand ----------

export interface TownStats {
  houseCap: number; // capacity of all houses, finished or not
  unfinishedHouses: number;
  startedHouses: number; // unfinished houses the artel has begun
  craftJobs: number; // over all craft buildings, finished or not
  tradeJobs: number;
  jobsFinished: number; // jobs in finished workplaces
}

// `jobs` overrides the template's job count (a gumno's depends on its fields).
export function townStats(buildings: Record<number, Building>, jobs: (b: Building) => number = (b) => BUILDINGS[b.template]?.jobs ?? 0): TownStats {
  let houseCap = 0;
  let unfinishedHouses = 0;
  let startedHouses = 0;
  let craftJobs = 0;
  let tradeJobs = 0;
  let jobsFinished = 0;
  for (const b of Object.values(buildings)) {
    const t = BUILDINGS[b.template];
    if (!t) continue;
    if (b.zone === "res") {
      houseCap += houseCapacity(b);
      if (b.state !== "active") unfinishedHouses++;
      if (b.state === "building") startedHouses++;
    } else {
      const n = jobs(b);
      if (b.zone === "craft") craftJobs += n;
      else if (b.zone === "trade") tradeJobs += n;
      if (b.state === "active") jobsFinished += n;
    }
  }
  return { houseCap, unfinishedHouses, startedHouses, craftJobs, tradeJobs, jobsFinished };
}

// Wanted new buildings per zone type (may be negative).
// A house under construction counts half against demand (a planned one in full, so the queue stays short),
// a house promised to a family on its way counts as occupied.
export const UNFINISHED_WEIGHT = 0.5;

export function demand(s: Pick<SimState, "buildings" | "roads" | "residents" | "households" | "gameMinutes" | "zones" | "prod" | "stock" | "incoming">): Demand {
  const st = townStats(s.buildings, (b) => jobsOf(b, s));
  const ps = peopleStats(s);
  const promised = new Set(s.incoming.map((f) => f.house));
  const vacant = vacantHouses(s.buildings, s.households).filter((id) => !promised.has(id)).length;
  const jobVacancies = st.jobsFinished - ps.employed;
  return {
    res: DEMAND.resBase + DEMAND.resPerVacancy * jobVacancies - vacant - (st.unfinishedHouses - st.startedHouses) - UNFINISHED_WEIGHT * st.startedHouses + ps.tents,
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

function findLots(s: Pick<SimState, "roads" | "buildings" | "zones">, zone: ZoneType): Lot[] {
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

// Why a zone type is not growing, in the order a player can fix it: nothing painted, no demand, no free lot
// beside a built road, no hands in the artel, materials made by hand. "ok" = it grows (or a site is in work).
export function growthAdvice(s: SimState, dem: Demand, builders: number): GrowthAdvice {
  const painted = new Set<ZoneType>();
  for (const c of s.zones.cells) if (!c.block && c.zone !== "none") painted.add(c.zone);
  const open = Object.values(s.buildings).filter((b) => b.state !== "active" && b.zone !== "placed");
  const why = (zone: ZoneType): GrowthWhy => {
    if (!painted.has(zone)) return "nozone";
    const sites = open.filter((b) => b.zone === zone);
    if (sites.length > 0) {
      if (builders === 0) return "hands";
      if (sites.some((b) => !b.paid && b.state === "planned" && handHours(BUILDINGS[b.template]?.materials ?? { logs: 0, planks: 0, stone: 0 }, s.stock) > 0)) return "materials";
    }
    if (dem[zone] < 1) return sites.length > 0 ? "ok" : "demand";
    return findLots(s, zone).length > 0 ? "ok" : "lots";
  };
  return { res: why("res"), craft: why("craft"), trade: why("trade") };
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

// Spends person-hours on the open sites as allocateLabor splits them (a crew of CREW hands each, oldest first);
// returns the same record when nothing changed. `crewHours` is the work of one crew in this tick.
export function advanceBuildings(buildings: Record<number, Building>, personHours: number, crewHours = Infinity, clearings: readonly Clearing[] = [], first = false): Record<number, Building> {
  let out = buildings;
  for (const [id, use] of allocateLabor(buildings, personHours, crewHours, clearings, first)) {
    const b = buildings[id];
    if (out === buildings) out = { ...buildings };
    if (b.state === "active") {
      const up = b.upgrade!;
      const done = use >= up.labor - up.done - EPS ? up.labor : up.done + use;
      const { upgrade: _u, ...rest } = b;
      out[id] = done >= up.labor ? { ...rest, level: 2, height: b.height + UPGRADE.height } : { ...b, upgrade: { ...up, done } };
    } else {
      const done = use >= b.labor - b.done - EPS ? b.labor : b.done + use;
      out[id] = { ...b, done, state: done >= b.labor ? "active" : "building" };
    }
  }
  return out;
}

// A "built" notice for every building that became active (or an izba rebuilt to level 2) between the two records.
export function reportBuilt(before: Record<number, Building>, after: Record<number, Building>, events: TownEvent[], now: number): TownEvent[] {
  if (after === before) return events;
  let out = events;
  for (const b of Object.values(after)) {
    const was = before[b.id];
    if (!was) continue;
    const pos: [number, number] = [b.lot.cx, b.lot.cy];
    if (b.state === "active" && was.state !== "active") out = say(out, now, "built", `Достроено: ${(BUILDINGS[b.template]?.name ?? b.template).toLowerCase()}`, pos);
    else if (b.level >= 2 && was.level < 2) out = say(out, now, "built", "Изба перестроена", pos);
  }
  return out;
}

// Credits the logs of the work each clearing received (a share of its total, by labor done). A clearing that
// finishes turns the forest in its sampled terrain into meadow and regenerates the cells; each one is an event.
export function advanceClearings(s: SimState, use: Map<number, number>): SimState {
  if (use.size === 0) return s;
  let logs = 0;
  const finished: Clearing[] = [];
  const clearings = s.clearings.map((c) => {
    const h = use.get(c.id);
    if (!h) return c;
    const done = h >= c.labor - c.done - EPS ? c.labor : c.done + h;
    logs += (clearingLogs(c.area, c.forest) * (done - c.done)) / c.labor;
    const next = { ...c, done };
    if (done >= c.labor) finished.push(next);
    return next;
  });
  let events = s.events;
  for (const c of finished) {
    events = say(events, s.gameMinutes, "clearing", `Вырубка закончена: ${(c.area / 10_000).toFixed(2).replace(".", ",")} га, брёвен +${Math.round(clearingLogs(c.area, c.forest))} м³`, fieldCentroid(c));
  }
  const zones = finished.length > 0 ? clearTerrain(s.zones, s.roads, finished) : s.zones;
  return { ...s, clearings, events, zones, stock: { ...s.stock, logs: s.stock.logs + logs } };
}

// Sampled forest inside the polygons becomes meadow; the cells are regenerated (rev bumped) when anything changed.
function clearTerrain(z: ZoneState, roads: RoadGraph, done: readonly Clearing[]): ZoneState {
  let terrain = z.terrain;
  for (const [key, t] of Object.entries(z.terrain)) {
    if (t.land !== "forest") continue;
    const [x, y] = qpoint(key);
    if (!done.some((c) => pointInPolygon(x, y, c.pts))) continue;
    if (terrain === z.terrain) terrain = { ...z.terrain };
    terrain[key] = { ...t, land: "meadow" };
  }
  if (terrain === z.terrain) return z;
  return { ...z, terrain, cells: regenerateCells(roads, z.cells, z.fields, terrain), rev: z.rev + 1 };
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
