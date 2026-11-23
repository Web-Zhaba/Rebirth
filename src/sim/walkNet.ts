import type { RoadGraph } from "./types";

// Walking over the town's finished roads: the net of built edges, snapping a point to it, the walking-distance trees
// (Dijkstra from a seed within a limit) and the walks between spots. WALK_SPEED is metres per game minute; a commute
// may take at most MAX_COMMUTE minutes.

export const WALK_SPEED = 4000 / 60;
export const MAX_COMMUTE = 45;

// ---------- road net (built edges only) ----------

export interface NetEdge {
  id: number;
  a: number;
  b: number;
  length: number;
  ax: number;
  ay: number;
  bx: number;
  by: number;
  dx: number;
  dy: number;
  l2: number;
}

export interface Net {
  adj: Map<number, [number, number][]>;
  edges: NetEdge[];
}

export function buildNet(g: RoadGraph): Net {
  const adj = new Map<number, [number, number][]>();
  const link = (a: number, b: number, len: number) => {
    const l = adj.get(a);
    if (l) l.push([b, len]);
    else adj.set(a, [[b, len]]);
  };
  const edges: NetEdge[] = [];
  for (const e of Object.values(g.edges)) {
    if (e.done < e.labor) continue;
    link(e.a, e.b, e.length);
    link(e.b, e.a, e.length);
    const a = g.nodes[e.a];
    const b = g.nodes[e.b];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    edges.push({
      id: e.id,
      a: e.a,
      b: e.b,
      length: e.length,
      ax: a.x,
      ay: a.y,
      bx: b.x,
      by: b.y,
      dx,
      dy,
      l2: dx * dx + dy * dy,
    });
  }
  return { adj, edges };
}

export interface Spot {
  edge: NetEdge;
  t: number;
  off: number;
  at: [number, number];
}

// Оптимизированный snapToRoad: без аллокаций в цикле и без вычислений sqrt для каждого ребра
export function snapToRoad(net: Net, x: number, y: number): Spot | null {
  let bestEdge: NetEdge | null = null;
  let bestF = 0;
  let bestAtX = 0, bestAtY = 0;
  let bestOff2 = Infinity;

  const len = net.edges.length;
  for (let i = 0; i < len; i++) {
    const e = net.edges[i];
    const dx = e.dx, dy = e.dy, l2 = e.l2;
    const f = l2 > 0 ? Math.min(1, Math.max(0, ((x - e.ax) * dx + (y - e.ay) * dy) / l2)) : 0;
    const atX = e.ax + dx * f;
    const atY = e.ay + dy * f;
    const offX = atX - x;
    const offY = atY - y;
    const off2 = offX * offX + offY * offY;
    if (off2 < bestOff2) {
      bestOff2 = off2;
      bestEdge = e;
      bestF = f;
      bestAtX = atX;
      bestAtY = atY;
    }
  }

  if (!bestEdge) return null;
  return {
    edge: bestEdge,
    t: bestF * bestEdge.length,
    off: Math.sqrt(bestOff2),
    at: [bestAtX, bestAtY],
  };
}

export class MinHeap {
  private keys: number[] = [];
  private vals: number[] = [];
  private topPair: [number, number] = [0, 0];

  get size(): number {
    return this.keys.length;
  }
  push(k: number, v: number): void {
    const { keys, vals } = this;
    let i = keys.length;
    keys.push(k);
    vals.push(v);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (keys[p] <= k) break;
      keys[i] = keys[p];
      vals[i] = vals[p];
      i = p;
    }
    keys[i] = k;
    vals[i] = v;
  }
  pop(): [number, number] {
    const { keys, vals } = this;
    const k0 = keys[0], v0 = vals[0];
    const k = keys.pop()!;
    const v = vals.pop()!;
    const n = keys.length;
    if (n > 0) {
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && keys[c + 1] < keys[c]) c++;
        if (keys[c] >= k) break;
        keys[i] = keys[c];
        vals[i] = vals[c];
        i = c;
      }
      keys[i] = k;
      vals[i] = v;
    }
    this.topPair[0] = k0;
    this.topPair[1] = v0;
    return this.topPair;
  }
}

export interface Tree {
  dist: Map<number, number>;
  prev: Map<number, number>;
}

export function treeFrom(net: Net, seeds: [number, number][], limit: number): Tree {
  const dist = new Map<number, number>();
  const prev = new Map<number, number>();
  const done = new Set<number>();
  const heap = new MinHeap();
  for (const [n, d] of seeds) {
    if (d > limit || d >= (dist.get(n) ?? Infinity)) continue;
    dist.set(n, d);
    heap.push(d, n);
  }
  while (heap.size > 0) {
    const [d, n] = heap.pop();
    if (done.has(n)) continue;
    done.add(n);
    for (const [m, len] of net.adj.get(n) ?? []) {
      const nd = d + len;
      if (nd > limit) continue;
      if (nd < (dist.get(m) ?? Infinity)) {
        dist.set(m, nd);
        prev.set(m, n);
        heap.push(nd, m);
      }
    }
  }
  return { dist, prev };
}

export const spotTree = (net: Net, p: Spot, limit: number): Tree =>
  treeFrom(
    net,
    [
      [p.edge.a, p.t],
      [p.edge.b, p.edge.length - p.t],
    ],
    limit - p.off,
  );

export function walkMetres(tree: Tree, p: Spot, q: Spot): number {
  const e = q.edge;
  let road = Math.min((tree.dist.get(e.a) ?? Infinity) + q.t, (tree.dist.get(e.b) ?? Infinity) + e.length - q.t);
  if (p.edge.id === e.id) road = Math.min(road, Math.abs(p.t - q.t));
  return p.off + road + q.off;
}

// ---------- walks ----------

// Node ids from the tree's seed the shortest path starts at to `to`, or null when `to` was not reached.
export function nodePath(tree: Tree, to: number): number[] | null {
  if (!tree.dist.has(to)) return null;
  const out = [to];
  for (let p = tree.prev.get(to); p !== undefined; p = tree.prev.get(p)) out.push(p);
  return out.reverse();
}

export interface Walk {
  nodes: number[]; // road nodes the walk passes, from the tree's seed on; empty when it stays on one edge
  metres: number; // walked, off-road legs included
}

// The walk from the spot the tree was built from (`from`, or a node the tree starts at when null) to a spot beside
// the net: along the road to the nearer end of its edge, or straight along the edge when both lie on it.
// Null when `to` is out of reach within `limit`.
export function walkTo(tree: Tree, from: Spot | null, to: Spot, limit: number): Walk | null {
  const e = to.edge;
  let road = Infinity;
  let end = -1;
  const da = tree.dist.get(e.a);
  if (da !== undefined && da + to.t < road) {
    road = da + to.t;
    end = e.a;
  }
  const db = tree.dist.get(e.b);
  if (db !== undefined && db + e.length - to.t < road) {
    road = db + e.length - to.t;
    end = e.b;
  }
  if (from && from.edge.id === e.id && Math.abs(from.t - to.t) <= road) {
    const metres = Math.abs(from.t - to.t) + from.off + to.off;
    return metres <= limit ? { nodes: [], metres } : null;
  }
  if (end < 0) return null;
  const nodes = nodePath(tree, end);
  const metres = road + (from?.off ?? 0) + to.off;
  return nodes && metres <= limit ? { nodes, metres } : null;
}

export const polyLength = (pts: [number, number][]): number => {
  let t = 0;
  for (let i = 1; i < pts.length; i++) t += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return t;
};
