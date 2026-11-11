import { BUILDINGS, floorsOf, FLOOR, type BuildingTemplate, type Materials } from "./buildings";
import { pointInRing } from "./excavation";
import { asItWasTemplate, isHeritage, kindName, siteTitle } from "./heritage";
import { RESTORE, orientedBox, polysOverlap, ringDoor, simplifyRing } from "./heritageGeo";
import { distToEdge, ROAD_KINDS } from "./roads";
import { TECH_BY_ID } from "./tech";
import type { Building, FoundFoundation, ProgressState, RoadGraph, Site, SimState } from "./types";
import { CELL_SIZE } from "./zones";
import { L } from "../i18n";

// Old foundations as building sites (PLAN.md section 12, docs/PLAN-restoration.md section 2). The foundation sets the
// building: any purpose takes the ring as it is, at full size, and the floors of the old building. A stroke of houses
// (sim/stroke.ts) takes the foundations along it first, and the player can put a building on any of them. Rectangular lots never
// cover such a foundation. Whether a foundation is built on is derived (a building with its `foundationId`), so a
// demolition frees it again with nothing to undo.

type Pt = [number, number];

export const FOUNDATION_LOT = {
  minArea: 20, // m2: smaller rings (sheds) are no lots and do not reserve their ground
  roadReach: 30, // m from the ring to a built road
  maxPoints: RESTORE.maxPoints, // points of the footprint: the walls follow the old ring, only tiny corners are cut
  probe: 2, // m between the points along the ring tested against roads
  axis: 0.5, // m: a road whose axis comes this close to the ring runs over it; its verge may touch the old walls, as an
  // old street's did (the houses of a village street stand 1-2 m from its axis line in the tile data)
};

// Templates that are open ground or depend on their surroundings (a garden, a pier, a log yard...): never on a foundation.
const OPEN_GROUND = new Set(["garden", "orchard", "apiary", "quarry", "dig", "forager", "fisher", "well", "woodcutter", "sawpit"]);

export const usesFoundation = (t: BuildingTemplate): boolean => !OPEN_GROUND.has(t.id);
const nominal = (t: BuildingTemplate): number => t.along * t.deep;

// ---------- size limits by purpose (section 2.2) ----------
// Long and large wooden buildings stood where nobody needed heat; where people live and work in heat, the size grows
// with the technology. Each stage holds once all its techs are researched; the limit is the largest stage that holds.
// The areas were set on real tiles: half the buildings of a village are under 100-200 m2 and nine in ten under 250-400.

interface Stage {
  techs: string[];
  area: number; // m2 of the footprint
  floors: number;
}
type SizeClass = "store" | "heated" | "hall";

const STAGES: Record<SizeClass, Stage[]> = {
  // unheated stores and farm buildings: any footprint, wooden, from the start
  store: [
    { techs: [], area: Infinity, floors: 1 },
    { techs: ["housing"], area: Infinity, floors: 2 },
  ],
  // heated houses and workplaces
  heated: [
    { techs: [], area: 250, floors: 1 },
    { techs: ["housing"], area: 400, floors: 2 },
    { techs: ["housing", "stonework"], area: 1000, floors: 3 },
    { techs: ["trusses"], area: Infinity, floors: 5 },
  ],
  // public halls: a large hall needs stone masonry or roof trusses
  hall: [
    { techs: [], area: 250, floors: 1 },
    { techs: ["housing"], area: 250, floors: 2 },
    { techs: ["stonework"], area: 1000, floors: 1 },
    { techs: ["housing", "stonework"], area: 1000, floors: 3 },
    { techs: ["trusses"], area: Infinity, floors: 5 },
  ],
};
const STORE_CLASS = new Set(["barn", "cellar", "logyard", "stoneyard", "warehouse", "market", "gumno"]);
const HALL_CLASS = new Set(["chapel", "school", "townhall", "office", "restored", "museum"]);
const sizeClass = (t: BuildingTemplate): SizeClass => (STORE_CLASS.has(t.id) ? "store" : HALL_CLASS.has(t.id) ? "hall" : "heated");

type Progress = Pick<ProgressState, "techs">;
const holds = (p: Progress, st: Stage): boolean => st.techs.every((id) => p.techs.includes(id));

// The largest footprint (m2) and the most floors a building of template `t` may have now.
export function sizeLimit(p: Progress, t: BuildingTemplate): { area: number; floors: number } {
  let area = 0;
  let floors = 1;
  for (const st of STAGES[sizeClass(t)])
    if (holds(p, st)) {
      area = Math.max(area, st.area);
      floors = Math.max(floors, st.floors);
    }
  return { area, floors };
}

// The techs still missing for the first stage that allows `ok`, by name; null when it is allowed now or never.
function missing(p: Progress, t: BuildingTemplate, ok: (st: Stage) => boolean): string | null {
  const st = STAGES[sizeClass(t)].find(ok);
  if (!st || holds(p, st)) return null;
  return st.techs.filter((id) => !p.techs.includes(id)).map((id) => `«${TECH_BY_ID.get(id)?.name ?? id}»`).join(L(" и ", " and "));
}

// The purpose matches the foundation's known old kind (and the site was not lost): a restoration in full. It lifts the
// size limits, since the old building shows it could be built.
export const isAsItWas = (t: BuildingTemplate, f: Pick<FoundFoundation, "cls" | "state">): boolean => f.state !== "lost" && asItWasTemplate(f.cls) === t.id;

// What the player is told of the foundation's known old kind when giving it purpose `t`; empty for an ordinary one.
export function foundationKindText(f: Pick<FoundFoundation, "cls" | "name" | "state">, t: BuildingTemplate): string {
  const target = asItWasTemplate(f.cls);
  if (!target) return "";
  if (f.state === "lost") return L("Старая постройка утрачена: «как было» её уже не вернуть", "The old building is lost: it cannot come back as it was");
  if (isAsItWas(t, f)) return L(`Как было: ${siteTitle(f)}`, `As it was: ${siteTitle(f)}`);
  const name = BUILDINGS[target].name;
  return L(`Прежде здесь: ${kindName(f.cls).toLowerCase()}; как было — «${name}»`, `Formerly here: ${kindName(f.cls).toLowerCase()}; as it was, a ${name.toLowerCase()}`);
}

// Why a building of template `t` cannot take the foundation's size now, or null.
export function sizeBlocker(p: Progress, t: BuildingTemplate, f: Pick<FoundFoundation, "area" | "cls" | "state">): string | null {
  if (isAsItWas(t, f) || f.area <= sizeLimit(p, t).area) return null;
  const need = missing(p, t, (st) => st.area >= f.area);
  const size = Math.round(f.area);
  return need ? L(`Фундамент велик для этого (${size} м²): нужна ${need}`, `The foundation is too large for this (${size} m²): needs ${need}`) : L(`Фундамент велик для этого (${size} м²)`, `The foundation is too large for this (${size} m²)`);
}

// The floors a building of template `t` on the foundation gets when it is built: the old building's, as far as the
// technology allows (all of them "as it was"). The rest are added later, a floor at a time.
export function plannedFloors(p: Progress, t: BuildingTemplate, f: Pick<FoundFoundation, "height" | "cls" | "state">): { built: number; old: number } {
  const old = floorsOf(f.height);
  return { built: isAsItWas(t, f) ? old : Math.min(old, sizeLimit(p, t).floors), old };
}

// What holds back the next floor of a building on an old foundation, or null when the technology allows it.
export function floorBlocker(p: Progress, b: Pick<Building, "template" | "level" | "asItWas">): string | null {
  const t = BUILDINGS[b.template];
  if (!t || b.asItWas || b.level < sizeLimit(p, t).floors) return null;
  const need = missing(p, t, (st) => st.floors > b.level);
  return need ? L(`следующий этаж — с технологией ${need}`, `the next floor comes with ${need}`) : L("выше строить нельзя", "it cannot be built higher");
}

// A notable site is the player's to restore; every other dug foundation of a usable size is a lot of its own.
const isLotFoundation = (f: FoundFoundation): boolean => f.area >= FOUNDATION_LOT.minArea && !f.ghost && !(isHeritage(f) && f.state !== "lost");

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

// Does a polygon (a lot cell) lie on a foundation that is a lot, an outline still to dig, or a heritage site still
// standing? Regular lots avoid them.
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
    const outline = f.ghost === true && f.area >= FOUNDATION_LOT.minArea;
    if (!isLotFoundation(f) && !outline && !(isHeritage(f) && f.state !== "lost")) continue;
    if (polysOverlap(poly, f.ring)) return f;
  }
  return null;
}

export const FOUNDATION_TAKEN = L("Здесь старый фундамент: наведите на него, чтобы строить прямо на нём", "An old foundation is here: point at it to build right on it");
export const OUTLINE_TAKEN = L("Здесь контур старой постройки: раскопайте его, чтобы строить на нём", "An old outline is here: dig it to build on it");

// ---------- one foundation ----------

// The footprint a building on the foundation gets: the old ring, simplified, counter-clockwise.
const rings = new WeakMap<readonly Pt[], Pt[]>();
export function lotRing(f: Pick<FoundFoundation, "ring">): Pt[] {
  let r = rings.get(f.ring);
  if (!r) rings.set(f.ring, (r = simplifyRing(f.ring, FOUNDATION_LOT.maxPoints)));
  return r.map((p): Pt => [p[0], p[1]]); // a copy: a building owns its footprint
}

// The roads built so far.
function builtRoads(roads: RoadGraph): RoadGraph {
  const edges: RoadGraph["edges"] = {};
  for (const e of Object.values(roads.edges)) if (e.done >= e.labor) edges[e.id] = e;
  return { ...roads, edges };
}

// Does any road (built or planned) run over the ring: its axis inside the ring or at FOUNDATION_LOT.axis from it?
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
    const half = Math.min(ROAD_KINDS[e.kind].width / 2, FOUNDATION_LOT.axis);
    if (Math.max(a.x, b.x) < x0 - half || Math.min(a.x, b.x) > x1 + half || Math.max(a.y, b.y) < y0 - half || Math.min(a.y, b.y) > y1 + half) continue;
    if (pointInRing(a.x, a.y, ring) || pointInRing(b.x, b.y, ring)) return true;
    for (let i = 0; i < ring.length; i++) {
      const [px, py] = ring[i];
      const [qx, qy] = ring[(i + 1) % ring.length];
      // probes at most 2 x half apart: an axis crossing the wall between two of them passes within half of one
      const n = Math.max(1, Math.ceil(Math.hypot(qx - px, qy - py) / Math.min(FOUNDATION_LOT.probe, 2 * half)));
      for (let k = 0; k < n; k++) if (distToEdge(roads, e, px + ((qx - px) * k) / n, py + ((qy - py) * k) / n) <= half) return true;
    }
  }
  return false;
}

type LotState = Pick<SimState, "roads" | "buildings" | "zones" | "progress">;

// Why the foundation cannot take a building now (any template, or `t`), with the door it would have otherwise. With
// `planned`, a road not built yet will do for the door (the site then waits for it).
export function lotCheck(s: LotState, f: FoundFoundation, t?: BuildingTemplate, planned = false): { ok: true; door: Pt } | { ok: false; reason: string } {
  const no = (reason: string) => ({ ok: false as const, reason });
  if (f.area < FOUNDATION_LOT.minArea) return no(L("Фундамент слишком мал для постройки", "The foundation is too small to build on"));
  if (f.ghost) return no(L("Это пока только контур: раскопайте фундамент", "Only an outline so far: dig the foundation first"));
  if (t) {
    if (!usesFoundation(t)) return no(L(`${t.name} не ставится на старый фундамент`, `${t.name} can’t stand on an old foundation`));
    const big = sizeBlocker(s.progress, t, f);
    if (big) return no(big);
  }
  const ring = lotRing(f);
  for (const b of Object.values(s.buildings)) if (b.foundationId === f.id || polysOverlap(ring, b.footprint)) return no(L("Место занято зданием", "The spot is taken by a building"));
  for (const fd of s.zones.fields) if (polysOverlap(ring, fd.pts)) return no(L("Здесь поле", "A field is here"));
  if (roadOver(ring, s.roads)) return no(L("Через фундамент проходит дорога", "A road runs over the foundation"));
  const door = ringDoor(ring, planned ? s.roads : builtRoads(s.roads));
  if (!door || door.dist > FOUNDATION_LOT.roadReach) return no(planned ? L("Нужна дорога рядом", "Needs a road nearby") : L("Нужна построенная дорога рядом", "Needs a built road nearby"));
  return { ok: true, door: [Math.round(door.door[0] * 100) / 100, Math.round(door.door[1] * 100) / 100] };
}

// The ring's area against the template's own footprint.
export const foundationScale = (t: BuildingTemplate, f: Pick<FoundFoundation, "area">): number => Math.max(0.01, Math.round((f.area / nominal(t)) * 100) / 100);

// A planned building of template `t` on the foundation. It takes the ring at full size and the floors of the old building
// the technology allows (all of them "as it was"); its capacity, labor and materials follow its floor area against the
// template's own footprint, so a size costs the same per m2. Each further floor is paid when it is added.
export function foundationBuilding(t: BuildingTemplate, f: FoundFoundation, door: Pt, id: number, now: number, progress: Pick<ProgressState, "techs">, site?: Site): Building {
  const ring = lotRing(f);
  const box = orientedBox(ring);
  const k = foundationScale(t, f);
  const { built, old } = plannedFloors(progress, t, f);
  const cost = k * built;
  const r1 = (v: number) => Math.round(v * 10) / 10;
  const materials: Materials = { logs: r1(t.materials.logs * cost), planks: r1(t.materials.planks * cost), stone: r1(t.materials.stone * cost) };
  const b: Building = {
    id,
    template: t.id,
    zone: t.zone,
    lot: { cx: box.cx, cy: box.cy, angle: box.angle, w: box.w / CELL_SIZE, d: box.d / CELL_SIZE },
    side: 1,
    footprint: ring,
    height: Math.round((t.height + (built - 1) * FLOOR.height) * 100) / 100,
    state: "planned",
    labor: Math.max(1, Math.round(t.labor * cost)),
    done: 0,
    created: now,
    paid: false,
    level: built,
    streak: 0,
    foundationId: f.id,
    door,
    materials,
    scale: k,
    floors: old,
  };
  if (isAsItWas(t, f)) b.asItWas = true;
  if (site) b.site = site;
  return b;
}
