import { Mesh, PATTERN, prepareRing, rgb, triangulate, type Model, type XY } from "./modelGeometry";

// Puts a model built on flat ground (z = 0 is the ground, modelGeometry.ts) onto the relief. `ground(x, y)` is the
// drawn ground height in town metres (already exaggerated); models stay in town-local x, y and only z moves.
// - building: the whole model goes up to the highest ground under its lot, so no wall is buried, and a plinth fills
//   down to below the lowest ground (the terrain mesh and our samples differ a little between DEM pixels);
// - ground road: every vertex follows the ground under it (the ribbons are resampled finely, roadModels.ts);
// - bridge: the deck runs straight between the ground at its two ends, and what stands on the riverbed (piles, piers,
//   the foot of the arches, z near 0) reaches down to the ground under it.

const PLINTH_BELOW = 0.4; // m below the lowest ground under the lot
const MIN_STEP = 0.05; // m; flatter lots get no plinth
const BASE_Z = 0.01; // m; vertices this low are on the ground (bridge feet)
export const ROAD_LIFT = 0.08; // m; ground roads ride this far above the terrain mesh, which our samples follow closely

export type Ground = (x: number, y: number) => number;

function shifted(model: Model, dz: (x: number, y: number, z: number) => number): Model {
  const p = model.positions.slice();
  for (let k = 0; k < p.length; k += 3) p[k + 2] = dz(p[k], p[k + 1], p[k + 2]);
  return { ...model, positions: p };
}

export function seatBuilding(model: Model, ring: readonly XY[], ground: Ground, plinth: string): Model {
  const pts: XY[] = [...ring, centroid(ring)];
  const h = pts.map(([x, y]) => ground(x, y));
  const top = Math.max(...h), low = Math.min(...h);
  const out = shifted(model, (_x, _y, z) => z + top);
  if (top - low < MIN_STEP) return out;
  const r = prepareRing(ring);
  const tris = triangulate(r);
  if (!tris) return out;
  const mesh = new Mesh({ cx: 0, cy: 0, ux: 1, uy: 0, len: 0, wid: 0 });
  const col = rgb(plinth);
  const z0 = low - PLINTH_BELOW;
  for (let i = 0; i < r.length; i++) {
    const a = r[i], b = r[(i + 1) % r.length];
    const du = b[0] - a[0], dv = b[1] - a[1], l = Math.hypot(du, dv);
    if (l > 1e-9) mesh.wall(a, b, z0, z0, top, top, [dv / l, -du / l, 0], col, 0, l, l, top, PATTERN.plain);
  }
  // the top is seen in yards and gardens (houses cover it with their floor); concave lots need the real triangulation
  for (const [p, q, s] of tris) mesh.flat([p[0], p[1], top], [q[0], q[1], top], [s[0], s[1], top], col);
  return merge(out, mesh.m);
}

export function drapeRoad(model: Model, ground: Ground): Model {
  return shifted(model, (x, y, z) => z + ground(x, y) + ROAD_LIFT);
}

export function seatBridge(model: Model, pts: readonly XY[], ground: Ground): Model {
  if (pts.length < 2) return drapeRoad(model, ground);
  const a = ground(pts[0][0], pts[0][1]), b = ground(pts[pts.length - 1][0], pts[pts.length - 1][1]);
  const line = along(pts);
  return shifted(model, (x, y, z) => {
    const deck = a + (b - a) * line(x, y);
    return z <= BASE_Z ? Math.min(deck, ground(x, y)) + z : z + deck;
  });
}

function centroid(ring: readonly XY[]): XY {
  let x = 0, y = 0;
  for (const q of ring) (x += q[0]), (y += q[1]);
  return [x / ring.length, y / ring.length];
}

// Fraction 0..1 along a polyline of the point's nearest spot on it.
function along(pts: readonly XY[]): (x: number, y: number) => number {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const total = cum[cum.length - 1] || 1;
  return (x, y) => {
    let best = Infinity, s = 0;
    for (let i = 1; i < pts.length; i++) {
      const [ax, ay] = pts[i - 1], [bx, by] = pts[i];
      const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy || 1;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2));
      const d = Math.hypot(ax + dx * t - x, ay + dy * t - y);
      if (d < best) (best = d), (s = cum[i - 1] + t * (cum[i] - cum[i - 1]));
    }
    return s / total;
  };
}

function merge(a: Model, b: Model): Model {
  const n = a.positions.length / 3;
  return {
    positions: [...a.positions, ...b.positions],
    normals: [...a.normals, ...b.normals],
    colors: [...a.colors, ...b.colors],
    facade: [...a.facade, ...b.facade],
    indices: [...a.indices, ...b.indices.map((i) => i + n)],
  };
}
