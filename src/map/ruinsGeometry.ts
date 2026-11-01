import { oldStreetKind, ROAD_KINDS } from "../sim/roads";
import type { XY } from "../world/oldworld";

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

