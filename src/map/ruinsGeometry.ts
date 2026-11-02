import { oldStreetKind, ROAD_KINDS } from "../sim/roads";
import { mixHex, PALETTE, TREE_COLORS } from "../ui/palette";
import type { XY } from "../world/oldworld";
import { PATTERN, rgb, type Model, type RGB } from "./modelGeometry";

// Shapes of the buried old city (pure, for every renderer): street widths and the low broken walls over a foundation.

export const WALL_HEIGHT = 0.6; // m
export const WALL_THICKNESS = 0.5; // m
const MAJOR = new Set(["motorway", "trunk", "primary", "secondary", "tertiary"]);

// Major streets wide, footways and tracks as narrow as the path they come back as, the rest in between.
export const streetWidth = (cls: string): number => (MAJOR.has(cls) ? 10 : oldStreetKind(cls, false) === "path" ? ROAD_KINDS.path.width : 6);

// ---------- pure geometry ----------

const area2 = (r: XY[]): number => {
  let s = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) s += r[j][0] * r[i][1] - r[i][0] * r[j][1];
  return s;
};

// Proper intersection of segments ab and cd (touching endpoints do not count).
function segCross(a: XY, b: XY, c: XY, d: XY): boolean {
  const o = (p: XY, q: XY, r: XY) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const d1 = o(a, b, c);
  const d2 = o(a, b, d);
  const d3 = o(c, d, a);
  const d4 = o(c, d, b);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

function selfIntersects(r: XY[]): boolean {
  const n = r.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue; // adjacent through the closing edge
      if (segCross(r[i], r[(i + 1) % n], r[j], r[(j + 1) % n])) return true;
    }
  }
  return false;
}

// Ring moved `d` m towards its inside (mitred corners). Returns an open ring in counter-clockwise
// order, or null when the inset degenerates (too thin, spiky, self-intersecting, flipped).
// The ring without repeated or closing points, counter-clockwise; null when it encloses nothing.
function cleanRing(ring: XY[]): XY[] | null {
  const EPS = 0.01; // 1 cm: removes zero-ish vector-tile edges that create huge mitres
  const p0: XY[] = [];
  for (const q of ring) {
    const last = p0[p0.length - 1];
    if (!last || Math.hypot(q[0] - last[0], q[1] - last[1]) > EPS) p0.push(q);
  }
  if (p0.length > 1 && Math.hypot(p0[0][0] - p0[p0.length - 1][0], p0[0][1] - p0[p0.length - 1][1]) <= EPS) p0.pop();
  if (p0.length < 3 || selfIntersects(p0)) return null;
  const a0 = area2(p0);
  if (Math.abs(a0) < 1e-9) return null;
  return a0 < 0 ? p0.slice().reverse() : p0; // counter-clockwise: the inside is on the left of every edge
}

function pointInRing(q: XY, ring: XY[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[j], b = ring[i];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const l2 = dx * dx + dy * dy;
    const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((q[0] - a[0]) * dx + (q[1] - a[1]) * dy) / l2));
    if (Math.hypot(q[0] - (a[0] + dx * t), q[1] - (a[1] + dy * t)) < 1e-7) return true;
    if ((b[1] > q[1]) !== (a[1] > q[1]) && q[0] < ((a[0] - b[0]) * (q[1] - b[1])) / (a[1] - b[1]) + b[0]) inside = !inside;
  }
  return inside;
}

export function insetRing(ring: XY[], d: number): XY[] | null {
  const p = cleanRing(ring);
  if (!p) return null;
  const n = p.length;
  const normals: XY[] = [];
  for (let i = 0; i < n; i++) {
    const [x0, y0] = p[i];
    const [x1, y1] = p[(i + 1) % n];
    const len = Math.hypot(x1 - x0, y1 - y0);
    if (len < 1e-9) return null;
    normals.push([-(y1 - y0) / len, (x1 - x0) / len]);
  }
  const out: XY[] = [];
  for (let i = 0; i < n; i++) {
    const n0 = normals[(i + n - 1) % n];
    const n1 = normals[i];
    const k = 1 + n0[0] * n1[0] + n0[1] * n1[1];
    if (k < 0.05) return null; // near-reversal: the miter would shoot off
    const mx = (d * (n0[0] + n1[0])) / k;
    const my = (d * (n0[1] + n1[1])) / k;
    if (Math.hypot(mx, my) > d * 8) return null;
    out.push([p[i][0] + mx, p[i][1] + my]);
  }
  // Every inset edge must keep its direction (otherwise it collapsed and flipped).
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const ox = p[j][0] - p[i][0];
    const oy = p[j][1] - p[i][1];
    const nx = out[j][0] - out[i][0];
    const ny = out[j][1] - out[i][1];
    if (ox * nx + oy * ny <= 0) return null;
  }
  const a1 = area2(out);
  if (a1 <= 0 || a1 >= area2(p)) return null;
  if (selfIntersects(out)) return null;
  // A mathematically valid mitre can still jump across a deep concavity. In that case
  // MapLibre triangulates the wall band through the building interior, producing the
  // characteristic "inside face". Prefer a flat outline to broken 3D geometry.
  if (out.some((q) => !pointInRing(q, p))) return null;
  return out;
}

// The walls of a foundation as they stand after a century: pieces about PIECE m along the ring, each its own height
// (a hash of the foundation and the piece), higher at the corners, which hold out longest, and higher for a building
// that was tall; about one piece in six has fallen to a stub. Null when the ring is too thin for walls.
const PIECE = 2.5; // m
export function brokenWalls(ring: XY[], key: string, height = 6): { quad: XY[]; h: number }[] | null {
  const p = cleanRing(ring);
  if (!p) return null;

  let seed = 0;
  for (let i = 0; i < key.length; i++) seed = (seed * 31 + key.charCodeAt(i)) | 0;
  const rnd = (a: number, b: number) => {
    let h = Math.imul(seed ^ Math.imul(a + 1, 374761393) ^ Math.imul(b + 1, 668265263), 1274126177);
    h ^= h >>> 15;
    return (h >>> 0) / 4294967296;
  };

  const top = Math.min(3, Math.max(1.2, height * 0.3)); // m, the best kept piece of this building
  const out: { quad: XY[]; h: number }[] = [];
  const lerp = (a: XY, b: XY, t: number): XY => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

  // Build every wall piece directly from its outer edge. For a counter-clockwise
  // footprint the left-hand normal always points into the building. This avoids the
  // old outer-to-inset vertex correspondence entirely: on concave footprints that
  // correspondence could create a diagonal polygon spanning the building interior.
  for (let i = 0; i < p.length; i++) {
    const j = (i + 1) % p.length;
    const ex = p[j][0] - p[i][0];
    const ey = p[j][1] - p[i][1];
    const len = Math.hypot(ex, ey);
    if (len < 1e-6) continue;

    const nx = (-ey / len) * WALL_THICKNESS;
    const ny = (ex / len) * WALL_THICKNESS;
    const n = Math.max(1, Math.round(len / PIECE));

    for (let k = 0; k < n; k++) {
      const t0 = k / n;
      const t1 = (k + 1) / n;
      const a = lerp(p[i], p[j], t0);
      const b = lerp(p[i], p[j], t1);
      const ai: XY = [a[0] + nx, a[1] + ny];
      const bi: XY = [b[0] + nx, b[1] + ny];

      // If the footprint is locally thinner than the wall itself, drawing this piece
      // would put its inner edge outside the foundation. Skip only that piece instead
      // of turning the whole building into an outline.
      const mid: XY = [(a[0] + b[0]) / 2 + nx * 0.5, (a[1] + b[1]) / 2 + ny * 0.5];
      if (!pointInRing(ai, p) || !pointInRing(bi, p) || !pointInRing(mid, p)) continue;

      const corner = Math.max(0, 1 - Math.min(k, n - 1 - k) * 0.6);
      const r = rnd(i, k);
      const h = r < 0.16 ? 0.1 : WALL_HEIGHT * 0.5 + (top - WALL_HEIGHT * 0.5) * Math.min(1, rnd(i, k + 1000) ** 2 * 0.8 + corner * 0.5 * r);

      // Always a convex rectangle; MapLibre/earcut therefore cannot invent an
      // interior diagonal face while triangulating the extrusion cap.
      out.push({ quad: [a, b, bi, ai], h });
    }
  }

  return out.length ? out : null;
}

// ---------- layer ----------


// ---------- the broken walls as a 3D model (the engine; MapLibre extrudes the same quads itself) ----------

// Colour of a wall piece by its height, the old fill-extrusion ramp : the lowest pieces grown over
// with moss, waist-high ones bare, the best kept weathered stone.
const WALL_STOPS: [number, string][] = [
  [0.1, mixHex(PALETTE.pencilFaint, TREE_COLORS.summer, 0.45)],
  [1, PALETTE.pencilFaint],
  [2.5, mixHex(PALETTE.pencilFaint, TREE_COLORS.stone, 0.5)],
];
export function ruinWallColour(h: number): RGB {
  const s = WALL_STOPS;
  if (h <= s[0][0]) return rgb(s[0][1]);
  for (let i = 1; i < s.length; i++)
    if (h <= s[i][0]) {
      const t = (h - s[i - 1][0]) / (s[i][0] - s[i - 1][0]);
      return rgb(mixHex(s[i - 1][1], s[i][1], t));
    }
  return rgb(s[s.length - 1][1]);
}

export const RUIN_WALL_BURY = 0.3; // m the pieces reach below the lowest ground under them, so slopes leave no gap
const WALL_FOOT = 0.82; // the foot of a piece darker than its top (the old extrusion's vertical gradient)

// Wall pieces (brokenWalls) as one model seated on the ground (town metres -> drawn ground height): each piece a prism
// from below its lowest corner to its height over the mean ground of its corners, coloured by height, open below.
// `lift` is that mean ground, so the facade height of a vertex is its height over the ground, like a seated building's.
export function ruinWallModel(pieces: readonly { quad: XY[]; h: number }[], ground: (x: number, y: number) => number): Model {
  const m: Model = { positions: [], normals: [], colors: [], facade: [], indices: [], lift: [] };
  const lift = m.lift!;
  const vert = (x: number, y: number, z: number, n: [number, number, number], c: RGB, g: number, s = 0, len = 0) => {
    m.positions.push(x, y, z);
    m.normals.push(...n);
    m.colors.push(...c);
    m.facade.push(s, len, 0, PATTERN.plain);
    lift.push(g);
    return m.positions.length / 3 - 1;
  };
  for (const { quad, h } of pieces) {
    if (quad.length < 3 || !(h > 0)) continue;
    const gs = quad.map(([x, y]) => ground(x, y));
    const g = gs.reduce((a, b) => a + b, 0) / gs.length;
    const z0 = Math.min(...gs) - RUIN_WALL_BURY;
    const z1 = g + h;
    const top = ruinWallColour(h);
    const foot: RGB = [top[0] * WALL_FOOT, top[1] * WALL_FOOT, top[2] * WALL_FOOT];
    const cx = quad.reduce((a, q) => a + q[0], 0) / quad.length;
    const cy = quad.reduce((a, q) => a + q[1], 0) / quad.length;
    // top: a fan over the convex quad
    const t0 = m.positions.length / 3;
    for (const [x, y] of quad) vert(x, y, z1, [0, 0, 1], top, g);
    for (let i = 1; i + 1 < quad.length; i++) m.indices.push(t0, t0 + i, t0 + i + 1);
    // sides, each with its own outward normal
    for (let i = 0; i < quad.length; i++) {
      const a = quad[i];
      const b = quad[(i + 1) % quad.length];
      const ex = b[0] - a[0];
      const ey = b[1] - a[1];
      const len = Math.hypot(ex, ey);
      if (len < 1e-6) continue;
      let nx = ey / len;
      let ny = -ex / len;
      if (nx * ((a[0] + b[0]) / 2 - cx) + ny * ((a[1] + b[1]) / 2 - cy) < 0) (nx = -nx), (ny = -ny);
      const n: [number, number, number] = [nx, ny, 0];
      const i0 = vert(a[0], a[1], z0, n, foot, g, 0, len);
      const i1 = vert(b[0], b[1], z0, n, foot, g, len, len);
      const i2 = vert(b[0], b[1], z1, n, top, g, len, len);
      const i3 = vert(a[0], a[1], z1, n, top, g, 0, len);
      m.indices.push(i0, i1, i2, i0, i2, i3);
    }
  }
  return m;
}
