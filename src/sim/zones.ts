import { ROAD_KINDS } from "./roads";
import type { Field, RoadEdge, RoadGraph, TerrainInfo, ZoneBlock, ZoneCell, ZoneState, ZoneType } from "./types";

export const CELL_SIZE = 8; // m, both along and across the road
export const MAX_DEPTH = 4; // cells deep on each side
export const STEEP_DEG = 10;
export const TERRAIN_GRID = 4; // m, terrain lookup quantisation
export const MIN_FIELD_AREA = 500; // m2
export const MAX_FIELD_AREA = 200_000; // 20 ha

const BUCKET = 32; // m, spatial hash
const SHRINK = 0.25; // m, tolerance for cells that merely touch
const EPS = 1e-6;
const HALF = CELL_SIZE / 2;

export const emptyZones = (): ZoneState => ({ cells: [], fields: [], terrain: {}, rev: 0 });

export const qkey = (cx: number, cy: number): string => `${Math.round(cx / TERRAIN_GRID)}:${Math.round(cy / TERRAIN_GRID)}`;

// Centre of the terrain grid square a qkey stands for.
export function qpoint(key: string): [number, number] {
  const [qx, qy] = key.split(":").map(Number);
  return [qx * TERRAIN_GRID, qy * TERRAIN_GRID];
}

const halfWidth = (e: RoadEdge) => ROAD_KINDS[e.kind].width / 2;
const bucketKey = (bx: number, by: number) => bx * 65536 + by;
const bucketOf = (v: number) => Math.floor(v / BUCKET);

// ---------- geometry helpers ----------

// Corners of an oriented square cell (counter-clockwise), `half` = half the side.
export function cellCorners(c: { cx: number; cy: number; angle: number }, half = HALF): [number, number][] {
  const ux = Math.cos(c.angle);
  const uy = Math.sin(c.angle);
  const at = (a: number, b: number): [number, number] => [c.cx + ux * a - uy * b, c.cy + uy * a + ux * b];
  return [at(-half, -half), at(half, -half), at(half, half), at(-half, half)];
}

// Distance from a segment to the axis-aligned box [-hx, hx] x [-hy, hy] (0 when they touch).
function segmentBoxDistance(ax: number, ay: number, bx: number, by: number, hx: number, hy: number): number {
  let t0 = 0;
  let t1 = 1;
  const clip = (p: number, q: number) => {
    // keep the part of the segment where p * t <= q
    if (Math.abs(p) < 1e-12) return q >= 0;
    const t = q / p;
    if (p < 0) {
      if (t > t1) return false;
      if (t > t0) t0 = t;
    } else {
      if (t < t0) return false;
      if (t < t1) t1 = t;
    }
    return true;
  };
  const dx = bx - ax;
  const dy = by - ay;
  if (clip(-dx, ax + hx) && clip(dx, hx - ax) && clip(-dy, ay + hy) && clip(dy, hy - ay)) return 0;
  const pb = (x: number, y: number) => Math.hypot(Math.max(Math.abs(x) - hx, 0), Math.max(Math.abs(y) - hy, 0));
  let best = Math.min(pb(ax, ay), pb(bx, by));
  for (const [x, y] of [[-hx, -hy], [hx, -hy], [hx, hy], [-hx, hy]]) best = Math.min(best, pointSegDist(x, y, ax, ay, bx, by));
  return best;
}

function pointSegDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

// Oriented squares with half side `h`: true when their interiors overlap.
function squaresOverlap(a: ZoneCell, b: ZoneCell, h: number): boolean {
  const dx = b.cx - a.cx;
  const dy = b.cy - a.cy;
  if (Math.hypot(dx, dy) >= 2 * h * Math.SQRT2) return false;
  const axes = [a.angle, a.angle + Math.PI / 2, b.angle, b.angle + Math.PI / 2];
  for (const th of axes) {
    const ax = Math.cos(th);
    const ay = Math.sin(th);
    const radius = (c: ZoneCell) => h * (Math.abs(Math.cos(c.angle) * ax + Math.sin(c.angle) * ay) + Math.abs(-Math.sin(c.angle) * ax + Math.cos(c.angle) * ay));
    if (Math.abs(dx * ax + dy * ay) >= radius(a) + radius(b) - EPS) return false;
  }
  return true;
}

export function pointInPolygon(x: number, y: number, pts: readonly [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// Signed shoelace area: positive for counter-clockwise.
export function signedArea(pts: readonly [number, number][]): number {
  let s = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) s += pts[j][0] * pts[i][1] - pts[i][0] * pts[j][1];
  return s / 2;
}

type P = readonly [number, number];
const cross = (o: P, a: P, b: P) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
const within = (a: number, b: number, v: number) => v >= Math.min(a, b) - EPS && v <= Math.max(a, b) + EPS;

// Closed segments (touching counts).
function segmentsIntersect(p1: P, p2: P, p3: P, p4: P): boolean {
  const d1 = cross(p3, p4, p1);
  const d2 = cross(p3, p4, p2);
  const d3 = cross(p1, p2, p3);
  const d4 = cross(p1, p2, p4);
  if (((d1 > EPS && d2 < -EPS) || (d1 < -EPS && d2 > EPS)) && ((d3 > EPS && d4 < -EPS) || (d3 < -EPS && d4 > EPS))) return true;
  const on = (a: P, b: P, c: P, d: number) => Math.abs(d) <= EPS && within(a[0], b[0], c[0]) && within(a[1], b[1], c[1]);
  return on(p3, p4, p1, d1) || on(p3, p4, p2, d2) || on(p1, p2, p3, d3) || on(p1, p2, p4, d4);
}

function segmentsDistance(p1: P, p2: P, p3: P, p4: P): number {
  if (segmentsIntersect(p1, p2, p3, p4)) return 0;
  return Math.min(
    pointSegDist(p1[0], p1[1], p3[0], p3[1], p4[0], p4[1]),
    pointSegDist(p2[0], p2[1], p3[0], p3[1], p4[0], p4[1]),
    pointSegDist(p3[0], p3[1], p1[0], p1[1], p2[0], p2[1]),
    pointSegDist(p4[0], p4[1], p1[0], p1[1], p2[0], p2[1]),
  );
}

// ---------- cell generation ----------

const sortedEdgeIds = (g: RoadGraph) => Object.keys(g.edges).map(Number).sort((p, q) => p - q);

function rawCells(g: RoadGraph): ZoneCell[] {
  const out: ZoneCell[] = [];
  for (const id of sortedEdgeIds(g)) {
    const e = g.edges[id];
    const a = g.nodes[e.a];
    const b = g.nodes[e.b];
    if (!a || !b) continue;
    const L = Math.hypot(b.x - a.x, b.y - a.y);
    const k = Math.floor(L / CELL_SIZE);
    if (k < 1) continue;
    const ux = (b.x - a.x) / L;
    const uy = (b.y - a.y) / L;
    const angle = Math.atan2(uy, ux);
    const margin = (L - CELL_SIZE * k) / 2;
    const h = halfWidth(e);
    for (const side of [1, -1] as const) {
      for (let i = 0; i < k; i++) {
        const along = margin + CELL_SIZE * i + HALF;
        for (let depth = 0; depth < MAX_DEPTH; depth++) {
          const across = (h + CELL_SIZE * depth + HALF) * side;
          out.push({
            key: `${id}:${side}:${i}:${depth}`,
            edge: id,
            side,
            i,
            depth,
            cx: a.x + ux * along - uy * across,
            cy: a.y + uy * along + ux * across,
            angle,
            zone: "none",
            block: null,
          });
        }
      }
    }
  }
  return out;
}

// Edge ids by bucket; each edge sits in the 3 x 3 buckets around samples taken every 8 m.
function indexEdges(g: RoadGraph): Map<number, number[]> {
  const index = new Map<number, number[]>();
  for (const id of sortedEdgeIds(g)) {
    const e = g.edges[id];
    const a = g.nodes[e.a];
    const b = g.nodes[e.b];
    if (!a || !b) continue;
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / CELL_SIZE));
    const seen = new Set<number>();
    for (let s = 0; s <= n; s++) {
      const bx = bucketOf(a.x + ((b.x - a.x) * s) / n);
      const by = bucketOf(a.y + ((b.y - a.y) * s) / n);
      for (let ox = -1; ox <= 1; ox++) {
        for (let oy = -1; oy <= 1; oy++) {
          const key = bucketKey(bx + ox, by + oy);
          if (seen.has(key)) continue;
          seen.add(key);
          const list = index.get(key);
          if (list) list.push(id);
          else index.set(key, [id]);
        }
      }
    }
  }
  return index;
}

function blockedByRoad(c: ZoneCell, g: RoadGraph, index: Map<number, number[]>): boolean {
  const near = index.get(bucketKey(bucketOf(c.cx), bucketOf(c.cy)));
  if (!near) return false;
  const ux = Math.cos(c.angle);
  const uy = Math.sin(c.angle);
  for (const id of near) {
    if (id === c.edge) continue;
    const e = g.edges[id];
    const a = g.nodes[e.a];
    const b = g.nodes[e.b];
    // Into the cell's frame.
    const local = (p: { x: number; y: number }): [number, number] => {
      const dx = p.x - c.cx;
      const dy = p.y - c.cy;
      return [dx * ux + dy * uy, -dx * uy + dy * ux];
    };
    const [ax, ay] = local(a);
    const [bx, by] = local(b);
    if (segmentBoxDistance(ax, ay, bx, by, HALF, HALF) < halfWidth(e) - EPS) return true;
  }
  return false;
}

// Terrain verdict for a cell: pending until its qkey has been sampled.
function terrainBlock(c: ZoneCell, terrain: Record<string, TerrainInfo>): ZoneBlock | null {
  const t = terrain[qkey(c.cx, c.cy)];
  if (!t) return "pending";
  if (t.land === "water") return "water";
  if (t.slope > STEEP_DEG) return "steep";
  return null;
}

export function regenerateCells(
  graph: RoadGraph,
  oldCells: readonly ZoneCell[],
  fields: readonly Field[],
  terrain: Record<string, TerrainInfo>,
): ZoneCell[] {
  const cells = rawCells(graph);
  const edgeIndex = indexEdges(graph);
  const fieldBoxes = fields.map((f) => {
    const xs = f.pts.map((p) => p[0]);
    const ys = f.pts.map((p) => p[1]);
    return { f, x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
  });

  // Roads, then overlap against older edges' surviving cells (cells arrive in edge order).
  const accepted = new Map<number, ZoneCell[]>();
  for (const c of cells) {
    if (blockedByRoad(c, graph, edgeIndex)) {
      c.block = "road";
      continue;
    }
    const bx = bucketOf(c.cx);
    const by = bucketOf(c.cy);
    let clash = false;
    for (let ox = -1; ox <= 1 && !clash; ox++) {
      for (let oy = -1; oy <= 1 && !clash; oy++) {
        for (const o of accepted.get(bucketKey(bx + ox, by + oy)) ?? []) {
          if (o.edge < c.edge && squaresOverlap(c, o, HALF - SHRINK)) {
            clash = true;
            break;
          }
        }
      }
    }
    if (clash) {
      c.block = "overlap";
      continue;
    }
    const key = bucketKey(bx, by);
    const list = accepted.get(key);
    if (list) list.push(c);
    else accepted.set(key, [c]);
  }

  // Fields, then terrain.
  for (const c of cells) {
    if (c.block) continue;
    if (fieldBoxes.some((b) => c.cx >= b.x0 && c.cx <= b.x1 && c.cy >= b.y0 && c.cy <= b.y1 && pointInPolygon(c.cx, c.cy, b.f.pts))) {
      c.block = "field";
      continue;
    }
    c.block = terrainBlock(c, terrain);
  }

  // A blocked cell shades the ones behind it (cells of one column are consecutive, depth ascending).
  for (let n = 1; n < cells.length; n++) {
    const c = cells[n];
    const prev = cells[n - 1];
    if (c.depth > 0 && !c.block && prev.block) c.block = prev.block;
  }

  // Zones follow the nearest previously zoned cell within 4 m.
  const zoned = new Map<number, ZoneCell[]>();
  for (const o of oldCells) {
    if (o.zone === "none") continue;
    const key = bucketKey(Math.floor(o.cx / 8), Math.floor(o.cy / 8));
    const list = zoned.get(key);
    if (list) list.push(o);
    else zoned.set(key, [o]);
  }
  if (zoned.size > 0) {
    for (const c of cells) {
      if (c.block) continue;
      const bx = Math.floor(c.cx / 8);
      const by = Math.floor(c.cy / 8);
      let best = 4 + EPS;
      for (let ox = -1; ox <= 1; ox++) {
        for (let oy = -1; oy <= 1; oy++) {
          for (const o of zoned.get(bucketKey(bx + ox, by + oy)) ?? []) {
            const d = Math.hypot(o.cx - c.cx, o.cy - c.cy);
            if (d < best) {
              best = d;
              c.zone = o.zone;
            }
          }
        }
      }
    }
  }
  return cells;
}

// Sets `zone` on the listed cells; blocked cells are left alone. "none" clears.
export function paintCells(cells: readonly ZoneCell[], keys: Iterable<string>, zone: "none" | ZoneType): ZoneCell[] {
  const want = new Set(keys);
  return cells.map((c) => (want.has(c.key) && !c.block && c.zone !== zone ? { ...c, zone } : c));
}

// Terrain grid points still to be sampled.
export function pendingKeys(cells: readonly ZoneCell[]): string[] {
  const set = new Set<string>();
  for (const c of cells) if (c.block === "pending") set.add(qkey(c.cx, c.cy));
  return [...set];
}

// ---------- fields ----------

export type FieldCheck = { ok: true; pts: [number, number][]; area: number } | { ok: false; reason: string };

const bad = (reason: string): FieldCheck => ({ ok: false, reason });

export function selfIntersects(pts: readonly [number, number][]): boolean {
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const p1 = pts[i];
    const p2 = pts[(i + 1) % n];
    if (Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) < EPS) return true;
    for (let j = i + 1; j < n; j++) {
      const p3 = pts[j];
      const p4 = pts[(j + 1) % n];
      const adjacent = j === i + 1 || (i === 0 && j === n - 1);
      if (adjacent) {
        // Share one vertex: only a fold back along the same line is a problem.
        const shared = j === i + 1 ? p2 : p1;
        const far1 = j === i + 1 ? p1 : p2;
        const far2 = j === i + 1 ? p4 : p3;
        const dot = (far1[0] - shared[0]) * (far2[0] - shared[0]) + (far1[1] - shared[1]) * (far2[1] - shared[1]);
        if (Math.abs(cross(shared, far1, far2)) <= EPS && dot > 0) return true;
      } else if (segmentsIntersect(p1, p2, p3, p4)) {
        return true;
      }
    }
  }
  return false;
}

export function polygonsOverlap(a: readonly [number, number][], b: readonly [number, number][]): boolean {
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < b.length; j++) {
      if (segmentsIntersect(a[i], a[(i + 1) % a.length], b[j], b[(j + 1) % b.length])) return true;
    }
  }
  return pointInPolygon(a[0][0], a[0][1], b) || pointInPolygon(b[0][0], b[0][1], a);
}

function touchesRoad(pts: readonly [number, number][], g: RoadGraph): boolean {
  for (const e of Object.values(g.edges)) {
    const a = g.nodes[e.a];
    const b = g.nodes[e.b];
    if (!a || !b) continue;
    if (pointInPolygon(a.x, a.y, pts) || pointInPolygon(b.x, b.y, pts)) return true;
    const hw = halfWidth(e);
    for (let i = 0; i < pts.length; i++) {
      if (segmentsDistance([a.x, a.y], [b.x, b.y], pts[i], pts[(i + 1) % pts.length]) < hw - EPS) return true;
    }
  }
  return false;
}

// Returns the polygon in counter-clockwise order with its area, or a Russian reason.
export function validateField(pts: [number, number][], graph: RoadGraph, fields: readonly Field[]): FieldCheck {
  if (!Array.isArray(pts) || pts.length < 3) return bad("Нужно минимум 3 точки");
  if (!pts.every((p) => Array.isArray(p) && p.length === 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]) && Math.abs(p[0]) < 1e6 && Math.abs(p[1]) < 1e6)) {
    return bad("Некорректный контур");
  }
  if (pts.length > 256) return bad("Слишком много точек");
  if (selfIntersects(pts)) return bad("Контур пересекает сам себя");
  const signed = signedArea(pts);
  const area = Math.abs(signed);
  if (area < MIN_FIELD_AREA) return bad("Слишком маленькое поле");
  if (area > MAX_FIELD_AREA) return bad("Слишком большое поле");
  const ccw: [number, number][] = signed >= 0 ? pts.map((p) => [p[0], p[1]]) : pts.map((p) => [p[0], p[1]] as [number, number]).reverse();
  if (touchesRoad(ccw, graph)) return bad("Поле пересекает дорогу");
  if (fields.some((f) => polygonsOverlap(ccw, f.pts))) return bad("Поле накладывается на другое");
  return { ok: true, pts: ccw, area };
}

export const nextFieldId = (fields: readonly Field[]): number => fields.reduce((m, f) => Math.max(m, f.id), 0) + 1;
