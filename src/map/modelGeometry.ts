import { MODEL_COLORS } from "../ui/palette";

// Shared geometry of the building models (heritageModels.ts for restored old buildings, townModels.ts for the town's own
// buildings): ring in town-local metres -> triangle mesh in the same metres (x east, y north, z up). Pure maths, no GL and
// no three.js; the layer (modelLayer.ts) projects the vertices onto the map.
//
// Pipeline: the ring is cleaned (duplicates, vertex cap, self-intersection) and falls back to its oriented bounding box
// when it is unusable. Walls are extruded from the ring; a roof is a height function over the oriented box frame (u along
// the long axis, v across) sampled on an ear-clipped triangulation that is cut along the function's creases, so ridges
// and hips come out exact for any simple ring, concave ones included. Domes, drums, towers and boxes are explicit
// primitives. Windows, plinth, log courses and shingle rows are not geometry: each vertex carries a facade code (PATTERN)
// the layer's shader paints from.

export type XY = [number, number];

export interface Model {
  positions: number[]; // x, y, z per vertex
  normals: number[];
  colors: number[]; // r, g, b in 0..1 per vertex
  facade: number[]; // s, len, top, pattern per vertex (see PATTERN)
  indices: number[];
  lift?: number[]; // per vertex: how far groundSeat.ts raised it onto the relief (the facade keeps the height above that)
  smoke?: [number, number, number][]; // chimney tops (x, y, z in the model's metres, like positions): where smokeLayer.ts lets smoke out
}

export const MAX_VERTS = 48; // rings with more vertices are simplified
export const MIN_AREA = 9; // m2; smaller rings become a box
export const MIN_SIDE = 3; // m; sides of the fallback box
export const DROP_DIST = 0.05; // m; consecutive vertices closer than this merge
export const EPS = 1e-9;

export const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));
export const rgb = (hex: string): [number, number, number] => [parseInt(hex.slice(1, 3), 16) / 255, parseInt(hex.slice(3, 5), 16) / 255, parseInt(hex.slice(5, 7), 16) / 255];

export function signedArea(r: readonly XY[]): number {
  let s = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) s += r[j][0] * r[i][1] - r[i][0] * r[j][1];
  return s / 2;
}

export function pointInRing(x: number, y: number, r: readonly XY[]): boolean {
  let inside = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, yi] = r[i], [xj, yj] = r[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function segmentsCross(a: XY, b: XY, c: XY, d: XY): boolean {
  const o = (p: XY, q: XY, r: XY) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const d1 = o(c, d, a), d2 = o(c, d, b), d3 = o(a, b, c), d4 = o(a, b, d);
  return d1 * d2 < -EPS && d3 * d4 < -EPS;
}

export function isSimple(r: readonly XY[]): boolean {
  const n = r.length;
  for (let i = 0; i < n; i++)
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      if (segmentsCross(r[i], r[(i + 1) % n], r[j], r[(j + 1) % n])) return false;
    }
  return true;
}

// Douglas-Peucker on a closed ring: split at the two points farthest from each other's chord, simplify both chains.
export function simplify(r: XY[], eps: number): XY[] {
  const keep = new Array<boolean>(r.length).fill(false);
  const dist = (p: XY, a: XY, b: XY) => {
    const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
    const t = l2 ? clamp(((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2, 0, 1) : 0;
    return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
  };
  const rec = (i: number, j: number) => {
    let worst = -1, at = -1;
    for (let k = i + 1; k < j; k++) {
      const d = dist(r[k], r[i], r[j % r.length]);
      if (d > worst) (worst = d), (at = k);
    }
    if (worst > eps) {
      keep[at] = true;
      rec(i, at);
      rec(at, j);
    }
  };
  let far = 1, best = -1;
  for (let k = 1; k < r.length; k++) {
    const d = Math.hypot(r[k][0] - r[0][0], r[k][1] - r[0][1]);
    if (d > best) (best = d), (far = k);
  }
  keep[0] = keep[far] = true;
  rec(0, far);
  rec(far, r.length);
  return r.filter((_, i) => keep[i]);
}

// Oriented bounding box: the minimum-area rectangle with a side along one of the points' hull-ish edge directions.
export interface Box {
  cx: number;
  cy: number;
  ux: number; // unit long axis
  uy: number;
  len: number; // along u
  wid: number; // across
}

export function orientedBox(pts: readonly XY[]): Box {
  let best: Box | null = null;
  let bestArea = Infinity;
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const dx = pts[(i + 1) % n][0] - pts[i][0], dy = pts[(i + 1) % n][1] - pts[i][1];
    const l = Math.hypot(dx, dy);
    if (l < EPS) continue;
    const ax = dx / l, ay = dy / l;
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (const [x, y] of pts) {
      const u = x * ax + y * ay, v = -x * ay + y * ax;
      u0 = Math.min(u0, u), u1 = Math.max(u1, u), v0 = Math.min(v0, v), v1 = Math.max(v1, v);
    }
    const a = (u1 - u0) * (v1 - v0);
    if (a < bestArea - 1e-9) {
      bestArea = a;
      const cu = (u0 + u1) / 2, cv = (v0 + v1) / 2;
      const lenU = u1 - u0, lenV = v1 - v0;
      const c = { cx: cu * ax - cv * ay, cy: cu * ay + cv * ax };
      best = lenU >= lenV ? { ...c, ux: ax, uy: ay, len: lenU, wid: lenV } : { ...c, ux: -ay, uy: ax, len: lenV, wid: lenU };
    }
  }
  if (!best) {
    // all points identical (or empty): a box around them
    const x = pts.length ? pts[0][0] : 0, y = pts.length ? pts[0][1] : 0;
    return { cx: x, cy: y, ux: 1, uy: 0, len: 0, wid: 0 };
  }
  return best;
}

export function boxRing(b: Box): XY[] {
  const l = Math.max(b.len, MIN_SIDE) / 2, w = Math.max(b.wid, MIN_SIDE) / 2;
  const at = (u: number, v: number): XY => [b.cx + u * b.ux - v * b.uy, b.cy + u * b.uy + v * b.ux];
  return [at(-l, -w), at(l, -w), at(l, w), at(-l, w)];
}

// Counter-clockwise simple ring, at most MAX_VERTS vertices; a box when the input is unusable.
export function prepareRing(input: readonly XY[]): XY[] {
  const pts = input.filter((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1])).map((p): XY => [p[0], p[1]]);
  let r: XY[] = [];
  for (const p of pts) {
    const q = r[r.length - 1];
    if (!q || Math.hypot(p[0] - q[0], p[1] - q[1]) >= DROP_DIST) r.push(p);
  }
  while (r.length > 1 && Math.hypot(r[0][0] - r[r.length - 1][0], r[0][1] - r[r.length - 1][1]) < DROP_DIST) r.pop();
  if (r.length > MAX_VERTS) {
    for (let eps = 0.1; r.length > MAX_VERTS && eps < 50; eps *= 1.6) r = simplify(r, eps);
  }
  if (r.length < 3 || r.length > MAX_VERTS || Math.abs(signedArea(r)) < MIN_AREA || !isSimple(r)) return boxRing(orientedBox(r.length ? r : pts));
  if (signedArea(r) < 0) r.reverse();
  return r;
}

export type Tri = [XY, XY, XY];

// Ear clipping of a counter-clockwise simple ring; null when it gets stuck (then the caller uses a box).
export function triangulate(r: readonly XY[]): Tri[] | null {
  const idx = r.map((_, i) => i);
  const out: Tri[] = [];
  const cross = (a: XY, b: XY, c: XY) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  let guard = r.length * r.length + 8;
  while (idx.length > 3 && guard-- > 0) {
    let clipped = false;
    for (let k = 0; k < idx.length; k++) {
      const a = r[idx[(k + idx.length - 1) % idx.length]], b = r[idx[k]], c = r[idx[(k + 1) % idx.length]];
      if (cross(a, b, c) <= EPS) continue;
      let ear = true;
      for (const j of idx) {
        const p = r[j];
        if (p === a || p === b || p === c) continue;
        if (cross(a, b, p) >= -EPS && cross(b, c, p) >= -EPS && cross(c, a, p) >= -EPS) {
          ear = false;
          break;
        }
      }
      if (!ear) continue;
      out.push([a, b, c]);
      idx.splice(k, 1);
      clipped = true;
      break;
    }
    if (!clipped) return null;
  }
  if (idx.length === 3) out.push([r[idx[0]], r[idx[1]], r[idx[2]]]);
  return out;
}

// Half-plane clip of a convex polygon: keeps a*u + b*v - c on the `sign` side.
export function clipPoly(poly: XY[], a: number, b: number, c: number, sign: 1 | -1): XY[] {
  const out: XY[] = [];
  const d = (p: XY) => sign * (a * p[0] + b * p[1] - c);
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    const dp = d(p), dq = d(q);
    if (dp >= 0) out.push(p);
    if ((dp > 0 && dq < 0) || (dp < 0 && dq > 0)) {
      const t = dp / (dp - dq);
      out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
    }
  }
  return out;
}

export type Line = [number, number, number]; // a*u + b*v = c

export function cutTriangles(tris: Tri[], lines: readonly Line[]): Tri[] {
  let cur = tris;
  for (const [a, b, c] of lines) {
    const next: Tri[] = [];
    for (const t of cur) {
      const d = t.map((p) => a * p[0] + b * p[1] - c);
      if ((d[0] >= -1e-7 && d[1] >= -1e-7 && d[2] >= -1e-7) || (d[0] <= 1e-7 && d[1] <= 1e-7 && d[2] <= 1e-7)) {
        next.push(t);
        continue;
      }
      for (const s of [1, -1] as const) {
        const poly = clipPoly([...t], a, b, c, s);
        for (let i = 1; i + 1 < poly.length; i++) {
          const piece: Tri = [poly[0], poly[i], poly[i + 1]];
          if (Math.abs(signedArea(piece)) > 1e-7) next.push(piece);
        }
      }
    }
    cur = next;
  }
  return cur;
}


// Small deterministic PRNG (mulberry32): the same building always gets the same look.
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Seed of a ring (FNV-1a over centimetre coordinates): stable for a building, different between buildings.
export function ringSeed(ring: readonly XY[]): number {
  let h = 2166136261;
  for (const p of ring)
    for (const c of p) {
      h ^= Math.round(c * 100) | 0;
      h = Math.imul(h, 16777619);
    }
  return h >>> 0;
}

export type RoofShape = "gable" | "hip" | "halfhip" | "gambrel" | "shed" | "flat";

export type RGB = [number, number, number];
export type DomeShape = "onion" | "helmet" | "tent";
export type TowerCap = "spire" | "onion" | "merlons";

// ---- Surface patterns ----

// What the layer's shader paints on a face (modelLayer.ts). A vertex's facade is (s, len, top, pattern): s and len are
// the position along its wall and the wall's length in metres (windows are centred on the wall), `top` the height in
// metres windows stay below.
export const PATTERN = { plain: 0, house: 1, hall: 2, worship: 3, logs: 4, wide: 5, tower: 6, roof: 7, boards: 8, cabin: 9, track: 30, ruts: 31, cobbles: 32, deck: 33, ashlar: 34 } as const;
// Road surfaces (30 and up, roadModels.ts) read the facade as (s along the road, offset across it, width, pattern); a
// negative width marks a joint disc (no ruts).
// Added to a wall pattern: a door at the middle of that wall (DOOR a plain one, GATE a wide double door).
export const DOOR = 10;
export const GATE = 20;
export type Fac = [number, number, number, number];
export const NOFAC: Fac = [0, 0, 0, PATTERN.plain];
export const ROOF_FAC: Fac = [0, 0, 0, PATTERN.roof];
// ---- Mesh building ----

export type P3 = [number, number, number];

// Indexed mesh under construction, in model (u, v) coordinates mapped to town metres on output.
export class Mesh {
  readonly m: Model = { positions: [], normals: [], colors: [], facade: [], indices: [] };
  constructor(private readonly box: Box) {}
  world(u: number, v: number): XY {
    const b = this.box;
    return [b.cx + u * b.ux - v * b.uy, b.cy + u * b.uy + v * b.ux];
  }
  // A vertex given in (u, v, z) with a normal in (u, v, z) directions.
  vert(u: number, v: number, z: number, n: P3, col: RGB, fac: Fac = NOFAC): number {
    const [x, y] = this.world(u, v);
    const b = this.box;
    this.m.positions.push(x, y, z);
    this.m.normals.push(n[0] * b.ux - n[1] * b.uy, n[0] * b.uy + n[1] * b.ux, n[2]);
    this.m.colors.push(col[0], col[1], col[2]);
    this.m.facade.push(fac[0], fac[1], fac[2], fac[3]);
    return this.m.positions.length / 3 - 1;
  }
  idx(a: number, b: number, c: number): void {
    this.m.indices.push(a, b, c);
  }
  // A smoke emitter at the top (u, v, z) of a chimney.
  emit(u: number, v: number, z: number): void {
    const [x, y] = this.world(u, v);
    (this.m.smoke ??= []).push([x, y, z]);
  }
  // Flat triangle; the normal comes from the winding, flipped to face up (or along `hint` when given).
  flat(a: P3, b: P3, c: P3, col: RGB, fac: Fac = NOFAC, hint?: P3): void {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz);
    if (l < 1e-12) return;
    (nx /= l), (ny /= l), (nz /= l);
    if (hint ? nx * hint[0] + ny * hint[1] + nz * hint[2] < 0 : nz < 0) (nx = -nx), (ny = -ny), (nz = -nz);
    const n: P3 = [nx, ny, nz];
    this.idx(this.vert(a[0], a[1], a[2], n, col, fac), this.vert(b[0], b[1], b[2], n, col, fac), this.vert(c[0], c[1], c[2], n, col, fac));
  }
  // Vertical quad from p to q (u, v), bottom z0p..z0q, top z1p..z1q, facing `n`; s0/s1 are the facade positions.
  wall(p: XY, q: XY, z0p: number, z0q: number, z1p: number, z1q: number, n: P3, col: RGB, s0: number, s1: number, len: number, top: number, pat: number): void {
    const v0 = this.vert(p[0], p[1], z0p, n, col, [s0, len, top, pat]), v1 = this.vert(q[0], q[1], z0q, n, col, [s1, len, top, pat]);
    const v2 = this.vert(q[0], q[1], z1q, n, col, [s1, len, top, pat]), v3 = this.vert(p[0], p[1], z1p, n, col, [s0, len, top, pat]);
    this.idx(v0, v1, v2);
    this.idx(v0, v2, v3);
  }
}

// A roof is the lowest of a few planes z = a*u + b*v + c over the eaves (none: flat). Creases are where two planes meet;
// cutting the triangulation along them keeps every piece on one plane, so ridges and hips are exact. Below the eaves line
// the planes just continue, which is what an overhang needs.
export interface Roof {
  rise: (u: number, v: number) => number;
  lines: Line[];
}

export function planeRoof(planes: P3[]): Roof {
  const lines: Line[] = [];
  for (let i = 0; i < planes.length; i++)
    for (let j = i + 1; j < planes.length; j++) {
      const a = planes[i][0] - planes[j][0], b = planes[i][1] - planes[j][1];
      if (Math.hypot(a, b) > 1e-9) lines.push([a, b, planes[j][2] - planes[i][2]]);
    }
  return {
    rise: (u, v) => {
      if (!planes.length) return 0;
      let m = Infinity;
      for (const [a, b, c] of planes) m = Math.min(m, a * u + b * v + c);
      return m;
    },
    lines,
  };
}

// Roof of a shape over the box half sizes hl x hw with ridge rise `rise` (u along the long axis).
export function roofOf(shape: RoofShape, hl: number, hw: number, rise: number): Roof {
  const s = rise / hw;
  const sides: P3[] = [[0, -s, rise], [0, s, rise]];
  switch (shape) {
    case "flat":
      return planeRoof([]);
    case "gable":
      return planeRoof(sides);
    case "shed":
      // one slope: the full rise at v = -hw, the eaves at v = +hw
      return planeRoof([[0, -rise / (2 * hw), rise / 2]]);
    case "hip":
      return planeRoof([...sides, [-s, 0, s * hl], [s, 0, s * hl]]);
    case "halfhip": {
      // gable ends clipped: the end walls rise to 55 % of the ridge, then a steeper hip
      const k = 1.4 * s;
      return planeRoof([...sides, [-k, 0, rise * 0.55 + k * hl], [k, 0, rise * 0.55 + k * hl]]);
    }
    case "gambrel": {
      // steep lower slopes up to 70 % of the rise at 55 % of the half width, shallow upper ones to the ridge
      const lo = (0.7 * rise) / (0.45 * hw), up = (0.3 * rise) / (0.55 * hw);
      return planeRoof([[0, -lo, lo * hw], [0, lo, lo * hw], [0, -up, rise], [0, up, rise]]);
    }
  }
}

// The same roof with its frame moved to (cu, cv): a roof over part of a box.
export function shiftRoof(roof: Roof, cu: number, cv: number): Roof {
  if (!cu && !cv) return roof;
  return { rise: (u, v) => roof.rise(u - cu, v - cv), lines: roof.lines.map(([a, b, c]): Line => [a, b, c + a * cu + b * cv]) };
}

// Ring pushed out by d metres (mitred corners); null when a corner is too sharp or the result crosses itself.
export function offsetRing(ring: readonly XY[], d: number): XY[] | null {
  const n = ring.length;
  const out: XY[] = [];
  const normal = (a: XY, b: XY): XY => {
    const du = b[0] - a[0], dv = b[1] - a[1], l = Math.hypot(du, dv) || 1;
    return [dv / l, -du / l];
  };
  for (let i = 0; i < n; i++) {
    const p = ring[(i + n - 1) % n], c = ring[i], q = ring[(i + 1) % n];
    const n1 = normal(p, c), n2 = normal(c, q);
    const k = 1 + n1[0] * n2[0] + n1[1] * n2[1];
    if (k < 0.3) return null;
    out.push([c[0] + (d * (n1[0] + n2[0])) / k, c[1] + (d * (n1[1] + n2[1])) / k]);
  }
  return isSimple(out) && Math.abs(signedArea(out)) > 1e-6 && Math.sign(signedArea(out)) === Math.sign(signedArea(ring)) ? out : null;
}

// Vertical band around a ring (u, v, counter-clockwise) between z = base + roof.rise + lo and base + roof.rise + hi (lo =
// null: from the ground), split where the roof creases cross an edge. Walls, parapets and roof edges. Edge `door` (index
// of its first vertex) gets the pattern `doorPat` instead, a door painted at its middle. `floor`: where lo = null starts.
export function band(mesh: Mesh, ring: readonly XY[], base: number, roof: Roof, hi: number, lo: number | null, col: RGB, pat: number, top: number, door = -1, doorPat = pat, floor = 0): void {
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    const a = ring[i], b = ring[(i + 1) % n];
    const du = b[0] - a[0], dv = b[1] - a[1];
    const len = Math.hypot(du, dv);
    if (len < 1e-6) continue;
    const norm: P3 = [dv / len, -du / len, 0];
    const ts = [0, 1];
    for (const [la, lb, lc] of roof.lines) {
      const d0 = la * a[0] + lb * a[1] - lc, d1 = la * b[0] + lb * b[1] - lc;
      if ((d0 > 1e-7 && d1 < -1e-7) || (d0 < -1e-7 && d1 > 1e-7)) ts.push(d0 / (d0 - d1));
    }
    ts.sort((x, y) => x - y);
    for (let k = 0; k + 1 < ts.length; k++) {
      if (ts[k + 1] - ts[k] < 1e-6) continue;
      const p: XY = [a[0] + du * ts[k], a[1] + dv * ts[k]], q: XY = [a[0] + du * ts[k + 1], a[1] + dv * ts[k + 1]];
      const rp = base + roof.rise(p[0], p[1]), rq = base + roof.rise(q[0], q[1]);
      mesh.wall(p, q, lo === null ? floor : rp + lo, lo === null ? floor : rq + lo, rp + hi, rq + hi, norm, col, len * ts[k], len * ts[k + 1], len, top, i === door ? doorPat : pat);
    }
  }
}

export function roofSurface(mesh: Mesh, tris: Tri[], h: number, roof: Roof, col: RGB, fac: Fac): void {
  for (const t of cutTriangles(tris, roof.lines)) {
    const p = t.map((q): P3 => [q[0], q[1], h + roof.rise(q[0], q[1])]);
    mesh.flat(p[0], p[1], p[2], col, fac);
  }
}

// Flat strip between a ring and its offset at height z (the top of a cornice).
export function ledge(mesh: Mesh, ring: readonly XY[], off: readonly XY[], z: number, col: RGB): void {
  for (let i = 0; i < ring.length; i++) {
    const j = (i + 1) % ring.length;
    const a: P3 = [ring[i][0], ring[i][1], z], b: P3 = [ring[j][0], ring[j][1], z], c: P3 = [off[j][0], off[j][1], z], d: P3 = [off[i][0], off[i][1], z];
    mesh.flat(a, b, c, col);
    mesh.flat(a, c, d, col);
  }
}

// Convex counter-clockwise polygon extruded from z0 to z1, with a top cap.
export function prism(mesh: Mesh, poly: readonly XY[], z0: number, z1: number, wall: RGB, top: RGB, pat: number = PATTERN.plain): void {
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const a = poly[i], b = poly[(i + 1) % n];
    const du = b[0] - a[0], dv = b[1] - a[1], l = Math.hypot(du, dv);
    if (l < 1e-9) continue;
    mesh.wall(a, b, z0, z0, z1, z1, [dv / l, -du / l, 0], wall, 0, l, l, z1, pat);
  }
  for (let i = 1; i + 1 < n; i++) mesh.flat([poly[0][0], poly[0][1], z1], [poly[i][0], poly[i][1], z1], [poly[i + 1][0], poly[i + 1][1], z1], top);
}

// Pyramid over a convex polygon from z up by `height`.
export function pyramid(mesh: Mesh, poly: readonly XY[], z: number, height: number, col: RGB): void {
  const cu = poly.reduce((s, p) => s + p[0], 0) / poly.length, cv = poly.reduce((s, p) => s + p[1], 0) / poly.length;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    mesh.flat([a[0], a[1], z], [b[0], b[1], z], [cu, cv, z + height], col);
  }
}

export const square = (cu: number, cv: number, side: number): XY[] => {
  const s = side / 2;
  return [[cu - s, cv - s], [cu + s, cv - s], [cu + s, cv + s], [cu - s, cv + s]];
};

// Surface of revolution about (cu, cv) from z0: profile points (radius, height above z0) bottom to top, smooth normals.
export function revolve(mesh: Mesh, cu: number, cv: number, z0: number, prof: readonly XY[], col: RGB, seg = 12): void {
  const rows: number[][] = [];
  for (let i = 0; i < prof.length; i++) {
    const a = prof[Math.max(0, i - 1)], b = prof[Math.min(prof.length - 1, i + 1)];
    let nr = b[1] - a[1], nz = -(b[0] - a[0]);
    const l = Math.hypot(nr, nz) || 1;
    (nr /= l), (nz /= l);
    const row: number[] = [];
    for (let k = 0; k < seg; k++) {
      const t = (k / seg) * Math.PI * 2, c = Math.cos(t), s = Math.sin(t);
      row.push(mesh.vert(cu + c * prof[i][0], cv + s * prof[i][0], z0 + prof[i][1], [c * nr, s * nr, nz], col));
    }
    rows.push(row);
  }
  for (let i = 0; i + 1 < rows.length; i++)
    for (let k = 0; k < seg; k++) {
      const k2 = (k + 1) % seg;
      mesh.idx(rows[i][k], rows[i][k2], rows[i + 1][k2]);
      mesh.idx(rows[i][k], rows[i + 1][k2], rows[i + 1][k]);
    }
}

export const ONION: XY[] = [[1, 0], [1.22, 0.18], [1.18, 0.36], [0.9, 0.56], [0.5, 0.74], [0.2, 0.88], [0, 1]];
export const HELMET: XY[] = [0, 1, 2, 3, 4].map((i) => [Math.cos((i / 4) * (Math.PI / 2)), Math.sin((i / 4) * (Math.PI / 2))]);
export const TENT: XY[] = [[1.05, 0], [0, 1]];

// Drum (z0..z1, radius r) with a dome on top and a small finial; returns the top height.
export function domed(mesh: Mesh, cu: number, cv: number, r: number, z0: number, z1: number, shape: DomeShape, drum: RGB, dome: RGB, finial: RGB): number {
  revolve(mesh, cu, cv, z0, [[r, 0], [r, z1 - z0]], drum);
  const [prof, k] = shape === "onion" ? [ONION, 2.1] : shape === "tent" ? [TENT, 2.4] : [HELMET, 1.2];
  const hgt = r * k;
  revolve(mesh, cu, cv, z1, prof.map(([a, b]): XY => [a * r, b * hgt]), dome);
  const top = z1 + hgt;
  const f = Math.max(0.12, r * 0.08);
  prism(mesh, square(cu, cv, f), top - 0.05, top + Math.max(0.6, r * 0.5), finial, finial);
  return top;
}

// Square tower centred at (cu, cv) from z0 to z1 with the given cap.
export function tower(mesh: Mesh, cu: number, cv: number, side: number, z0: number, z1: number, cap: TowerCap, wall: RGB, top: RGB, accent: RGB): void {
  const sq = square(cu, cv, side);
  prism(mesh, sq, z0, z1, wall, top, PATTERN.tower);
  if (cap === "spire") pyramid(mesh, sq, z1, side * 1.6, top);
  else if (cap === "onion") domed(mesh, cu, cv, side * 0.36, z1, z1 + side * 0.35, "onion", wall, top, accent);
  else merlons(mesh, sq, z1, wall);
}

// Crenellations on top of a ring's walls: blocks along each edge, on the inner side.
export function merlons(mesh: Mesh, ring: readonly XY[], z: number, col: RGB): void {
  const LEN = 0.7, GAP = 0.6, TH = 0.5, H = 0.7;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    const du = b[0] - a[0], dv = b[1] - a[1], l = Math.hypot(du, dv);
    if (l < LEN) continue;
    const eu = du / l, ev = dv / l, iu = -ev * TH, iv = eu * TH;
    const count = Math.floor((l + GAP) / (LEN + GAP));
    const start = (l - (count * (LEN + GAP) - GAP)) / 2;
    for (let k = 0; k < count; k++) {
      const t0 = start + k * (LEN + GAP), t1 = t0 + LEN;
      const p: XY = [a[0] + eu * t0, a[1] + ev * t0], q: XY = [a[0] + eu * t1, a[1] + ev * t1];
      prism(mesh, [p, q, [q[0] + iu, q[1] + iv], [p[0] + iu, p[1] + iv]], z, z + H, col, col);
    }
  }
}

export const shade = (c: RGB, k: number): RGB => [c[0] * k, c[1] * k, c[2] * k];

// Prepared ring in its box frame (u along the long axis) with a triangulation; falls back to the box when ear clipping fails.
export function framed(ringIn: readonly XY[]): { box: Box; uv: XY[]; tris: Tri[]; seed: number } {
  let ring = prepareRing(ringIn);
  const box = orientedBox(ring);
  const toUV = (p: XY): XY => [(p[0] - box.cx) * box.ux + (p[1] - box.cy) * box.uy, -(p[0] - box.cx) * box.uy + (p[1] - box.cy) * box.ux];
  let uv = ring.map(toUV);
  let tris = triangulate(uv);
  if (!tris) {
    ring = boxRing(box);
    uv = ring.map(toUV);
    tris = triangulate(uv)!;
  }
  return { box, uv, tris, seed: ringSeed(ring) };
}

// A building under construction, opaque: log walls as high as `height` allows at the given progress with a deck on top,
// and corner posts already standing to the full height.
export function buildScaffold(ringIn: readonly XY[], height: number, progress: number): Model {
  const { box, uv, tris } = framed(ringIn);
  const mesh = new Mesh(box);
  const pal = MODEL_COLORS.scaffold;
  const wall = rgb(pal.wall[0]), deck = rgb(pal.roof[0]), post = rgb(pal.accent[0]);
  const full = clamp(Number.isFinite(height) ? height : 6, 2, 60);
  const h = Math.max(0.5, full * clamp(progress, 0, 1));
  const flat = planeRoof([]);
  band(mesh, uv, h, flat, 0, null, wall, PATTERN.logs, h);
  roofSurface(mesh, tris, h, flat, deck, NOFAC);
  if (h < full) cornerPosts(mesh, uv, full, post);
  return mesh.m;
}

// Square posts at the corners of a ring that really turn, a little inside the walls, from the ground to z1.
export function cornerPosts(mesh: Mesh, uv: readonly XY[], z1: number, col: RGB, side = 0.24): void {
  const inner = offsetRing(uv, -0.15) ?? uv;
  const n = uv.length;
  for (let i = 0; i < n; i++) {
    const p = uv[(i + n - 1) % n], c = uv[i], q = uv[(i + 1) % n];
    const a1 = Math.atan2(c[1] - p[1], c[0] - p[0]), a2 = Math.atan2(q[1] - c[1], q[0] - c[0]);
    let turn = Math.abs(a2 - a1);
    if (turn > Math.PI) turn = 2 * Math.PI - turn;
    if (turn < 0.4) continue;
    prism(mesh, square(inner[i][0], inner[i][1], side), 0, z1, col, col);
  }
}

// A closed cylinder of radius r from a to b (any direction: logs, poles), with flat ends.
export function cylinder(mesh: Mesh, a: P3, b: P3, r: number, col: RGB, end: RGB = col, seg = 8): void {
  const d: P3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const l = Math.hypot(d[0], d[1], d[2]);
  if (l < 1e-6) return;
  const t: P3 = [d[0] / l, d[1] / l, d[2] / l];
  const up: P3 = Math.abs(t[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  let e1: P3 = [t[1] * up[2] - t[2] * up[1], t[2] * up[0] - t[0] * up[2], t[0] * up[1] - t[1] * up[0]];
  const l1 = Math.hypot(e1[0], e1[1], e1[2]);
  e1 = [e1[0] / l1, e1[1] / l1, e1[2] / l1];
  const e2: P3 = [t[1] * e1[2] - t[2] * e1[1], t[2] * e1[0] - t[0] * e1[2], t[0] * e1[1] - t[1] * e1[0]];
  const side: number[][] = [[], []];
  const caps: number[][] = [[], []];
  for (let k = 0; k < seg; k++) {
    const q = (k / seg) * Math.PI * 2, cq = Math.cos(q), sq = Math.sin(q);
    const n: P3 = [e1[0] * cq + e2[0] * sq, e1[1] * cq + e2[1] * sq, e1[2] * cq + e2[2] * sq];
    for (const [j, p] of [a, b].entries()) {
      const v: P3 = [p[0] + n[0] * r, p[1] + n[1] * r, p[2] + n[2] * r];
      side[j].push(mesh.vert(v[0], v[1], v[2], n, col));
      caps[j].push(mesh.vert(v[0], v[1], v[2], j ? t : [-t[0], -t[1], -t[2]], end));
    }
  }
  for (let k = 0; k < seg; k++) {
    const k2 = (k + 1) % seg;
    mesh.idx(side[0][k], side[0][k2], side[1][k2]);
    mesh.idx(side[0][k], side[1][k2], side[1][k]);
    if (k > 0 && k2 > 0) {
      mesh.idx(caps[0][0], caps[0][k], caps[0][k2]);
      mesh.idx(caps[1][0], caps[1][k], caps[1][k2]);
    }
  }
}
