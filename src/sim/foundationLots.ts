import { BUILDINGS, templatesOf, type BuildingTemplate, type Materials } from "./buildings";
import { centroid, pointInRing } from "./excavation";
import { isHeritage } from "./heritage";
import { orientedBox, polysOverlap, ringDoor, simplifyRing } from "./heritageGeo";
import { distToEdge, ROAD_KINDS } from "./roads";
import type { Building, FoundFoundation, RoadGraph, Site, SimState, ZoneCell, ZoneType } from "./types";
import { CELL_SIZE } from "./zones";
import { L } from "../i18n";

// Old foundations as building lots (PLAN.md section 12). A foundation of a usable size is a lot of its own: a zone grows
// its buildings there first, and the player can put a building on it. The building takes the foundation's ring as its
// footprint, so its walls follow the old walls. Rectangular lots never cover such a foundation. Whether a foundation is
// built on is derived (a building with its `foundationId`), so a demolition frees it again with nothing to undo.

type Pt = [number, number];

export const FOUNDATION_LOT = {
  minArea: 20, // m2: smaller rings (sheds) are no lots and do not reserve their ground
  fitMin: 0.4, // a template fits a ring of fitMin..fitMax times its own footprint area
  fitMax: 4,
  roadReach: 30, // m from the ring to a built road
  maxPoints: 12, // points of the footprint: the ring is simplified to this, so roofs stay buildable
  probe: 2, // m between the points along the ring tested against roads
};

// Templates that are open ground or depend on their surroundings (a garden, a pier, a log yard...): never on a foundation.
const OPEN_GROUND = new Set(["garden", "orchard", "apiary", "quarry", "dig", "forager", "fisher", "well", "woodcutter", "sawpit", "restored"]);

export const usesFoundation = (t: BuildingTemplate): boolean => !OPEN_GROUND.has(t.id);
const nominal = (t: BuildingTemplate): number => t.along * t.deep;
export const fitsArea = (t: BuildingTemplate, area: number): boolean => area >= Math.max(FOUNDATION_LOT.minArea, nominal(t) * FOUNDATION_LOT.fitMin) && area <= nominal(t) * FOUNDATION_LOT.fitMax;

// The largest ring any template can take; bigger ones are no lots (and regular lots may cover them).
const MAX_FIT = Math.max(...Object.values(BUILDINGS).filter(usesFoundation).map((t) => nominal(t) * FOUNDATION_LOT.fitMax));

// A heritage site keeps its own restoration; every other foundation of a usable size is a lot.
const isLotFoundation = (f: FoundFoundation): boolean => f.area >= FOUNDATION_LOT.minArea && f.area <= MAX_FIT && !(isHeritage(f) && f.state !== "lost");

// ---------- spatial index ----------

const BUCKET = 32; // m
const key = (bx: number, by: number) => bx * 65536 + by;

interface Indexed {
  f: FoundFoundation;
  box: [number, number, number, number];
}

export interface FoundationIndex {
  near(x0: number, y0: number, x1: number, y1: number): Indexed[];
  at(x: number, y: number): FoundFoundation | null; // the smallest foundation whose ring holds the point
}

const indexCache = new WeakMap<readonly FoundFoundation[], FoundationIndex>();

// Index of a foundation list (cached per list: finds are immutable, a change makes a new list).
export function foundationIndex(list: readonly FoundFoundation[]): FoundationIndex {
  const hit = indexCache.get(list);
  if (hit) return hit;
  const grid = new Map<number, Indexed[]>();
  for (const f of list) {
    if (f.ring.length < 3) continue;
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const [x, y] of f.ring) {
      if (x < x0) x0 = x;
      if (y < y0) y0 = y;
      if (x > x1) x1 = x;
      if (y > y1) y1 = y;
    }
    const it: Indexed = { f, box: [x0, y0, x1, y1] };
    for (let bx = Math.floor(x0 / BUCKET); bx <= Math.floor(x1 / BUCKET); bx++)
      for (let by = Math.floor(y0 / BUCKET); by <= Math.floor(y1 / BUCKET); by++) {
        const k = key(bx, by);
        const cell = grid.get(k);
        if (cell) cell.push(it);
        else grid.set(k, [it]);
      }
  }
  const near = (x0: number, y0: number, x1: number, y1: number): Indexed[] => {
    const out = new Set<Indexed>();
    for (let bx = Math.floor(x0 / BUCKET); bx <= Math.floor(x1 / BUCKET); bx++)
      for (let by = Math.floor(y0 / BUCKET); by <= Math.floor(y1 / BUCKET); by++)
        for (const it of grid.get(key(bx, by)) ?? []) if (!(it.box[2] < x0 || it.box[0] > x1 || it.box[3] < y0 || it.box[1] > y1)) out.add(it);
    return [...out];
  };
  const idx: FoundationIndex = {
    near,
    at(x, y) {
      let best: FoundFoundation | null = null;
      for (const { f } of near(x, y, x, y)) if ((!best || f.area < best.area) && pointInRing(x, y, f.ring)) best = f;
      return best;
    },
  };
  indexCache.set(list, idx);
  return idx;
}

// Does a polygon (a lot cell) lie on a foundation that is a lot or a heritage site still standing? Regular lots avoid them.
export function onReservedGround(list: readonly FoundFoundation[], poly: readonly Pt[]): FoundFoundation | null {
  if (list.length === 0) return null;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const [x, y] of poly) {
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  }
  for (const { f } of foundationIndex(list).near(x0, y0, x1, y1)) {
    if (!isLotFoundation(f) && !(isHeritage(f) && f.state !== "lost")) continue;
    if (polysOverlap(poly, f.ring)) return f;
  }
  return null;
}

export const FOUNDATION_TAKEN = L("Здесь старый фундамент: наведите на него, чтобы строить прямо на нём", "An old foundation is here: point at it to build right on it");

// ---------- one foundation ----------

// The footprint a building on the foundation gets: the old ring, simplified, counter-clockwise.
export const lotRing = (f: Pick<FoundFoundation, "ring">): Pt[] => simplifyRing(f.ring, FOUNDATION_LOT.maxPoints);

// The roads built so far.
function builtRoads(roads: RoadGraph): RoadGraph {
  const edges: RoadGraph["edges"] = {};
  for (const e of Object.values(roads.edges)) if (e.done >= e.labor) edges[e.id] = e;
  return { ...roads, edges };
}

// Does any road (built or planned) run over the ring?
function roadOver(ring: readonly Pt[], roads: RoadGraph): boolean {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const [x, y] of ring) {
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  }
  for (const e of Object.values(roads.edges)) {
    const a = roads.nodes[e.a];
    const b = roads.nodes[e.b];
    if (!a || !b) continue;
    const half = ROAD_KINDS[e.kind].width / 2;
    if (Math.max(a.x, b.x) < x0 - half || Math.min(a.x, b.x) > x1 + half || Math.max(a.y, b.y) < y0 - half || Math.min(a.y, b.y) > y1 + half) continue;
    if (pointInRing(a.x, a.y, ring) || pointInRing(b.x, b.y, ring)) return true;
    for (let i = 0; i < ring.length; i++) {
      const [px, py] = ring[i];
      const [qx, qy] = ring[(i + 1) % ring.length];
      const n = Math.max(1, Math.ceil(Math.hypot(qx - px, qy - py) / FOUNDATION_LOT.probe));
      for (let k = 0; k < n; k++) if (distToEdge(roads, e, px + ((qx - px) * k) / n, py + ((qy - py) * k) / n) < half) return true;
    }
  }
  return false;
}

type LotState = Pick<SimState, "roads" | "buildings" | "zones">;

// Why the foundation cannot take a building now (any template, or `t`), with the door it would have otherwise.
export function lotCheck(s: LotState, f: FoundFoundation, t?: BuildingTemplate): { ok: true; door: Pt } | { ok: false; reason: string } {
  const no = (reason: string) => ({ ok: false as const, reason });
  if (isHeritage(f) && f.state !== "lost") return no(L("Это значимая постройка: её можно восстановить", "This is a notable building: it can be restored"));
  if (f.area < FOUNDATION_LOT.minArea) return no(L("Фундамент слишком мал для постройки", "The foundation is too small to build on"));
  if (t) {
    if (!usesFoundation(t)) return no(L(`${t.name} не ставится на старый фундамент`, `${t.name} can’t stand on an old foundation`));
    if (f.area < nominal(t) * FOUNDATION_LOT.fitMin) return no(L(`Фундамент мал для этой постройки (${Math.round(f.area)} м²)`, `The foundation is too small for this (${Math.round(f.area)} m²)`));
    if (f.area > nominal(t) * FOUNDATION_LOT.fitMax) return no(L(`Фундамент велик для этой постройки (${Math.round(f.area)} м²)`, `The foundation is too large for this (${Math.round(f.area)} m²)`));
  } else if (f.area > MAX_FIT) return no(L("Фундамент слишком велик для постройки", "The foundation is too large to build on"));
  const ring = lotRing(f);
  for (const b of Object.values(s.buildings)) if (b.foundationId === f.id || b.siteId === f.id || polysOverlap(ring, b.footprint)) return no(L("Место занято зданием", "The spot is taken by a building"));
  for (const fd of s.zones.fields) if (polysOverlap(ring, fd.pts)) return no(L("Здесь поле", "A field is here"));
  if (roadOver(ring, s.roads)) return no(L("Через фундамент проходит дорога", "A road runs over the foundation"));
  const door = ringDoor(ring, builtRoads(s.roads));
  if (!door || door.dist > FOUNDATION_LOT.roadReach) return no(L("Нужна построенная дорога рядом", "Needs a built road nearby"));
  return { ok: true, door: [Math.round(door.door[0] * 100) / 100, Math.round(door.door[1] * 100) / 100] };
}

// The size of a building of template `t` on the foundation against the template's own footprint.
export const foundationScale = (t: BuildingTemplate, f: Pick<FoundFoundation, "area">): number => Math.round(Math.min(FOUNDATION_LOT.fitMax, Math.max(FOUNDATION_LOT.fitMin, f.area / nominal(t))) * 100) / 100;

// A planned building of template `t` on the foundation. It scales with the ring: its capacity (residents, families, jobs,
// storage), labor and materials follow the area against the template's own footprint, so a size costs the same per m².
export function foundationBuilding(t: BuildingTemplate, f: FoundFoundation, door: Pt, id: number, now: number, site?: Site): Building {
  const ring = lotRing(f);
  const box = orientedBox(ring);
  const k = foundationScale(t, f);
  const r1 = (v: number) => Math.round(v * 10) / 10;
  const materials: Materials = { logs: r1(t.materials.logs * k), planks: r1(t.materials.planks * k), stone: r1(t.materials.stone * k) };
  const b: Building = {
    id,
    template: t.id,
    zone: t.zone,
    lot: { cx: box.cx, cy: box.cy, angle: box.angle, w: box.w / CELL_SIZE, d: box.d / CELL_SIZE },
    side: 1,
    footprint: ring,
    height: t.height,
    state: "planned",
    labor: Math.max(1, Math.round(t.labor * k)),
    done: 0,
    created: now,
    paid: false,
    level: 1,
    streak: 0,
    foundationId: f.id,
    door,
  };
  if (k !== 1) {
    b.materials = materials;
    b.scale = k;
  }
  if (site) b.site = site;
  return b;
}

// ---------- zone growth ----------

export interface FoundationLot {
  f: FoundFoundation;
  door: Pt;
  fits: BuildingTemplate[];
}

// Free foundations of the zone `zone`: those whose painted cells (unblocked, on a built road) are of that zone, judged by the
// cells whose centres the ring holds, or by the cell under its centroid when it holds none. Each with the templates it fits.
export function foundationLots(s: LotState & { finds: Pick<SimState["finds"], "foundations"> }, zone: ZoneType): FoundationLot[] {
  const list = s.finds.foundations;
  if (list.length === 0) return [];
  const built = new Set<number>();
  for (const e of Object.values(s.roads.edges)) if (e.done >= e.labor) built.add(e.id);
  const painted: ZoneCell[] = s.zones.cells.filter((c) => c.zone !== "none" && !c.block && built.has(c.edge));
  if (painted.length === 0) return [];
  const tpls = templatesOf(zone).filter(usesFoundation);
  const idx = foundationIndex(list);
  const votes = new Map<FoundFoundation, Map<string, number>>();
  const centre = new Map<FoundFoundation, Pt>();
  const half = CELL_SIZE / 2;
  for (const c of painted) {
    for (const { f } of idx.near(c.cx - half, c.cy - half, c.cx + half, c.cy + half)) {
      if (!isLotFoundation(f)) continue;
      let v = votes.get(f);
      if (!v) votes.set(f, (v = new Map()));
      if (pointInRing(c.cx, c.cy, f.ring)) v.set(c.zone, (v.get(c.zone) ?? 0) + 2);
      else {
        let m = centre.get(f);
        if (!m) centre.set(f, (m = centroid(f.ring)));
        // The cell under the centroid counts only for a ring that holds no cell centre (weight 1 < 2).
        const dx = m[0] - c.cx;
        const dy = m[1] - c.cy;
        const u = dx * Math.cos(c.angle) + dy * Math.sin(c.angle);
        const w = -dx * Math.sin(c.angle) + dy * Math.cos(c.angle);
        if (Math.abs(u) <= half && Math.abs(w) <= half) v.set(c.zone, (v.get(c.zone) ?? 0) + 1);
      }
    }
  }
  const out: FoundationLot[] = [];
  for (const [f, v] of votes) {
    let top: string | null = null;
    let n = 0;
    for (const [z, c] of v) if (c > n || (c === n && top !== null && z < top)) [top, n] = [z, c];
    if (top !== zone) continue;
    const fits = tpls.filter((t) => fitsArea(t, f.area));
    if (fits.length === 0) continue;
    const ok = lotCheck(s, f);
    if (ok.ok) out.push({ f, door: ok.door, fits });
  }
  out.sort((a, b) => (a.f.id < b.f.id ? -1 : a.f.id > b.f.id ? 1 : 0)); // the order of a Map of objects is the cells', keep it stable by id
  return out;
}
