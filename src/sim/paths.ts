import type { Spot, Tree } from "./people";

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
