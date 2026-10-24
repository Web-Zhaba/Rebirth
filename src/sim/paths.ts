import { MAX_COMMUTE, MinHeap, nearestNode, WALK_SPEED, type Net } from "./people";
import type { RoadGraph } from "./types";

// Shortest-path tree over the built road net, bounded by `limit` metres of road.
export interface Tree {
  start: number;
  dist: Map<number, number>;
  prev: Map<number, number>; // node -> the node before it on its shortest path from `start`
}

export function shortestTree(net: Net, start: number, limit: number): Tree {
  const dist = new Map<number, number>([[start, 0]]);
  const prev = new Map<number, number>();
  const done = new Set<number>();
  const heap = new MinHeap();
  heap.push(0, start);
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
  return { start, dist, prev };
}

// Node ids from the tree's start to `to`, or null when `to` was not reached.
export function nodePath(tree: Tree, to: number): number[] | null {
  if (!tree.dist.has(to)) return null;
  const out = [to];
  for (let n = to; n !== tree.start; ) {
    const p = tree.prev.get(n);
    if (p === undefined) return null;
    out.push(p);
    n = p;
  }
  return out.reverse();
}

export interface Route {
  nodes: number[]; // road nodes, first to last
  pts: [number, number][]; // local m: `from`, the nodes, `to` (consecutive duplicates dropped)
  length: number; // m, including both off-road legs
}

// The polyline of a node path with the off-road legs at both ends.
export function polyline(g: RoadGraph, nodes: number[], from: [number, number], to: [number, number]): [number, number][] {
  const pts: [number, number][] = [];
  const add = (x: number, y: number) => {
    const l = pts[pts.length - 1];
    if (!l || l[0] !== x || l[1] !== y) pts.push([x, y]);
  };
  add(from[0], from[1]);
  for (const id of nodes) add(g.nodes[id].x, g.nodes[id].y);
  add(to[0], to[1]);
  return pts;
}

export const polyLength = (pts: [number, number][]): number => {
  let t = 0;
  for (let i = 1; i < pts.length; i++) t += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return t;
};

// Route over built roads between two free points: each steps onto the net at its nearest node. Null when a
// point is out of walking range of the net or the second is not reached within `limit` m of road.
export function routeBetween(g: RoadGraph, net: Net, from: [number, number], to: [number, number], limit = MAX_COMMUTE * WALK_SPEED): Route | null {
  const a = nearestNode(net, from[0], from[1]);
  const b = nearestNode(net, to[0], to[1]);
  if (!a || !b) return null;
  const nodes = nodePath(shortestTree(net, a.node, limit), b.node);
  if (!nodes) return null;
  const pts = polyline(g, nodes, from, to);
  return { nodes, pts, length: polyLength(pts) };
}
