import type { XY } from "./modelGeometry";

// Where the trees of the 3D forest stand (PLAN-3d-world.ru.md stage 4). Pure: forest polygons in town metres in, one
// record per tree out. A jittered grid over the whole plane; each cell's point, size, species and turn come from a hash
// of the cell, so a tree keeps its place whichever chunk it is built in and whatever else changes around it.

export const CHUNK = 200; // m, side of a chunk of trees (the tree layer builds and caches them one by one)
export const TREES_FROM_ZOOM = 13.6; // closer than this the forest is 3D
export const TREE_STRIDE = 6; // x, y, size (m tall), kind, turn (rad), hash (0..1)
export const TREE_KINDS = ["conifer", "broadleaf", "birch"] as const;
export type TreeKind = (typeof TREE_KINDS)[number];

export interface ForestPoly {
  bbox: [number, number, number, number];
  rings: XY[][]; // even-odd across the rings
}

export interface ScatterInput {
  forests: readonly ForestPoly[];
  rect: [number, number, number, number]; // x0, y0, x1, y1: trees whose point falls in [x0, x1) x [y0, y1)
  spacing: number; // m between grid cells
  lat: number; // species mix: conifers rule the north
  // Ground that has no tree (houses, roads, fields, finished clearings). h: the tree's hash, so a clearing under way
  // can fell a share of its trees.
  blocked: (x: number, y: number, h: number) => boolean;
}

function hash(i: number, j: number, k: number): number {
  let h = (i * 374761393 + j * 668265263 + k * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export function insideRings(x: number, y: number, rings: readonly XY[][]): boolean {
  let inside = false;
  for (const r of rings)
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const [xi, yi] = r[i], [xj, yj] = r[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
  return inside;
}

// Share of conifers at a latitude: broadleaf in the south, taiga in the north.
export const coniferShare = (lat: number): number => Math.min(0.85, Math.max(0.1, (Math.abs(lat) - 42) / 20));

export function scatterTrees(inp: ScatterInput): Float32Array {
  const [x0, y0, x1, y1] = inp.rect, sp = inp.spacing;
  const forests = inp.forests.filter((f) => f.bbox[2] >= x0 && f.bbox[0] <= x1 && f.bbox[3] >= y0 && f.bbox[1] <= y1);
  if (!forests.length) return new Float32Array(0);
  const out: number[] = [];
  const conifer = coniferShare(inp.lat);
  const birch = Math.min(0.25, Math.max(0, (Math.abs(inp.lat) - 50) / 40));
  for (let i = Math.floor(x0 / sp); i * sp < x1; i++)
    for (let j = Math.floor(y0 / sp); j * sp < y1; j++) {
      const x = (i + hash(i, j, 1)) * sp, y = (j + hash(i, j, 2)) * sp;
      if (x < x0 || x >= x1 || y < y0 || y >= y1) continue;
      const h = hash(i, j, 3);
      if (!forests.some((f) => x >= f.bbox[0] && x <= f.bbox[2] && y >= f.bbox[1] && y <= f.bbox[3] && insideRings(x, y, f.rings))) continue;
      if (inp.blocked(x, y, h)) continue;
      const r = hash(i, j, 4);
      const kind = r < conifer ? 0 : r < conifer + birch * (1 - conifer) ? 2 : 1;
      const size = (kind === 0 ? 13 : kind === 2 ? 11 : 10) * (0.6 + 0.6 * hash(i, j, 5));
      out.push(x, y, size, kind, hash(i, j, 6) * Math.PI * 2, h);
    }
  return Float32Array.from(out);
}

// Share of a chunk's trees kept at distance d when the far forest is thinned to a reach: whole up to it, then reach / d
// (trees shrink on the screen with distance, so the screen keeps about the same density), never below MIN_KEEP.
export const MIN_KEEP = 1 / 16;
export const keepAt = (d: number, reach: number): number => Math.min(1, Math.max(MIN_KEEP, reach / d));

// The reach that brings the trees of the chunks (n trees at distance d) down to about max, those nearer than `whole`
// always kept in full. Infinity when everything fits.
export function thinReach(chunks: readonly { n: number; d: number }[], max: number, whole: number): number {
  const total = (reach: number) => chunks.reduce((a, c) => a + (c.d < whole ? c.n : c.n * keepAt(c.d, reach)), 0);
  if (total(Infinity) <= max) return Infinity;
  let lo = 1, hi = Math.max(whole, ...chunks.map((c) => c.d));
  for (let k = 0; k < 30; k++) {
    const mid = (lo + hi) / 2;
    if (total(mid) > max) hi = mid;
    else lo = mid;
  }
  return lo;
}
