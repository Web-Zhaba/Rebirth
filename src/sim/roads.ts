import type { Land } from "../world/landcover";
import type { RoadEdge, RoadGraph, RoadKind } from "./types";

export const ROAD_KINDS: Record<RoadKind, { name: string; width: number; labor: number; maxGrade: number; crossesWater: boolean }> = {
  path: { name: "Тропа", width: 2, labor: 0.1, maxGrade: 0.25, crossesWater: false },
  dirt: { name: "Грунтовая дорога", width: 5, labor: 1.0, maxGrade: 0.12, crossesWater: false },
  footbridge: { name: "Канатный мостик", width: 1.5, labor: 0.5, maxGrade: 0.3, crossesWater: true },
  bridge: { name: "Свайный мост", width: 4, labor: 2.0, maxGrade: 0.1, crossesWater: true },
};

export const isRoadKind = (t: string): t is RoadKind => Object.hasOwn(ROAD_KINDS, t);
export const isBridge = (k: RoadKind): boolean => ROAD_KINDS[k].crossesWater;

export const MIN_SEGMENT = 8; // m
export const WORKERS = 10;
export const WORK_START = 7; // hour of day
export const WORK_END = 19;
export const ORIGIN_RADIUS = 30; // m: edges this close to the founding point can be started
const OVERLAP_BAND = 1; // m
const NODE_EPS = 0.5; // m: crossings this close to a node reuse it
const EPS = 1e-9;

export const emptyRoads = (): RoadGraph => ({ nodes: {}, edges: {}, nextId: 1 });

const dist = (ax: number, ay: number, bx: number, by: number) => Math.hypot(ax - bx, ay - by);

// ---------- snapping ----------

export type Snap = { x: number; y: number } & (
  | { kind: "free" }
  | { kind: "node"; node: number }
  | { kind: "edge"; edge: number; t: number }
);

function project(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  return { t, x: ax + t * dx, y: ay + t * dy };
}

export function distToEdge(g: RoadGraph, e: RoadEdge, x: number, y: number): number {
  const a = g.nodes[e.a];
  const b = g.nodes[e.b];
  const p = project(x, y, a.x, a.y, b.x, b.y);
  return dist(x, y, p.x, p.y);
}

const snapNode = (g: RoadGraph, node: number): Snap => ({ x: g.nodes[node].x, y: g.nodes[node].y, kind: "node", node });

// Nearest existing node within tol, else nearest point on an existing edge within tol.
export function snapPoint(g: RoadGraph, p: { x: number; y: number }, tol: number): Snap {
  let node: number | null = null;
  let best = tol;
  for (const n of Object.values(g.nodes)) {
    const d = dist(p.x, p.y, n.x, n.y);
    if (d <= best) {
      best = d;
      node = n.id;
    }
  }
  if (node !== null) return snapNode(g, node);
  let edge: RoadEdge | null = null;
  let proj = { t: 0, x: 0, y: 0 };
  best = tol;
  for (const e of Object.values(g.edges)) {
    const a = g.nodes[e.a];
    const b = g.nodes[e.b];
    const q = project(p.x, p.y, a.x, a.y, b.x, b.y);
    const d = dist(p.x, p.y, q.x, q.y);
    if (d <= best) {
      best = d;
      edge = e;
      proj = q;
    }
  }
  if (edge) {
    const len = dist(g.nodes[edge.a].x, g.nodes[edge.a].y, g.nodes[edge.b].x, g.nodes[edge.b].y);
    // Too close to an end: use that node instead of making a sliver edge.
    if (proj.t * len < NODE_EPS) return snapNode(g, edge.a);
    if ((1 - proj.t) * len < NODE_EPS) return snapNode(g, edge.b);
    return { x: proj.x, y: proj.y, kind: "edge", edge: edge.id, t: proj.t };
  }
  return { x: p.x, y: p.y, kind: "free" };
}

// ---------- graph editing (all on a private working copy) ----------

const cloneGraph = (g: RoadGraph): RoadGraph => ({ nodes: { ...g.nodes }, edges: { ...g.edges }, nextId: g.nextId });

// Splits edge `id` at (x, y), which lies on it; labor and done are prorated by length.
function splitEdge(g: RoadGraph, id: number, x: number, y: number): number {
  const e = g.edges[id];
  const na = g.nodes[e.a];
  const nb = g.nodes[e.b];
  const l1 = dist(na.x, na.y, x, y);
  const l2 = dist(x, y, nb.x, nb.y);
  const f = l1 / (l1 + l2);
  const node = g.nextId++;
  const edge = g.nextId++;
  g.nodes[node] = { id: node, x, y };
  const labor1 = e.labor * f;
  const done1 = e.done * f;
  const labor2 = e.labor - labor1;
  g.edges[id] = { ...e, b: node, length: l1, labor: labor1, done: done1 };
  g.edges[edge] = { id: edge, a: node, b: e.b, kind: e.kind, length: l2, labor: labor2, done: Math.min(labor2, e.done - done1) };
  return node;
}

function nodeAt(g: RoadGraph, p: [number, number], tol: number): number {
  const s = snapPoint(g, { x: p[0], y: p[1] }, tol);
  if (s.kind === "node") return s.node;
  if (s.kind === "edge") return splitEdge(g, s.edge, s.x, s.y);
  const id = g.nextId++;
  g.nodes[id] = { id, x: s.x, y: s.y };
  return id;
}

// Length of `e` lying within OVERLAP_BAND of the line through A-B, measured along A-B.
function overlapLength(ax: number, ay: number, bx: number, by: number, e: RoadEdge, g: RoadGraph): number {
  const L = dist(ax, ay, bx, by);
  if (L < EPS) return 0;
  const ux = (bx - ax) / L;
  const uy = (by - ay) / L;
  const c = g.nodes[e.a];
  const d = g.nodes[e.b];
  const pc = -(c.x - ax) * uy + (c.y - ay) * ux;
  const pd = -(d.x - ax) * uy + (d.y - ay) * ux;
  const sc = (c.x - ax) * ux + (c.y - ay) * uy;
  const sd = (d.x - ax) * ux + (d.y - ay) * uy;
  let lo = 0;
  let hi = 1;
  const dd = pd - pc;
  if (Math.abs(dd) < 1e-12) {
    if (Math.abs(pc) > OVERLAP_BAND) return 0;
  } else {
    const u1 = (-OVERLAP_BAND - pc) / dd;
    const u2 = (OVERLAP_BAND - pc) / dd;
    lo = Math.max(lo, Math.min(u1, u2));
    hi = Math.min(hi, Math.max(u1, u2));
    if (lo >= hi) return 0;
  }
  const s1 = sc + (sd - sc) * lo;
  const s2 = sc + (sd - sc) * hi;
  return Math.max(0, Math.min(L, Math.max(s1, s2)) - Math.max(0, Math.min(s1, s2)));
}

export type AddResult = { ok: true; graph: RoadGraph } | { ok: false; reason: string };

const fail = (reason: string): { ok: false; reason: string } => ({ ok: false, reason });
const OVERLAP_REASON = "Здесь уже есть дорога";

// Adds a polyline as straight segments. All-or-nothing: on rejection the input is untouched.
export function addRoad(
  graph: RoadGraph,
  pts: [number, number][],
  kind: RoadKind,
  snapTol: number,
  laborPerSegment: number[],
): AddResult {
  if (pts.length < 2 || laborPerSegment.length !== pts.length - 1) return fail("Некорректная линия");
  const g = cloneGraph(graph);
  let prev: number | null = null;
  for (let i = 0; i + 1 < pts.length; i++) {
    const a: number = prev ?? nodeAt(g, pts[i], snapTol);
    const b = nodeAt(g, pts[i + 1], snapTol);
    prev = b;
    const A = g.nodes[a];
    const B = g.nodes[b];
    const L = dist(A.x, A.y, B.x, B.y);
    if (a === b || L < MIN_SEGMENT) return fail("Слишком коротко");

    let overlap = 0;
    for (const e of Object.values(g.edges)) {
      if ((e.a === a && e.b === b) || (e.a === b && e.b === a)) return fail(OVERLAP_REASON);
      overlap += overlapLength(A.x, A.y, B.x, B.y, e, g);
    }
    if (overlap > MIN_SEGMENT) return fail(OVERLAP_REASON);

    // Crossings with existing edges (endpoints are already nodes, so only interior ones count).
    const rx = B.x - A.x;
    const ry = B.y - A.y;
    const hits: { t: number; node: number }[] = [];
    for (const id of Object.keys(g.edges).map(Number)) {
      const e = g.edges[id];
      if (e.a === a || e.a === b || e.b === a || e.b === b) continue;
      const C = g.nodes[e.a];
      const D = g.nodes[e.b];
      const sx = D.x - C.x;
      const sy = D.y - C.y;
      const denom = rx * sy - ry * sx;
      if (Math.abs(denom) < EPS) continue;
      const cx = C.x - A.x;
      const cy = C.y - A.y;
      const t = (cx * sy - cy * sx) / denom;
      const u = (cx * ry - cy * rx) / denom;
      const elen = Math.hypot(sx, sy);
      if (t * L <= NODE_EPS || t * L >= L - NODE_EPS || u * elen < -0.01 || u * elen > elen + 0.01) continue;
      let node: number;
      if (u * elen < NODE_EPS) node = e.a;
      else if (u * elen > elen - NODE_EPS) node = e.b;
      else node = splitEdge(g, id, A.x + t * rx, A.y + t * ry);
      if (node !== a && node !== b) hits.push({ t, node });
    }
    hits.sort((p, q) => p.t - q.t);
    const chain = [a];
    for (const h of hits) if (chain[chain.length - 1] !== h.node) chain.push(h.node);
    if (chain[chain.length - 1] !== b) chain.push(b);

    let total = 0;
    const lens: number[] = [];
    for (let k = 0; k + 1 < chain.length; k++) {
      const p = g.nodes[chain[k]];
      const q = g.nodes[chain[k + 1]];
      lens.push(dist(p.x, p.y, q.x, q.y));
      total += lens[k];
    }
    for (let k = 0; k + 1 < chain.length; k++) {
      const [p, q] = [chain[k], chain[k + 1]];
      for (const e of Object.values(g.edges)) {
        if ((e.a === p && e.b === q) || (e.a === q && e.b === p)) return fail(OVERLAP_REASON);
      }
      const id = g.nextId++;
      g.edges[id] = { id, a: p, b: q, kind, length: lens[k], labor: (laborPerSegment[i] * lens[k]) / total, done: 0 };
    }
  }
  return { ok: true, graph: g };
}

// Removes the edge and any node left without edges.
export function removeEdge(graph: RoadGraph, id: number): RoadGraph {
  const e = graph.edges[id];
  if (!e) return graph;
  const g = cloneGraph(graph);
  delete g.edges[id];
  const used = new Set<number>();
  for (const o of Object.values(g.edges)) {
    used.add(o.a);
    used.add(o.b);
  }
  for (const n of [e.a, e.b]) if (!used.has(n)) delete g.nodes[n];
  return g;
}

// ---------- cost ----------

// land: one entry per piece (at its midpoint); elev: piece boundaries (land.length + 1 values).
export interface TerrainProfile {
  length: number;
  land: Land[];
  elev: number[];
}

// Piers and pillars standing in the water, per metre of bridge.
const WATER_MULT = 1.5;

// A road over water along a revealed old street is a bridge of the street's kind: a footpath gets a footbridge,
// any other street a pile bridge. Elsewhere the road kind stands as chosen.
export function segmentKind(kind: RoadKind, water: boolean, oldStreetCls: string | null): RoadKind {
  if (!water || oldStreetCls === null || isBridge(kind)) return kind;
  return oldStreetCls === "path" ? "footbridge" : "bridge";
}

const LAND_MULT: Record<Exclude<Land, "water">, number> = {
  meadow: 1,
  sand: 1.2,
  forest: 3,
  wetland: 2.5,
  rock: 2,
  ice: 3,
};

export interface SegmentCost {
  ok: boolean;
  reason?: string;
  labor: number;
  maxGrade: number;
}

export function segmentCost(p: TerrainProfile, kind: RoadKind): SegmentCost {
  const spec = ROAD_KINDS[kind];
  const pieces = p.land.length;
  if (p.length < MIN_SEGMENT) return { ok: false, reason: "Слишком коротко", labor: 0, maxGrade: 0 };
  if (pieces < 1 || p.elev.length !== pieces + 1) return { ok: false, reason: "Нет данных о местности", labor: 0, maxGrade: 0 };
  const pl = p.length / pieces;
  let labor = 0;
  let maxGrade = 0;
  let water = false;
  for (let i = 0; i < pieces; i++) {
    const land = p.land[i];
    if (land === "water") {
      water = true;
      labor += spec.labor * pl * WATER_MULT;
      continue;
    }
    const grade = Math.abs(p.elev[i + 1] - p.elev[i]) / pl;
    maxGrade = Math.max(maxGrade, grade);
    labor += spec.labor * pl * LAND_MULT[land] * (1 + grade / 0.08);
  }
  if (water && !spec.crossesWater) return { ok: false, reason: "Через воду нужен мост", labor, maxGrade };
  if (maxGrade > spec.maxGrade) {
    return { ok: false, reason: `Слишком круто: ${Math.round(maxGrade * 100)} %`, labor, maxGrade };
  }
  return { ok: true, labor, maxGrade };
}

// ---------- construction ----------

const unfinished = (e: RoadEdge) => e.done < e.labor;

function reachedNodes(g: RoadGraph): Set<number> {
  const r = new Set<number>();
  for (const n of Object.values(g.nodes)) if (Math.hypot(n.x, n.y) <= ORIGIN_RADIUS) r.add(n.id);
  for (const e of Object.values(g.edges)) {
    if (!unfinished(e)) {
      r.add(e.a);
      r.add(e.b);
    }
  }
  return r;
}

// Unfinished edges a work party can reach, lowest id first.
export function workableEdges(g: RoadGraph): number[] {
  const reached = reachedNodes(g);
  return Object.values(g.edges)
    .filter((e) => unfinished(e) && (reached.has(e.a) || reached.has(e.b)))
    .map((e) => e.id)
    .sort((p, q) => p - q);
}

// Unfinished edges no work party can ever reach: their part of the network touches neither the
// founding camp nor a finished road.
export function cutOffEdges(g: RoadGraph): Set<number> {
  const adj = new Map<number, number[]>();
  const link = (p: number, q: number) => {
    const l = adj.get(p);
    if (l) l.push(q);
    else adj.set(p, [q]);
  };
  for (const e of Object.values(g.edges)) {
    link(e.a, e.b);
    link(e.b, e.a);
  }
  const seen = reachedNodes(g);
  const stack = [...seen];
  while (stack.length > 0) {
    for (const m of adj.get(stack.pop()!) ?? []) {
      if (!seen.has(m)) {
        seen.add(m);
        stack.push(m);
      }
    }
  }
  const out = new Set<number>();
  for (const e of Object.values(g.edges)) if (unfinished(e) && !seen.has(e.a)) out.add(e.id);
  return out;
}

// Spends person-hours FIFO on workable edges; leftovers carry to the next one.
// Returns the graph and the person-hours nobody could use (no reachable work).
export function spendOnRoads(g: RoadGraph, personHours: number): { roads: RoadGraph; left: number } {
  let edges = g.edges;
  let copied = false;
  let left = personHours;
  while (left > EPS) {
    const ids = workableEdges(copied ? { ...g, edges } : g);
    if (ids.length === 0) break;
    if (!copied) {
      edges = { ...edges };
      copied = true;
    }
    const e = edges[ids[0]];
    const remain = e.labor - e.done;
    if (left >= remain) {
      edges[e.id] = { ...e, done: e.labor };
      left -= remain;
    } else {
      edges[e.id] = { ...e, done: Math.min(e.labor, e.done + left) };
      left = 0;
    }
  }
  return { roads: copied ? { ...g, edges } : g, left };
}

export const advanceConstruction = (g: RoadGraph, personHours: number): RoadGraph => spendOnRoads(g, personHours).roads;
