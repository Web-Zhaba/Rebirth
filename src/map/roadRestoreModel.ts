import { MIN_SEGMENT, overlapBand } from "../sim/roads";
import type { RoadKind } from "../sim/types";
import { roadLine } from "../world/oldStreets";

export type Pt = [number, number];

export interface RoadGraphLike {
  nodes: Record<number, { id: number; x: number; y: number }>;
  edges: Record<number, { id: number; a: number; b: number; kind: RoadKind }>;
}

// A stretch of old street counts as built when a road runs along it closer than the overlap band of the two kinds
// (sim/roads.ts overlapBand, where addRoad would refuse a road on top of it), with some slack, so a road drawn a little
// off the old line is not laid a second time beside it.
const COVER_SLACK = 1.25;
const PARALLEL_DOT = 0.985;
const SEAM = 0.5; // m: covered stretches this close are one
const MARGIN = 0.5; // m: a stretch lengthened to the shortest road gets this much more

type Edge = RoadGraphLike["edges"][number];

// The part of segment a-b (along it, 0..len) that edge c-d runs along within `band`, or null.
function coveredInterval(a: Pt, b: Pt, c: Pt, d: Pt, band: number): [number, number] | null {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const wlen = Math.hypot(d[0] - c[0], d[1] - c[1]);
  if (len === 0 || wlen === 0) return null;
  const ux = (b[0] - a[0]) / len;
  const uy = (b[1] - a[1]) / len;
  if (Math.abs((ux * (d[0] - c[0]) + uy * (d[1] - c[1])) / wlen) < PARALLEL_DOT) return null;
  const off = (p: Pt) => -(p[0] - a[0]) * uy + (p[1] - a[1]) * ux;
  const along = (p: Pt) => (p[0] - a[0]) * ux + (p[1] - a[1]) * uy;
  const oc = off(c);
  const od = off(d);
  // the part of the edge within the band, as a fraction of it
  let lo = 0;
  let hi = 1;
  if (Math.abs(od - oc) < 1e-12) {
    if (Math.abs(oc) > band) return null;
  } else {
    const t1 = (-band - oc) / (od - oc);
    const t2 = (band - oc) / (od - oc);
    lo = Math.max(lo, Math.min(t1, t2));
    hi = Math.min(hi, Math.max(t1, t2));
    if (lo >= hi) return null;
  }
  const sc = along(c);
  const sd = along(d);
  const s1 = sc + (sd - sc) * lo;
  const s2 = sc + (sd - sc) * hi;
  const from = Math.max(0, Math.min(s1, s2));
  const to = Math.min(len, Math.max(s1, s2));
  return to - from > SEAM ? [from, to] : null;
}

// Nearest point of an edge to p.
function onEdge(g: RoadGraphLike, e: Edge, p: Pt): Pt {
  const c = g.nodes[e.a];
  const d = g.nodes[e.b];
  const dx = d.x - c.x;
  const dy = d.y - c.y;
  const l2 = dx * dx + dy * dy;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - c.x) * dx + (p[1] - c.y) * dy) / l2));
  return [c.x + dx * t, c.y + dy * t];
}

const touching = (p: Edge, q: Edge): boolean => p.id === q.id || p.a === q.a || p.a === q.b || p.b === q.a || p.b === q.b;

interface Cover {
  lo: number;
  hi: number;
  loEdge: Edge; // the road that covers the start of the stretch
  hiEdge: Edge; // the road that covers its end
}

// The parts of an old street (`pts`, already a road line: every segment at least MIN_SEGMENT) not yet built, as
// polylines of `kind` to lay. A part that meets a built road ends on that road, so the restored street joins it; a part
// too short for a road is lengthened over the built road next to it, unless it is only the seam between two roads that
// already meet.
export function restoreMissingPieces(graph: RoadGraphLike, pts: readonly Pt[], kind: RoadKind): Pt[][] {
  if (pts.length < 2) return [];
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const total = cum[cum.length - 1];

  const covers: Cover[] = [];
  const edges = Object.values(graph.edges).filter((e) => graph.nodes[e.a] && graph.nodes[e.b]);
  for (let i = 0; i + 1 < pts.length; i++) {
    for (const e of edges) {
      const c = graph.nodes[e.a];
      const d = graph.nodes[e.b];
      const hit = coveredInterval(pts[i], pts[i + 1], [c.x, c.y], [d.x, d.y], overlapBand(kind, e.kind) * COVER_SLACK);
      if (hit) covers.push({ lo: cum[i] + hit[0], hi: cum[i] + hit[1], loEdge: e, hiEdge: e });
    }
  }
  covers.sort((p, q) => p.lo - q.lo);
  const merged: Cover[] = [];
  for (const c of covers) {
    const last = merged[merged.length - 1];
    if (last && c.lo <= last.hi + SEAM) {
      if (c.hi > last.hi) {
        last.hi = c.hi;
        last.hiEdge = c.hiEdge;
      }
    } else merged.push({ ...c });
  }

  // the uncovered stretches, each with the roads at its ends
  const runs: { s0: number; s1: number; from: Edge | null; to: Edge | null }[] = [];
  let pos = 0;
  let from: Edge | null = null;
  for (const c of merged) {
    if (c.lo > pos + SEAM) runs.push({ s0: pos, s1: c.lo, from, to: c.loEdge });
    if (c.hi >= pos) {
      pos = c.hi;
      from = c.hiEdge;
    }
  }
  if (total > pos + SEAM) runs.push({ s0: pos, s1: total, from, to: null });

  const at = (s: number): Pt => {
    let i = 1;
    while (i < cum.length - 1 && cum[i] < s) i++;
    const span = cum[i] - cum[i - 1];
    const t = span > 0 ? (s - cum[i - 1]) / span : 0;
    return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t];
  };

  const out: Pt[][] = [];
  for (const r of runs) {
    let { s0, s1 } = r;
    if (s1 - s0 < MIN_SEGMENT) {
      if (!r.from && !r.to) continue;
      if (r.from && r.to && touching(r.from, r.to)) continue; // two roads that already meet: only their seam
      const need = MIN_SEGMENT + MARGIN - (s1 - s0);
      if (r.from && r.to) {
        s0 -= need / 2;
        s1 += need / 2;
      } else if (r.from) s0 -= need;
      else s1 += need;
      s0 = Math.max(0, s0);
      s1 = Math.min(total, s1);
    }
    const line: Pt[] = [r.from ? onEdge(graph, r.from, at(s0)) : at(s0)];
    for (let i = 1; i < pts.length - 1; i++) if (cum[i] > s0 + SEAM && cum[i] < s1 - SEAM) line.push([pts[i][0], pts[i][1]]);
    line.push(r.to ? onEdge(graph, r.to, at(s1)) : at(s1));
    const road = roadLine(line, MIN_SEGMENT, new Set());
    if (road) out.push(road.map((p): Pt => [p[0], p[1]]));
  }
  return out;
}
