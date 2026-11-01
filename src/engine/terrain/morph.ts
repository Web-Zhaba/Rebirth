import { GRID } from "./nodeMesh";

// CDLOD-style geomorphing (docs/PLAN-engine.md section 4, terrain/). Every vertex of a node knows where it would sit on
// its parent's coarser grid: even/even vertices are parent vertices, the others lie on a parent triangle edge, halfway
// between two parent vertices (the parent's quads are split along the (i+1, j) - (i, j+1) diagonal, buildIndices).
// The morph factor slides each vertex from its own position (0) to that parent position (1) by its own screen-space
// error, so a node looks exactly like its parent when the quadtree splits or merges it, and nothing pops.
//
// The factor is a function of the vertex alone (its distance to the eye and its latitude), so two nodes sharing an edge
// compute the same value for the same vertex. The band [lo, hi] (in px per grid cell) is chosen against the selection
// rules in quadtree.ts so that:
//  - a node that just split shows children fully morphed (identical to it): children appear at error <= tau / 2 = lo;
//  - a node about to merge has fully morphed children, and is itself unmorphed at every vertex (error >= hi);
//  - where a node meets a coarser neighbour, the finer side is fully morphed and the coarser side is not morphing, so
//    the shared edge matches without skirts.
// The vertex shader (terrain.wgsl) repeats `morphPair`, `vertexError` and `morphFactor`.

// Grid indices (j * GRID + i) of the two parent-grid vertices whose midpoint is vertex (i, j)'s morph target. Both are
// the vertex itself for even/even vertices.
export function morphPair(i: number, j: number): [number, number] {
  const oi = i & 1;
  const oj = j & 1;
  if (oi && !oj) return [j * GRID + i - 1, j * GRID + i + 1];
  if (!oi && oj) return [(j - 1) * GRID + i, (j + 1) * GRID + i];
  if (oi && oj) return [(j - 1) * GRID + i + 1, (j + 1) * GRID + i - 1];
  return [j * GRID + i, j * GRID + i];
}

// Screen-space error (px per grid cell) of a vertex: `cellK` is the node level's cell width at the equator times the
// projection scale K = viewportH / (2 tan(fovY / 2)); cells shrink with cos(latitude) = |up.xy|.
export function vertexError(cellK: number, cosLat: number, distance: number): number {
  return (cellK * cosLat) / Math.max(distance, 1e-3);
}

// 0 = own grid, 1 = parent's grid.
export function morphFactor(error: number, lo: number, hi: number): number {
  return Math.max(0, Math.min(1, (hi - error) / (hi - lo)));
}

export interface MorphBand {
  lo: number; // px per cell: fully morphed at or below
  hi: number; // px per cell: unmorphed at or above
}

// The morph band for split threshold `tau`, merge hysteresis `merge` (a split node merges below tau * merge) and
// projection scale `k` (px per radian-ish: viewportH / (2 tan(fovY / 2))).
//
// lo: a leaf's error is <= tau (else it would split), and a vertex's error never exceeds its node's (the node uses its
// nearest point and its widest cell), so on a leaf's border the finer neighbour's vertices are at <= tau / 2.
// hi: a split parent had error > merge * tau at its nearest point; its farthest vertex is at most one node diagonal
// further, so every vertex of a split node is above merge * tau / (1 + diag * merge * tau / k), diag in cells. A margin
// covers what the bound ignores (relief inside the node, latitude across it).
export function morphBand(tau: number, merge: number, k: number): MorphBand {
  const lo = tau / 2;
  const diag = (GRID - 1) * Math.SQRT2;
  const bound = (merge * tau) / (1 + (diag * merge * tau) / k);
  return { lo, hi: Math.max(lo * 1.08, bound * 0.92) };
}
