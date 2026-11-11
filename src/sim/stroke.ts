import { BUILDINGS, type BuildingTemplate } from "./buildings";
import { orderDig } from "./digging";
import { centroid } from "./excavation";
import { foundationBuilding, foundationIndex, foundationKindText, FOUNDATION_LOT, lotCheck } from "./foundationLots";
import { canPlace, canPlaceOnFoundation, placeBuilding, placeOnFoundation, roadReady, type PlaceState } from "./growth";
import { asItWasTemplate, isHeritage, siteTitle } from "./heritage";
import { distToEdge, ROAD_KINDS } from "./roads";
import type { Building, FoundFoundation, RoadGraph, Site, SimState } from "./types";
import { L } from "../i18n";

// Building in strokes (docs/PLAN-build.md section 3.3): the player drags along a road and gets a row of buildings of one
// template. Old foundations along the stroke are taken first, at their full ring; outlines still to dig become a dig with
// the building to follow; the gaps get regular lots (unless only foundations are wanted). The plan is pure: the build
// tool previews it and the worker places it, so what the player sees is what gets built.

type Pt = [number, number];

// A piece of the stroke: road `edge`, `side` of it (as a lot cell's), from `from` to `to` metres along it from node a.
// `to` < `from` runs the stroke backwards along the edge.
export interface StrokeSpan {
  edge: number;
  side: 1 | -1;
  from: number;
  to: number;
}

export type StrokeItem =
  | { kind: "lot"; key: string; building: Building; edge: number; side: 1 | -1; i: number }
  | { kind: "foundation" | "dig"; key: string; building: Building; foundationId: string };

export interface StrokeSkip {
  foundationId: string;
  reason: string;
  at: Pt;
}

export interface StrokePlan {
  items: StrokeItem[]; // in stroke order: the order they are built in
  skipped: StrokeSkip[]; // foundations along the stroke left alone, with the reason
}

const NO_SITE: Site = { forest: 0, water: 0, rock: 0 }; // the stroke templates ask nothing of their surroundings
const PREVIEW_ID = 0; // a planned building of the preview has no id yet

// The templates a stroke lays: houses, workshops and shops (class other than "placed"). Null for any other.
export function strokeTemplate(id: unknown): BuildingTemplate | null {
  if (typeof id !== "string" || !Object.hasOwn(BUILDINGS, id)) return null;
  const t = BUILDINGS[id];
  return t.zone === "placed" ? null : t;
}

interface Frame {
  index: number;
  ax: number;
  ay: number;
  ux: number;
  uy: number;
  lo: number;
  hi: number;
  dir: 1 | -1;
}

// Where a point lies against the span: metres along the edge and signed metres across it (+ on side 1).
const along = (f: Frame, x: number, y: number): number => (x - f.ax) * f.ux + (y - f.ay) * f.uy;
const across = (f: Frame, x: number, y: number): number => -(x - f.ax) * f.uy + (y - f.ay) * f.ux;

function frames(s: Pick<SimState, "roads">, spans: readonly StrokeSpan[]): (Frame & StrokeSpan)[] {
  const out: (Frame & StrokeSpan)[] = [];
  spans.forEach((sp, index) => {
    const e = s.roads.edges[sp.edge];
    const a = e && s.roads.nodes[e.a];
    const b = e && s.roads.nodes[e.b];
    if (!a || !b) return;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len < 1e-6) return;
    const lo = Math.max(0, Math.min(sp.from, sp.to));
    const hi = Math.min(len, Math.max(sp.from, sp.to));
    if (hi <= lo) return;
    out.push({ ...sp, index, ax: a.x, ay: a.y, ux: (b.x - a.x) / len, uy: (b.y - a.y) / len, lo, hi, dir: sp.to >= sp.from ? 1 : -1 });
  });
  return out;
}

// The template a stroke of `t` puts on the foundation, or why it leaves the foundation alone. A foundation of a known old
// kind of the same class comes back as it was (a shop stroke over an old bank gives a shop "as it was"); one of another
// class is kept for its own purpose; a notable site is the player's to restore from its card.
function purposeOn(f: FoundFoundation, t: BuildingTemplate): BuildingTemplate | string {
  if (isHeritage(f) && f.state !== "lost") return L(`${siteTitle(f)}: восстанавливается из карточки места`, `${siteTitle(f)}: restored from the site's card`);
  const was = f.state === "lost" ? null : asItWasTemplate(f.cls);
  if (!was) return t;
  const w = BUILDINGS[was];
  return w && w.zone === t.zone ? w : foundationKindText(f, t);
}

// The foundations along the spans not built on (or dug) yet, in stroke order.
function alongFoundations(s: Pick<SimState, "roads" | "finds" | "buildings">, fr: readonly (Frame & StrokeSpan)[]): { f: FoundFoundation; order: [number, number] }[] {
  const taken = new Set<string>();
  for (const b of Object.values(s.buildings)) if (b.foundationId) taken.add(b.foundationId);
  const idx = foundationIndex(s.finds.foundations);
  const seen = new Set<string>();
  const out: { f: FoundFoundation; order: [number, number] }[] = [];
  for (const sp of fr) {
    const e = s.roads.edges[sp.edge];
    const reach = FOUNDATION_LOT.roadReach + ROAD_KINDS[e.kind].width / 2;
    const ends = [sp.lo, sp.hi].map((t): Pt => [sp.ax + sp.ux * t, sp.ay + sp.uy * t]);
    const x0 = Math.min(ends[0][0], ends[1][0]) - reach;
    const y0 = Math.min(ends[0][1], ends[1][1]) - reach;
    const x1 = Math.max(ends[0][0], ends[1][0]) + reach;
    const y1 = Math.max(ends[0][1], ends[1][1]) + reach;
    for (const { f } of idx.near(x0, y0, x1, y1)) {
      if (seen.has(f.id) || taken.has(f.id) || f.area < FOUNDATION_LOT.minArea) continue;
      const [cx, cy] = centroid(f.ring);
      const t = along(sp, cx, cy);
      if (t < sp.lo || t > sp.hi || Math.sign(across(sp, cx, cy)) !== sp.side) continue;
      if (!f.ring.some(([x, y]) => distToEdge(s.roads, e, x, y) <= reach)) continue;
      seen.add(f.id);
      out.push({ f, order: [sp.index, sp.dir * t] });
    }
  }
  return out.sort((p, q) => p.order[0] - q.order[0] || p.order[1] - q.order[1]);
}

const byOrder = (p: { order: [number, number] }, q: { order: [number, number] }) => p.order[0] - q.order[0] || p.order[1] - q.order[1];

// What a stroke of template `t` along the spans would build now. Foundations claim their ground first, then the lots fill
// the gaps; each is checked against the ones before it, so the plan never overlaps itself. The road may be one not built
// yet: a building along it waits for it (`awaitsRoad`).
export function planStroke<S extends PlaceState>(s: S, t: BuildingTemplate, spans: readonly StrokeSpan[], onlyFoundations = false): StrokePlan {
  const fr = frames(s, spans);
  const items: (StrokeItem & { order: [number, number] })[] = [];
  const skipped: StrokeSkip[] = [];
  let cur = s;
  const newest = (): Building => cur.buildings[cur.nextBuildingId - 1];

  for (const { f, order } of alongFoundations(s, fr)) {
    const use = purposeOn(f, t);
    const at = centroid(f.ring);
    if (typeof use === "string") {
      skipped.push({ foundationId: f.id, reason: use, at });
      continue;
    }
    const key = `f:${f.id}`;
    if (f.ghost) {
      const { ghost: _g, ...dug } = f; // checked as it will be once dug
      const r = lotCheck(cur, dug, use, true);
      const dig = r.ok ? orderDig(cur, f.id) : null;
      if (!r.ok || !dig || !dig.ok) {
        skipped.push({ foundationId: f.id, reason: !r.ok ? r.reason : dig && !dig.ok ? dig.reason : "", at });
        continue;
      }
      const building = foundationBuilding(use, dug, r.door, PREVIEW_ID, cur.gameMinutes, cur.progress);
      if (!roadReady(cur.roads, building)) building.awaitsRoad = true;
      cur = dig.sim;
      items.push({ kind: "dig", key, building, foundationId: f.id, order });
      continue;
    }
    const ok = canPlaceOnFoundation(cur, use, f.id, true);
    if (!ok.ok) {
      skipped.push({ foundationId: f.id, reason: ok.reason, at });
      continue;
    }
    cur = placeOnFoundation(cur, use, f.id, true);
    items.push({ kind: "foundation", key, building: { ...newest(), id: PREVIEW_ID }, foundationId: f.id, order });
  }

  if (!onlyFoundations) {
    for (const sp of fr) {
      // the free depth-0 cells of the span, by their index along the edge
      const row = new Map<number, number>(); // i -> metres along
      for (const c of cur.zones.cells) {
        if (c.edge !== sp.edge || c.side !== sp.side || c.depth !== 0) continue;
        const t0 = along(sp, c.cx, c.cy);
        if (t0 >= sp.lo && t0 <= sp.hi) row.set(c.i, t0);
      }
      const ids = [...row.keys()].sort((p, q) => (p - q) * sp.dir);
      const used = new Set<number>();
      for (const i of ids) {
        if (used.has(i)) continue;
        const start = sp.dir === 1 ? i : i - t.w + 1;
        let inside = true;
        for (let a = 0; a < t.w && inside; a++) inside = row.has(start + a) && !used.has(start + a);
        if (!inside || !canPlace(cur, t, sp.edge, sp.side, start, NO_SITE, true).ok) continue;
        cur = placeBuilding(cur, t, sp.edge, sp.side, start);
        for (let a = 0; a < t.w; a++) used.add(start + a);
        const mid = (row.get(start)! + row.get(start + t.w - 1)!) / 2;
        items.push({ kind: "lot", key: `lot:${sp.edge}:${sp.side}:${start}`, building: { ...newest(), id: PREVIEW_ID }, edge: sp.edge, side: sp.side, i: start, order: [sp.index, sp.dir * mid] });
      }
    }
  }

  return { items: items.sort(byOrder).map(({ order: _o, ...it }) => it as StrokeItem), skipped };
}

// ---------- a road with houses ----------

// The edges a new road added to `before`: those new to the graph that do not lie along an old edge (the pieces of an old
// edge the road split do).
export function newRoadEdges(before: RoadGraph, after: RoadGraph): number[] {
  const old = Object.values(before.edges);
  const out: number[] = [];
  for (const e of Object.values(after.edges)) {
    if (Object.hasOwn(before.edges, e.id)) continue;
    const a = after.nodes[e.a];
    const b = after.nodes[e.b];
    if (!a || !b) continue;
    const x = (a.x + b.x) / 2;
    const y = (a.y + b.y) / 2;
    if (!old.some((o) => distToEdge(before, o, x, y) <= 1)) out.push(e.id);
  }
  return out.sort((p, q) => p - q);
}

// Both sides of the edges, end to end: the stroke of a road with houses.
export function roadSpans(roads: RoadGraph, edges: readonly number[]): StrokeSpan[] {
  const out: StrokeSpan[] = [];
  for (const id of edges) {
    const e = roads.edges[id];
    const a = e && roads.nodes[e.a];
    const b = e && roads.nodes[e.b];
    if (!a || !b) continue;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    for (const side of [1, -1] as const) out.push({ edge: id, side, from: 0, to: len });
  }
  return out;
}

// Places the items in their order, each checked against the town as it is by then (an item no longer possible is left
// out). A dig is ordered with its building to follow once the outline is dug.
export function applyStroke<S extends PlaceState>(s: S, items: readonly StrokeItem[]): { sim: S; placed: number } {
  let cur = s;
  let placed = 0;
  for (const it of items) {
    const t = BUILDINGS[it.building.template];
    if (!t) continue;
    if (it.kind === "lot") {
      if (!canPlace(cur, t, it.edge, it.side, it.i, NO_SITE, true).ok) continue;
      cur = placeBuilding(cur, t, it.edge, it.side, it.i);
    } else if (it.kind === "foundation") {
      if (!canPlaceOnFoundation(cur, t, it.foundationId, true).ok) continue;
      cur = placeOnFoundation(cur, t, it.foundationId, true);
    } else {
      const id = cur.nextBuildingId;
      const r = orderDig(cur, it.foundationId);
      if (!r.ok) continue;
      cur = { ...r.sim, buildings: { ...r.sim.buildings, [id]: { ...r.sim.buildings[id], then: t.id } } };
    }
    placed++;
  }
  return { sim: cur, placed };
}

// Takes back the buildings of a stroke nobody has started on (the undo of a stroke): the plan goes, and a restoration it
// ordered is no longer under way (not lost, as a demolition would make it). Started or paid buildings stay.
export function cancelPlans<S extends PlaceState>(s: S, ids: readonly number[]): { sim: S; removed: number } {
  let buildings = s.buildings;
  let foundations = s.finds.foundations;
  let removed = 0;
  for (const id of ids) {
    const b = buildings[id];
    if (!b || b.state !== "planned" || b.done > 0 || b.paid) continue;
    if (buildings === s.buildings) buildings = { ...s.buildings };
    delete buildings[id];
    removed++;
    if (b.asItWas)
      foundations = foundations.map((f) => {
        if (f.id !== b.foundationId || f.state !== "restoring") return f;
        const { state: _s, ...rest } = f;
        return rest;
      });
  }
  if (removed === 0) return { sim: s, removed };
  return { sim: { ...s, buildings, finds: { ...s.finds, foundations } }, removed };
}
