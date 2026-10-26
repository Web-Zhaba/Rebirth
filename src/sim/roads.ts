import type { Land } from "../world/landcover";
import { bridgeSpanBonus } from "./tech";
import type { ProgressState, RoadEdge, RoadGraph, RoadKind, Stock } from "./types";

export interface RoadSpec {
  name: string;
  width: number;
  labor: number; // person-hours per metre on level meadow
  maxGrade: number;
  crossesWater: boolean;
  stone?: number; // t of stone per metre, taken from the stock when work on the edge starts
  unlock?: string; // tech unlock key; the kind is closed until researched
}

export const ROAD_KINDS: Record<RoadKind, RoadSpec> = {
  path: { name: "Тропа", width: 2, labor: 0.1, maxGrade: 0.25, crossesWater: false },
  dirt: { name: "Грунтовая дорога", width: 5, labor: 1.0, maxGrade: 0.12, crossesWater: false },
  footbridge: { name: "Канатный мостик", width: 1.5, labor: 0.5, maxGrade: 0.3, crossesWater: true },
  bridge: { name: "Свайный мост", width: 4, labor: 2.0, maxGrade: 0.1, crossesWater: true },
  stone: { name: "Каменная дорога", width: 5, labor: 2.0, maxGrade: 0.2, crossesWater: false, stone: 0.01, unlock: "road:stone" },
  stonebridge: { name: "Каменный мост", width: 5, labor: 4.0, maxGrade: 0.12, crossesWater: true, stone: 0.04, unlock: "road:stonebridge" },
};

// Longest span in metres a bridge kind covers before any technology.
export const BASE_SPAN: Partial<Record<RoadKind, number>> = { footbridge: 25, bridge: 30, stonebridge: 60 };
export type Spans = Partial<Record<RoadKind, number>>;

// Span limits of every bridge kind with the researched techs added (a missing `progress` means no techs).
export function effectiveSpans(progress?: Pick<ProgressState, "techs">): Spans {
  const out: Spans = {};
  for (const k of Object.keys(BASE_SPAN) as RoadKind[]) out[k] = (BASE_SPAN[k] ?? 0) + bridgeSpanBonus(progress, k);
  return out;
}

// Russian refusal when `span` metres of open water is more than `kind` holds, else null. The client preview and the
// worker both ask this; only the placing of a road is checked, built bridges are never touched.
export function spanReason(kind: RoadKind, span: number, spans: Spans = BASE_SPAN): string | null {
  const limit = spans[kind] ?? BASE_SPAN[kind];
  if (!ROAD_KINDS[kind].crossesWater || limit === undefined || span <= limit + 1e-6) return null;
  return `Пролёт ${Math.round(span)} м: ${ROAD_KINDS[kind].name.toLowerCase()} держит до ${Math.round(limit)} м`;
}

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
  if (e.stone !== undefined) {
    // the stone still owed is shared by length
    const owed1 = e.stone * f;
    g.edges[id].stone = owed1;
    g.edges[edge].stone = e.stone - owed1;
  }
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
      const perM = ROAD_KINDS[kind].stone;
      if (perM) g.edges[id].stone = perM * lens[k];
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

// Old-map ways drawn dashed (footways, paths, field tracks) come back as paths and their bridges as footbridges;
// every other street as a dirt road and its bridges as pile bridges.
const FOOT_CLASSES = ["path", "track"];
export function oldStreetKind(cls: string, bridge: boolean): RoadKind {
  const foot = FOOT_CLASSES.includes(cls);
  if (bridge) return foot ? "footbridge" : "bridge";
  return foot ? "path" : "dirt";
}

// A road drawn along a revealed old bridge is that bridge; elsewhere the kind stands as chosen.
export function segmentKind(kind: RoadKind, along: { cls: string; bridge: boolean } | null): RoadKind {
  if (!along?.bridge || isBridge(kind)) return kind;
  return oldStreetKind(along.cls, true);
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
  stone: number; // t the road needs from the stock
  span: number; // m, longest run of water
}

// Longest continuous run of water pieces along the profile, in metres.
export function longestSpan(p: TerrainProfile): number {
  const pieces = p.land.length;
  if (pieces < 1) return 0;
  let run = 0;
  let best = 0;
  for (const l of p.land) {
    run = l === "water" ? run + 1 : 0;
    best = Math.max(best, run);
  }
  return (best * p.length) / pieces;
}

// `spans`: effective span limits (effectiveSpans); without them the base limits apply.
export function segmentCost(p: TerrainProfile, kind: RoadKind, spans?: Spans): SegmentCost {
  const spec = ROAD_KINDS[kind];
  const pieces = p.land.length;
  if (p.length < MIN_SEGMENT) return { ok: false, reason: "Слишком коротко", labor: 0, maxGrade: 0, stone: 0, span: 0 };
  if (pieces < 1 || p.elev.length !== pieces + 1) return { ok: false, reason: "Нет данных о местности", labor: 0, maxGrade: 0, stone: 0, span: 0 };
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
  const stone = (spec.stone ?? 0) * p.length;
  const span = longestSpan(p);
  if (water && !spec.crossesWater) return { ok: false, reason: "Через воду нужен мост", labor, maxGrade, stone, span };
  const tooLong = spanReason(kind, span, spans);
  if (tooLong) return { ok: false, reason: tooLong, labor, maxGrade, stone, span };
  if (maxGrade > spec.maxGrade) {
    return { ok: false, reason: `Слишком круто: ${Math.round(maxGrade * 100)} %`, labor, maxGrade, stone, span };
  }
  return { ok: true, labor, maxGrade, stone, span };
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

// An edge that still owes stone the stock cannot cover waits for it.
const lacksStone = (e: RoadEdge, stock: Pick<Stock, "stone"> | undefined): boolean => !!stock && (e.stone ?? 0) > stock.stone + EPS;

// Unfinished edges a work party can reach, lowest id first. With a `stock`, edges short of stone are left out.
export function workableEdges(g: RoadGraph, stock?: Pick<Stock, "stone">): number[] {
  const reached = reachedNodes(g);
  return Object.values(g.edges)
    .filter((e) => unfinished(e) && (reached.has(e.a) || reached.has(e.b)) && !lacksStone(e, stock))
    .map((e) => e.id)
    .sort((p, q) => p - q);
}

// Reachable unfinished edges that wait only for stone.
export function stoneWaiting(g: RoadGraph, stock: Pick<Stock, "stone">): Set<number> {
  const open = new Set(workableEdges(g, stock));
  return new Set(workableEdges(g).filter((id) => !open.has(id)));
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
// An edge takes the stone it owes from `stock` when work on it starts; edges short of stone wait and the hands go on to the next.
// Returns the graph, the stock and the person-hours nobody could use (no reachable work).
export function spendOnRoads(g: RoadGraph, personHours: number, stock?: Stock): { roads: RoadGraph; left: number; stock?: Stock } {
  let edges = g.edges;
  let copied = false;
  let left = personHours;
  let st = stock;
  while (left > EPS) {
    const ids = workableEdges(copied ? { ...g, edges } : g, st);
    if (ids.length === 0) break;
    if (!copied) {
      edges = { ...edges };
      copied = true;
    }
    let e = edges[ids[0]];
    if (e.stone !== undefined) {
      if (st) st = { ...st, stone: Math.max(0, st.stone - e.stone) };
      const { stone: _taken, ...rest } = e;
      e = rest;
      edges[e.id] = e;
    }
    const remain = e.labor - e.done;
    if (left >= remain) {
      edges[e.id] = { ...e, done: e.labor };
      left -= remain;
    } else {
      edges[e.id] = { ...e, done: Math.min(e.labor, e.done + left) };
      left = 0;
    }
  }
  return { roads: copied ? { ...g, edges } : g, left, stock: st };
}

export const advanceConstruction = (g: RoadGraph, personHours: number): RoadGraph => spendOnRoads(g, personHours).roads;
