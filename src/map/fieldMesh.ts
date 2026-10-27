import earcut from "earcut";
import type { XY } from "./modelGeometry";
import { clipBox } from "./waterMesh";

// Geometry of the 3D farm fields (fieldLayer.ts), pure maths in town metres: one field polygon cut into a grid of small
// cells (so the surface follows the relief between its vertices), each cell piece triangulated, the vertices on shared
// cell borders welded (no cracks), with the distance to the field's edge at every vertex (a headland strip and a soft
// rim) and the direction of the furrows.

export const FIELD_CELL = 4; // m: the edge distance is interpolated across a cell, so the cells stay finer than the 2-4 m headland
export const EDGE_CAP = 6; // m: farther from the edge than this the distance is simply "inside"

export interface FieldMesh {
  xy: number[]; // x, y per vertex
  edge: number[]; // m to the field's edge, capped at EDGE_CAP
  index: number[];
  dir: XY; // unit vector along the furrows: the longest edge, pointing east (or north when it runs due north)
  along: XY; // the field's extent along dir (min, max of dot(p, dir))
}

// The unit direction of the longest edge of a polygon, normalised to point east (north if exactly north-south).
export function furrowDirection(pts: readonly XY[]): XY {
  let best = -1, dx = 1, dy = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (l > best) (best = l), (dx = b[0] - a[0]), (dy = b[1] - a[1]);
  }
  if (best <= 0) return [1, 0];
  dx /= best;
  dy /= best;
  return dx < -1e-9 || (Math.abs(dx) <= 1e-9 && dy < 0) ? [-dx, -dy] : [dx, dy];
}

// Distance from a point to the polygon's outline.
export function edgeDistance(pts: readonly XY[], x: number, y: number): number {
  let best = Infinity;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const ex = b[0] - a[0], ey = b[1] - a[1];
    const l2 = ex * ex + ey * ey;
    const t = l2 > 0 ? Math.min(1, Math.max(0, ((x - a[0]) * ex + (y - a[1]) * ey) / l2)) : 0;
    best = Math.min(best, Math.hypot(x - a[0] - ex * t, y - a[1] - ey * t));
  }
  return best;
}

export function buildFieldMesh(pts: readonly XY[], cell = FIELD_CELL): FieldMesh {
  const dir = furrowDirection(pts);
  let lo = Infinity, hi = -Infinity;
  for (const p of pts) (lo = Math.min(lo, p[0] * dir[0] + p[1] * dir[1])), (hi = Math.max(hi, p[0] * dir[0] + p[1] * dir[1]));
  const out: FieldMesh = { xy: [], edge: [], index: [], dir, along: [lo, hi] };
  if (pts.length < 3) return out;
  const flat: number[] = [];
  for (const p of pts) flat.push(p[0], p[1]);
  const tri = earcut(flat);
  const ids = new Map<string, number>();
  const vertex = (x: number, y: number): number => {
    const key = `${Math.round(x * 1000)},${Math.round(y * 1000)}`;
    let id = ids.get(key);
    if (id === undefined) {
      id = out.xy.length / 2;
      ids.set(key, id);
      out.xy.push(x, y);
      out.edge.push(Math.min(EDGE_CAP, edgeDistance(pts, x, y)));
    }
    return id;
  };
  for (let t = 0; t < tri.length; t += 3) {
    const corners = [0, 1, 2].map((k) => [flat[tri[t + k] * 2], flat[tri[t + k] * 2 + 1]] as XY);
    const xs = corners.map((c) => c[0]), ys = corners.map((c) => c[1]);
    const i0 = Math.floor(Math.min(...xs) / cell), i1 = Math.floor(Math.max(...xs) / cell);
    const j0 = Math.floor(Math.min(...ys) / cell), j1 = Math.floor(Math.max(...ys) / cell);
    for (let i = i0; i <= i1; i++)
      for (let j = j0; j <= j1; j++) {
        const piece = clipBox(corners, [i * cell, j * cell, (i + 1) * cell, (j + 1) * cell]);
        if (piece.length < 3) continue;
        const v = piece.map(([x, y]) => vertex(x, y));
        for (let k = 1; k + 1 < v.length; k++) if (v[0] !== v[k] && v[k] !== v[k + 1] && v[0] !== v[k + 1]) out.index.push(v[0], v[k], v[k + 1]);
      }
  }
  return out;
}
