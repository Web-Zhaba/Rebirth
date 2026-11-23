import { DIG, emptyFinds } from "./excavation";
import { initialProgress } from "./tech";
import { emptyLevers } from "./levers";
import { allocateLabor, FRONT_SETBACK, levelHeight, startLevel, BUILDINGS, type BuildingTemplate, type SiteLever } from "./buildings";
import { fieldCentroid } from "./fields";
import { createFounders, FOUNDERS, MOOD_START } from "./people";
import { clearingLogs } from "./clearing";
import { makeIdentityCache } from "./memo";
import { FOUNDATION_LOT, foundationBuilding, FOUNDATION_TAKEN, lotCheck, onReservedGround, OUTLINE_TAKEN } from "./foundationLots";
import { isHeritage } from "./heritage";
import { cellSquare, HERITAGE_TAKEN } from "./heritageGeo";
import { emptyProd, emptyStock, say } from "./production";
import { orderRestoration } from "./restore";
import { nextRandom } from "./rng";
import { CAMP_STORE_ID } from "./storage";
import { attractionOf } from "./attraction";
import { distToEdge, ROAD_KINDS } from "./roads";
import type { Building, Clearing, Finds, PeopleState, RoadEdge, RoadGraph, Site, SimState, TownEvent, LotCell, ZoneState } from "./types";
import { emptyWeather } from "./weather";
import { CELL_SIZE, pointInPolygon, qkey, qpoint, regenerateCells } from "./zones";
import { decimal, L } from "../i18n";

export { nextRandom };
const EPS = 1e-9;
const BUCKET = 32; // m, spatial hash
const LOT_MARGIN = 1; // m, lots are expanded by this when testing cells and occupancy
const ROAD_SLACK = 2; // m, front of a lot may sit this far beyond the road edge

type Growth = Pick<SimState, "buildings" | "clearings" | "nextBuildingId" | "rng" | "stock" | "stores" | "prod" | "coverage" | "landValue" | "chronicle" | "finds" | "articles" | "incoming" | "attraction" | "summary" | "levers" | "progress" | "weather" | "gov" | "history"> & PeopleState;

// A fresh village at game minute `now`: the founders already live in their tents.
export function emptyGrowth(seed: number, now = 0): Growth {
  const f = createFounders(seed >>> 0, now);
  return {
    buildings: {},
    clearings: [],
    nextBuildingId: 1,
    rng: f.rng,
    stock: emptyStock(),
    stores: { [CAMP_STORE_ID]: emptyStock() }, // the founding stock fits the camp
    prod: emptyProd(),
    coverage: {},
    landValue: {},
    chronicle: [],
    finds: emptyFinds(),
    articles: [],
    incoming: [],
    attraction: attractionOf({ food: 1, mood: MOOD_START, unemployment: 0, services: 0, pop: FOUNDERS }), // the founding party: set anew every midnight
    summary: null,
    levers: emptyLevers(),
    progress: initialProgress(),
    weather: emptyWeather(),
    gov: null,
    history: [],
    ...f.people,
  };
}

export const seedOf = (foundedAt: number): number => (Math.floor(foundedAt) ^ 0x9e3779b9) >>> 0;

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

// The buildings' occupancy hash: is a point's cell taken by a building's lot (+1 m)? A stroke lays dozens of candidate
// lots against one town and adds a building on each it keeps, so the hash is built once and added to, never rebuilt.
export interface Occupancy {
  has(x: number, y: number): boolean;
  add(b: Building): void;
}

function emptyOccupancy(): Occupancy {
  const h = new Map<number, Building[]>();
  return {
    has(x, y) {
      const bx = bucketOf(x);
      const by = bucketOf(y);
      for (let ox = -1; ox <= 1; ox++)
        for (let oy = -1; oy <= 1; oy++) {
          const list = h.get(bucketKey(bx + ox, by + oy));
          if (!list) continue;
          for (const b of list) if (inLot(b, x, y, LOT_MARGIN)) return true;
        }
      return false;
    },
    add(b) {
      const k = bucketKey(bucketOf(b.lot.cx), bucketOf(b.lot.cy));
      const list = h.get(k);
      if (list) list.push(b);
      else h.set(k, [b]);
    },
  };
}

function occupancy(buildings: Record<number, Building>): Occupancy {
  const occ = emptyOccupancy();
  for (const b of Object.values(buildings)) occ.add(b);
  return occ;
}

// A town's lot cells by road row, by depth: `at` finds the cell a lot needs without a walk over every cell of the town,
// which is what canPlace did for each candidate. Kept by the zones record (placing buildings never changes them).
export interface CellIndex {
  at(edge: number, side: 1 | -1, i: number, depth: number): LotCell | undefined;
  front(edge: number, side: 1 | -1): ReadonlyMap<number, LotCell>; // its depth-0 cells by i
}

const DEPTHS = 4; // i * DEPTHS + depth: a lot cell's depth is 0..3 (zones.ts MAX_DEPTH)
const NO_ROW: ReadonlyMap<number, LotCell> = new Map();

interface Row {
  all: Map<number, LotCell>;
  front: Map<number, LotCell>;
}

const cellIndexCache = makeIdentityCache((zones: ZoneState): CellIndex => {
  const rows = new Map<number, [Row, Row]>();
  const rowOf = (edge: number): [Row, Row] => {
    let r = rows.get(edge);
    if (!r) rows.set(edge, (r = [{ all: new Map(), front: new Map() }, { all: new Map(), front: new Map() }]));
    return r;
  };
  for (const c of zones.cells) {
    const row = rowOf(c.edge)[c.side === 1 ? 0 : 1];
    row.all.set(c.i * DEPTHS + c.depth, c);
    if (c.depth === 0) row.front.set(c.i, c);
  }
  const rowAt = (edge: number, side: 1 | -1): Row | undefined => rows.get(edge)?.[side === 1 ? 0 : 1];
  return {
    // a depth no cell can have is no cell; without the guard it would pack onto its neighbour's index
    at: (edge, side, i, depth) => (depth < 0 || depth >= DEPTHS ? undefined : rowAt(edge, side)?.all.get(i * DEPTHS + depth)),
    front: (edge, side) => rowAt(edge, side)?.front ?? NO_ROW,
  };
});

export function cellIndex(zones: ZoneState): CellIndex {
  return cellIndexCache(zones);
}

// What a placement check reads of the town, prepared once: canPlace made it again for every candidate lot, which is
// O(candidates × (cells + buildings)) in a stroke (sim/stroke.ts). The cells and the foundations are read from the state
// each time, so only the occupancy hash is held here.
export interface PlaceCtx {
  occ: Occupancy;
  buildings: Record<number, Building>; // the record `occ` was made from
}

export function placeCtx(s: Pick<SimState, "buildings">): PlaceCtx {
  return { occ: occupancy(s.buildings), buildings: s.buildings };
}

// A caller that did not report its placements: the hash is rebuilt from the record it hands back.
function syncPlaceCtx(ctx: PlaceCtx, buildings: Record<number, Building>): void {
  ctx.occ = occupancy(buildings);
  ctx.buildings = buildings;
}

// The caller placed a building itself (the town's last id, as placeBuilding, placeOnFoundation and orderDig leave it):
// the hash gains it. A caller that does not report it is caught up by canPlaceIn, at a walk over the buildings.
export function placedIn(ctx: PlaceCtx, s: Pick<SimState, "buildings" | "nextBuildingId">): void {
  if (s.buildings === ctx.buildings) return;
  const b = s.buildings[s.nextBuildingId - 1];
  ctx.buildings = s.buildings;
  if (b) ctx.occ.add(b);
  else syncPlaceCtx(ctx, s.buildings);
}

// Unit vector pointing away from the road on `side`.
const away = (angle: number, side: 1 | -1): [number, number] => [-Math.sin(angle) * side, Math.cos(angle) * side];

export function makeBuilding(t: BuildingTemplate, c0: LotCell, c1: LotCell, id: number, now: number, site?: Site): Building {
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
    level: startLevel(t.id),
    streak: 0,
  };
  if (site) b.site = site;
  if (t.id === DIG.template) b.radius = DIG.startRadius;
  return b;
}

// ---------- placed buildings ----------

export type PlaceCheck = { ok: true } | { ok: false; reason: string };

const NO_PLACE = (reason: string): PlaceCheck => ({ ok: false, reason });
// One of a kind in a town (the town hall: past it the administration grows by district offices, governance.ts).
const secondOne = (s: Pick<SimState, "buildings">, t: BuildingTemplate): PlaceCheck | null =>
  t.onePerTown && Object.values(s.buildings).some((b) => b.template === t.id) ? NO_PLACE(t.onePerTown) : null;
const pct = (share: number): number => Math.round(share * 100);

// Why a cell of a lot cannot be built on, by its block (zones.ts). Exported for the placement tools and for the test
// that pins the check to the code it replaced.
export const BLOCK_REASON: Record<string, string> = {
  road: L("Здесь дорога", "A road is here"),
  overlap: L("Здесь дорога", "A road is here"),
  field: L("Здесь поле", "A field is here"),
  water: L("Здесь вода", "Water is here"),
  steep: L("Слишком крутой склон", "The slope is too steep"),
  pending: L("Местность ещё изучается", "The terrain is still being surveyed"),
};

// Can `t` stand on the lot whose depth-0 start cell is (edge, side, i)? The lot is t.w x t.d cells.
// Shared by the worker (which enforces it) and the placement tool (which previews it). With `planned`, the road may be
// one not built yet (a stroke: the site waits for it).
export function canPlace(
  s: Pick<SimState, "roads" | "zones" | "buildings"> & { finds?: Finds },
  t: BuildingTemplate,
  edge: number,
  side: 1 | -1,
  i: number,
  site: Site,
  planned = false,
): PlaceCheck {
  return canPlaceIn(placeCtx(s), s, t, edge, side, i, site, planned);
}

// The same check against a prepared town (placeCtx): the cells and the occupancy hash are ready, so a stroke pays once
// for the town and a few cell lookups per candidate. Never answers differently from canPlace.
export function canPlaceIn(
  ctx: PlaceCtx,
  s: Pick<SimState, "roads" | "zones" | "buildings"> & { finds?: Finds },
  t: BuildingTemplate,
  edge: number,
  side: 1 | -1,
  i: number,
  site: Site,
  planned = false,
): PlaceCheck {
  if (t.foundationOnly) return NO_PLACE(L(`${t.name} ставится только на старый фундамент`, `A ${t.name.toLowerCase()} stands only on an old foundation`));
  const one = secondOne(s, t);
  if (one) return one;
  const e = s.roads.edges[edge];
  if (!e) return NO_PLACE(L("Нет такой дороги", "No such road"));
  if (e.done < e.labor && !planned) return NO_PLACE(L("Дорога ещё не построена", "The road is not built yet"));
  if (ctx.buildings !== s.buildings) syncPlaceCtx(ctx, s.buildings);
  const occ = ctx.occ;
  const idx = cellIndex(s.zones);
  const old = s.finds?.foundations ?? [];
  const cells: LotCell[] = [];
  for (let a = 0; a < t.w; a++) {
    for (let d = 0; d < t.d; d++) {
      const c = idx.at(edge, side, i + a, d);
      if (!c) return NO_PLACE(L("Не хватает места вдоль дороги", "Not enough room along the road"));
      if (c.block) return NO_PLACE(BLOCK_REASON[c.block] ?? L("Место занято", "The spot is taken"));
      if (occ.has(c.cx, c.cy)) return NO_PLACE(L("Место занято зданием", "The spot is taken by a building"));
      const under = onReservedGround(old, cellSquare(c));
      if (under) return NO_PLACE(isHeritage(under) ? HERITAGE_TAKEN : under.ghost ? OUTLINE_TAKEN : FOUNDATION_TAKEN);
      cells.push(c);
    }
  }
  const need = t.needs;
  if (need?.forest !== undefined && site.forest < need.forest) return NO_PLACE(L(`Рядом мало леса (нужно от ${pct(need.forest)} %)`, `Too little forest nearby (${pct(need.forest)}% needed)`));
  if (need?.water !== undefined && site.water < need.water) return NO_PLACE(L(`Рядом нет воды (нужно от ${pct(need.water)} %)`, `No water nearby (${pct(need.water)}% needed)`));
  if (t.dryLand) {
    for (const c of cells) {
      const land = s.zones.terrain[qkey(c.cx, c.cy)]?.land;
      if (land === "water" || land === "wetland") return NO_PLACE(L(`${t.name} нельзя ставить на воде и болоте`, `${t.name} can’t be placed on water or marsh`));
    }
  }
  return { ok: true };
}

// Can the player put `t` on the old foundation `foundationId`? (Shared by the worker and the placement tool.)
export function canPlaceOnFoundation(s: Pick<SimState, "roads" | "zones" | "buildings" | "finds" | "progress">, t: BuildingTemplate, foundationId: string, planned = false): PlaceCheck {
  const one = secondOne(s, t);
  if (one) return one;
  const f = s.finds.foundations.find((x) => x.id === foundationId);
  if (!f) return NO_PLACE(L("Нет такого фундамента", "No such foundation"));
  const r = lotCheck(s, f, t, planned);
  return r.ok ? { ok: true } : NO_PLACE(r.reason);
}

// Adds a planned building on the old foundation; one "as it was" starts the site's restoration. Call canPlaceOnFoundation first.
// The town a placement reads and writes: the worker's state, or the main thread's copy for a preview.
export type PlaceState = Pick<SimState, "roads" | "zones" | "buildings" | "finds" | "progress" | "nextBuildingId" | "gameMinutes">;

export function placeOnFoundation<S extends PlaceState>(s: S, t: BuildingTemplate, foundationId: string, planned = false): S {
  const f = s.finds.foundations.find((x) => x.id === foundationId)!;
  const r = lotCheck(s, f, t, planned);
  if (!r.ok) return s;
  const id = s.nextBuildingId;
  const b = waiting(s.roads, foundationBuilding(t, f, r.door, id, s.gameMinutes, s.progress));
  return orderRestoration({ ...s, nextBuildingId: id + 1, buildings: { ...s.buildings, [id]: b } }, b);
}

// Adds a planned building on the lot (waiting for its road while that is not built). Call canPlace first.
export function placeBuilding<S extends Pick<SimState, "roads" | "zones" | "buildings" | "nextBuildingId" | "gameMinutes">>(s: S, t: BuildingTemplate, edge: number, side: 1 | -1, i: number, site?: Site): S {
  const idx = cellIndex(s.zones); // a walk over the cells it was: one lookup now, as a stroke places dozen times a frame
  const c0 = idx.at(edge, side, i, 0)!;
  const far = idx.at(edge, side, i + t.w - 1, t.d - 1)!;
  const id = s.nextBuildingId;
  return { ...s, nextBuildingId: id + 1, buildings: { ...s.buildings, [id]: waiting(s.roads, makeBuilding(t, c0, far, id, s.gameMinutes, site)) } };
}

// ---------- sites waiting for their road ----------

// Is the road of a building built: the front of its lot on a built road, or the door of a building on a foundation
// within reach of one.
export function roadReady(roads: RoadGraph, b: Building): boolean {
  let x: number;
  let y: number;
  let reach: (e: RoadEdge) => number;
  if (b.foundationId && b.door) {
    [x, y] = b.door;
    reach = () => FOUNDATION_LOT.roadReach;
  } else {
    const [vx, vy] = away(b.lot.angle, b.side);
    const front = (CELL_SIZE * b.lot.d) / 2;
    x = b.lot.cx - vx * front;
    y = b.lot.cy - vy * front;
    reach = (e) => ROAD_KINDS[e.kind].width / 2 + ROAD_SLACK;
  }
  for (const e of Object.values(roads.edges)) if (e.done >= e.labor && distToEdge(roads, e, x, y) <= reach(e)) return true;
  return false;
}

// A planned building whose road is not built yet waits for it.
function waiting(roads: RoadGraph, b: Building): Building {
  return b.state === "planned" && !roadReady(roads, b) ? { ...b, awaitsRoad: true } : b;
}

// The sites whose road got built stop waiting. Returns the same record when none did.
export function releaseSites(buildings: Record<number, Building>, roads: RoadGraph): Record<number, Building> {
  let out = buildings;
  for (const b of Object.values(buildings)) {
    if (!b.awaitsRoad || !roadReady(roads, b)) continue;
    if (out === buildings) out = { ...buildings };
    const { awaitsRoad: _w, ...rest } = b;
    out[b.id] = rest;
  }
  return out;
}

// ---------- construction ----------

// Spends person-hours on the open sites as allocateLabor splits them (a crew of CREW hands each, oldest first);
// returns the same record when nothing changed. `crewHours` is the work of one crew in this tick.
export function advanceBuildings(buildings: Record<number, Building>, personHours: number, crewHours = Infinity, clearings: readonly Clearing[] = [], first = false, lever?: SiteLever): Record<number, Building> {
  let out = buildings;
  for (const [id, use] of allocateLabor(buildings, personHours, crewHours, clearings, first, lever)) {
    const b = buildings[id];
    if (out === buildings) out = { ...buildings };
    if (b.state === "active") {
      const up = b.upgrade!;
      const done = use >= up.labor - up.done - EPS ? up.labor : up.done + use;
      const { upgrade: _u, ...rest } = b;
      out[id] = done >= up.labor ? { ...rest, level: b.level + 1, height: Math.round((b.height + levelHeight(b)) * 100) / 100 } : { ...b, upgrade: { ...up, done } };
    } else {
      const done = use >= b.labor - b.done - EPS ? b.labor : b.done + use;
      out[id] = { ...b, done, state: done >= b.labor ? "active" : "building" };
    }
  }
  return out;
}

// A "built" notice for every building that became active (or raised by a level or floor) between the two records.
export function reportBuilt(before: Record<number, Building>, after: Record<number, Building>, events: TownEvent[], now: number): TownEvent[] {
  if (after === before) return events;
  let out = events;
  for (const b of Object.values(after)) {
    const was = before[b.id];
    if (!was) continue;
    const pos: [number, number] = [b.lot.cx, b.lot.cy];
    if ((b.asItWas || BUILDINGS[b.template]?.workSite) && b.state === "active" && was.state !== "active") continue; // a restoration or a dig has its own notice
    if (b.state === "active" && was.state !== "active") out = say(out, now, "built", `${L("Достроено", "Finished")}: ${(BUILDINGS[b.template]?.name ?? b.template).toLowerCase()}`, pos);
    else if (b.level > was.level) out = say(out, now, "built", b.foundationId ? L(`Надстроен этаж: ${(BUILDINGS[b.template]?.name ?? b.template).toLowerCase()}`, `A floor added: ${(BUILDINGS[b.template]?.name ?? b.template).toLowerCase()}`) : L("Дом расширен", "House expanded"), pos);
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
    events = say(events, s.gameMinutes, "clearing", L(`Вырубка закончена: ${decimal((c.area / 10_000).toFixed(2))} га, брёвен +${Math.round(clearingLogs(c.area, c.forest))} м³`, `Clearing finished: ${decimal((c.area / 10_000).toFixed(2))} ha, logs +${Math.round(clearingLogs(c.area, c.forest))} m³`), fieldCentroid(c));
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
  return { ...z, terrain, cells: regenerateCells(roads, z.fields, terrain), rev: z.rev + 1 };
}

// ---------- reconcile ----------

// Drops buildings whose road is gone (no refund): the front of a lot must stay on a road. A building on an old
// foundation stands on its own ring. Returns the same record when all survive.
export function reconcile(buildings: Record<number, Building>, roads: RoadGraph): Record<number, Building> {
  const list = Object.values(buildings);
  if (list.length === 0) return buildings;
  const edges = Object.values(roads.edges);
  let out = buildings;
  for (const b of list) {
    if (!survives(b, edges, roads)) {
      if (out === buildings) out = { ...buildings };
      delete out[b.id];
    }
  }
  return out;
}

function survives(b: Building, edges: RoadEdge[], roads: RoadGraph): boolean {
  if (b.foundationId) return true;
  const [vx, vy] = away(b.lot.angle, b.side);
  const front = (CELL_SIZE * b.lot.d) / 2;
  const fx = b.lot.cx - vx * front;
  const fy = b.lot.cy - vy * front;
  return edges.some((e) => distToEdge(roads, e, fx, fy) <= ROAD_KINDS[e.kind].width / 2 + ROAD_SLACK);
}
