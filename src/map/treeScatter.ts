import type { XY } from "./modelGeometry";

// Where the trees of the 3D forest stand (PLAN-3d-world.ru.md stage 4). Pure: forest polygons in town metres in, one
// record per tree out. A jittered grid over a disc around the town; each cell's point, size, species and turn come from
// a hash of the cell, so a tree keeps its place when anything else (a clearing, a new house) changes around it.

export const TREE_STRIDE = 6; // x, y, size (m tall), kind, turn (rad), hash (0..1)
export const TREE_KINDS = ["conifer", "broadleaf", "birch"] as const;
export type TreeKind = (typeof TREE_KINDS)[number];

export interface ForestPoly {
  bbox: [number, number, number, number];
  rings: XY[][]; // even-odd across the rings
}

export interface ScatterInput {
  forests: readonly ForestPoly[];
  centre: XY;
  radius: number; // m; trees shrink to nothing over the last FADE metres
  spacing: number; // m between grid cells
  lat: number; // species mix: conifers rule the north
  maxTrees: number; // more would be thinned evenly (by the tree hash) down to this
  // Ground that has no tree (houses, roads, fields, finished clearings). h: the tree's hash, so a clearing under way
  // can fell a share of its trees.
  blocked: (x: number, y: number, h: number) => boolean;
}

const FADE = 150;

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
  const { centre, radius, spacing } = inp;
  const out: number[] = [];
  const n = Math.ceil(radius / spacing);
  const conifer = coniferShare(inp.lat);
  const birch = Math.min(0.25, Math.max(0, (Math.abs(inp.lat) - 50) / 40));
  for (let i = -n; i <= n; i++)
    for (let j = -n; j <= n; j++) {
      const x = centre[0] + (i + hash(i, j, 1)) * spacing - spacing / 2;
      const y = centre[1] + (j + hash(i, j, 2)) * spacing - spacing / 2;
      const d = Math.hypot(x - centre[0], y - centre[1]);
      if (d > radius) continue;
      const h = hash(i, j, 3);
      if (!inp.forests.some((f) => x >= f.bbox[0] && x <= f.bbox[2] && y >= f.bbox[1] && y <= f.bbox[3] && insideRings(x, y, f.rings))) continue;
      if (inp.blocked(x, y, h)) continue;
      const fade = Math.min(1, (radius - d) / FADE);
      const r = hash(i, j, 4);
      const kind = r < conifer ? 0 : r < conifer + birch * (1 - conifer) ? 2 : 1;
      const size = (kind === 0 ? 13 : kind === 2 ? 11 : 10) * (0.6 + 0.6 * hash(i, j, 5)) * (0.25 + 0.75 * fade);
      out.push(x, y, size, kind, hash(i, j, 6) * Math.PI * 2, h);
    }
  const total = out.length / TREE_STRIDE;
  if (total <= inp.maxTrees) return Float32Array.from(out);
  const keep = inp.maxTrees / total, thin: number[] = [];
  // by place: a tree stays or goes whatever changes elsewhere
  for (let k = 0; k < out.length; k += TREE_STRIDE) if (hash(Math.round(out[k] * 10), Math.round(out[k + 1] * 10), 8) < keep) thin.push(...out.slice(k, k + TREE_STRIDE));
  return Float32Array.from(thin);
}
