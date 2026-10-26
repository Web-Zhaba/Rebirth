import { MODEL_COLORS, type ModelFamily } from "../ui/palette";

// Geometry of restored old buildings (PLAN-research.ru.md section 8): ring in town-local metres + height + OSM kind ->
// triangle mesh in the same metres (x east, y north, z up). Pure maths, no GL and no three.js; the layer
// (restoredLayer.ts) projects the vertices onto the map.
//
// Pipeline: the ring is cleaned (duplicates, vertex cap, self-intersection) and falls back to its oriented bounding box
// when it is unusable. Walls are extruded from the ring; the roof is a height function over the oriented box frame
// (u along the long axis, v across) sampled on an ear-clipped triangulation that is cut along the function's creases,
// so ridges and hips come out exact for any simple ring, concave ones included. Domes, drums and towers are explicit
// primitives.

export type XY = [number, number];

export interface HeritageModel {
  positions: number[]; // x, y, z per vertex
  normals: number[];
  colors: number[]; // r, g, b in 0..1 per vertex
  indices: number[];
}

// Roof family of an OSM kind (the `cls` of src/sim/heritage.ts).
export function modelFamily(kind: string): ModelFamily {
  switch (kind) {
    case "place_of_worship":
    case "monastery":
      return "worship";
    case "castle":
    case "town_hall":
    case "monument":
      return "tower";
    case "school":
    case "college":
    case "museum":
    case "library":
    case "theatre":
    case "hospital":
      return "hip";
    case "station":
    case "halt":
    case "bus_station":
    case "harbor":
    case "ferry_terminal":
    case "car_repair":
    case "marketplace":
    case "department_store":
    case "mall":
    case "wholesale":
      return "flat";
    default:
      return "house";
  }
}

const MAX_VERTS = 48; // rings with more vertices are simplified
const MIN_AREA = 9; // m2; smaller rings become a box
const MIN_SIDE = 3; // m; sides of the fallback box
const DROP_DIST = 0.05; // m; consecutive vertices closer than this merge
const EPS = 1e-9;

const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));
const rgb = (hex: string): [number, number, number] => [parseInt(hex.slice(1, 3), 16) / 255, parseInt(hex.slice(3, 5), 16) / 255, parseInt(hex.slice(5, 7), 16) / 255];

function signedArea(r: readonly XY[]): number {
  let s = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) s += r[j][0] * r[i][1] - r[i][0] * r[j][1];
  return s / 2;
}

function pointInRing(x: number, y: number, r: readonly XY[]): boolean {
  let inside = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, yi] = r[i], [xj, yj] = r[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function segmentsCross(a: XY, b: XY, c: XY, d: XY): boolean {
  const o = (p: XY, q: XY, r: XY) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const d1 = o(c, d, a), d2 = o(c, d, b), d3 = o(a, b, c), d4 = o(a, b, d);
  return d1 * d2 < -EPS && d3 * d4 < -EPS;
}

function isSimple(r: readonly XY[]): boolean {
  const n = r.length;
  for (let i = 0; i < n; i++)
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      if (segmentsCross(r[i], r[(i + 1) % n], r[j], r[(j + 1) % n])) return false;
    }
  return true;
}

// Douglas-Peucker on a closed ring: split at the two points farthest from each other's chord, simplify both chains.
function simplify(r: XY[], eps: number): XY[] {
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

function boxRing(b: Box): XY[] {
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

type Tri = [XY, XY, XY];

// Ear clipping of a counter-clockwise simple ring; null when it gets stuck (then the caller uses a box).
function triangulate(r: readonly XY[]): Tri[] | null {
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
function clipPoly(poly: XY[], a: number, b: number, c: number, sign: 1 | -1): XY[] {
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

type Line = [number, number, number]; // a*u + b*v = c

function cutTriangles(tris: Tri[], lines: readonly Line[]): Tri[] {
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

// Indexed mesh under construction, in model (u, v) coordinates mapped to town metres on output.
class Mesh {
  readonly m: HeritageModel = { positions: [], normals: [], colors: [], indices: [] };
  constructor(private readonly box: Box) {}
  world(u: number, v: number): XY {
    const b = this.box;
    return [b.cx + u * b.ux - v * b.uy, b.cy + u * b.uy + v * b.ux];
  }
  // A vertex given in (u, v, z) with a normal in (u, v, z) directions.
  vert(u: number, v: number, z: number, n: [number, number, number], col: [number, number, number]): number {
    const [x, y] = this.world(u, v);
    const b = this.box;
    this.m.positions.push(x, y, z);
    this.m.normals.push(n[0] * b.ux - n[1] * b.uy, n[0] * b.uy + n[1] * b.ux, n[2]);
    this.m.colors.push(col[0], col[1], col[2]);
    return this.m.positions.length / 3 - 1;
  }
  idx(a: number, b: number, c: number): void {
    this.m.indices.push(a, b, c);
  }
  // Flat triangle; the normal comes from the winding, flipped to `up` (roofs) or `side` as given.
  flat(a: [number, number, number], b: [number, number, number], c: [number, number, number], col: [number, number, number], faceUp = true, hint?: [number, number, number]): void {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz);
    if (l < 1e-12) return;
    nx /= l, ny /= l, nz /= l;
    if (hint ? nx * hint[0] + ny * hint[1] + nz * hint[2] < 0 : faceUp && nz < 0) (nx = -nx), (ny = -ny), (nz = -nz);
    const n: [number, number, number] = [nx, ny, nz];
    const i = this.vert(a[0], a[1], a[2], n, col);
    const j = this.vert(b[0], b[1], b[2], n, col);
    const k = this.vert(c[0], c[1], c[2], n, col);
    this.idx(i, j, k);
  }
}

interface Roof {
  rise: (u: number, v: number) => number; // height above the eaves
  lines: Line[]; // creases of `rise`
}

const FLAT: Roof = { rise: () => 0, lines: [] };

function gableRoof(hw: number, rise: number): Roof {
  return { rise: (_u, v) => rise * Math.max(0, 1 - Math.abs(v) / hw), lines: [[0, 1, 0]] };
}

function hipRoof(hl: number, hw: number, rise: number): Roof {
  const c = hl - hw;
  return {
    rise: (u, v) => (rise * Math.max(0, Math.min(hw - Math.abs(v), hl - Math.abs(u)))) / hw,
    lines: [[0, 1, 0], [1, -1, c], [1, -1, -c], [1, 1, c], [1, 1, -c]],
  };
}

// Walls of a ring (u, v coordinates, counter-clockwise) up to eaves height h plus the roof height at each point; wall
// tops are split where the roof creases cross them.
function walls(mesh: Mesh, ring: readonly XY[], h: number, roof: Roof, col: [number, number, number], extra = 0): void {
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    const a = ring[i], b = ring[(i + 1) % n];
    const du = b[0] - a[0], dv = b[1] - a[1];
    const len = Math.hypot(du, dv);
    if (len < 1e-6) continue;
    const norm: [number, number, number] = [dv / len, -du / len, 0];
    const ts = [0, 1];
    for (const [la, lb, lc] of roof.lines) {
      const d0 = la * a[0] + lb * a[1] - lc, d1 = la * b[0] + lb * b[1] - lc;
      if ((d0 > 1e-7 && d1 < -1e-7) || (d0 < -1e-7 && d1 > 1e-7)) ts.push(d0 / (d0 - d1));
    }
    ts.sort((x, y) => x - y);
    for (let k = 0; k + 1 < ts.length; k++) {
      if (ts[k + 1] - ts[k] < 1e-6) continue;
      const p = [a[0] + du * ts[k], a[1] + dv * ts[k]], q = [a[0] + du * ts[k + 1], a[1] + dv * ts[k + 1]];
      const zp = h + extra + roof.rise(p[0], p[1]), zq = h + extra + roof.rise(q[0], q[1]);
      const v0 = mesh.vert(p[0], p[1], 0, norm, col), v1 = mesh.vert(q[0], q[1], 0, norm, col);
      const v2 = mesh.vert(q[0], q[1], zq, norm, col), v3 = mesh.vert(p[0], p[1], zp, norm, col);
      mesh.idx(v0, v1, v2);
      mesh.idx(v0, v2, v3);
    }
  }
}

function roofSurface(mesh: Mesh, tris: Tri[], h: number, roof: Roof, col: [number, number, number]): void {
  for (const t of cutTriangles(tris, roof.lines)) {
    const p = t.map((q): [number, number, number] => [q[0], q[1], h + roof.rise(q[0], q[1])]);
    mesh.flat(p[0], p[1], p[2], col);
  }
}

// Square prism with a pyramid spire, centred at (cu, cv), from z0 up to z1; the spire rises `spire` above it.
function tower(mesh: Mesh, cu: number, cv: number, side: number, z0: number, z1: number, spire: number, wall: [number, number, number], top: [number, number, number]): void {
  const s = side / 2;
  const c: XY[] = [[cu - s, cv - s], [cu + s, cv - s], [cu + s, cv + s], [cu - s, cv + s]];
  for (let i = 0; i < 4; i++) {
    const a = c[i], b = c[(i + 1) % 4];
    const du = b[0] - a[0], dv = b[1] - a[1], l = Math.hypot(du, dv);
    const n: [number, number, number] = [dv / l, -du / l, 0];
    const v0 = mesh.vert(a[0], a[1], z0, n, wall), v1 = mesh.vert(b[0], b[1], z0, n, wall);
    const v2 = mesh.vert(b[0], b[1], z1, n, wall), v3 = mesh.vert(a[0], a[1], z1, n, wall);
    mesh.idx(v0, v1, v2);
    mesh.idx(v0, v2, v3);
  }
  for (let i = 0; i < 4; i++) {
    const a = c[i], b = c[(i + 1) % 4];
    mesh.flat([a[0], a[1], z1], [b[0], b[1], z1], [cu, cv, z1 + spire], top);
  }
}

// Cylindrical drum (z0..z1) with an ellipsoid dome on top, or a cone when `cone`.
function drumAndDome(mesh: Mesh, cu: number, cv: number, r: number, z0: number, z1: number, domeH: number, drum: [number, number, number], dome: [number, number, number], cone: boolean): void {
  const SEG = 12;
  const ring = (rad: number, z: number, nz: number, col: [number, number, number], radial: number) => {
    const ids: number[] = [];
    for (let k = 0; k < SEG; k++) {
      const a = (k / SEG) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
      const nx = ca * radial, ny = sa * radial;
      const l = Math.hypot(nx, ny, nz) || 1;
      ids.push(mesh.vert(cu + ca * rad, cv + sa * rad, z, [nx / l, ny / l, nz / l], col));
    }
    return ids;
  };
  const band = (lo: number[], hi: number[]) => {
    for (let k = 0; k < SEG; k++) {
      const k2 = (k + 1) % SEG;
      mesh.idx(lo[k], lo[k2], hi[k2]);
      mesh.idx(lo[k], hi[k2], hi[k]);
    }
  };
  band(ring(r, z0, 0, drum, 1), ring(r, z1, 0, drum, 1));
  if (cone) {
    const base = ring(r * 1.05, z1, 0.5, dome, 1);
    const tip = mesh.vert(cu, cv, z1 + domeH, [0, 0, 1], dome);
    for (let k = 0; k < SEG; k++) mesh.idx(base[k], base[(k + 1) % SEG], tip);
    return;
  }
  const ROWS = 4;
  let prev = ring(r, z1, 0, dome, 1);
  for (let i = 1; i <= ROWS; i++) {
    const phi = (i / ROWS) * (Math.PI / 2);
    // ellipsoid normal: (cos phi / r, sin phi / domeH)
    const radial = Math.cos(phi) / r, up = Math.sin(phi) / domeH;
    if (i === ROWS) {
      const tip = mesh.vert(cu, cv, z1 + domeH, [0, 0, 1], dome);
      for (let k = 0; k < SEG; k++) mesh.idx(prev[k], prev[(k + 1) % SEG], tip);
    } else {
      const next = ring(r * Math.cos(phi), z1 + domeH * Math.sin(phi), up, dome, radial);
      band(prev, next);
      prev = next;
    }
  }
}

// Builds the model of a restored building. `height` is the eaves height of the main volume in metres.
export function buildHeritageModel(ringIn: readonly XY[], height: number, kind: string): HeritageModel {
  const family = modelFamily(kind);
  const pal = MODEL_COLORS[family];
  const wallC = rgb(pal.wall), roofC = rgb(pal.roof), accC = rgb(pal.accent);
  const h = clamp(Number.isFinite(height) ? height : 6, 2, 60);

  let ring = prepareRing(ringIn);
  const box = orientedBox(ring);
  // Box frame: u along the long axis. A ring already in that frame.
  const toUV = (p: XY): XY => [(p[0] - box.cx) * box.ux + (p[1] - box.cy) * box.uy, -(p[0] - box.cx) * box.uy + (p[1] - box.cy) * box.ux];
  let uv = ring.map(toUV);
  let tris = triangulate(uv);
  if (!tris) {
    ring = boxRing(box);
    uv = ring.map(toUV);
    tris = triangulate(uv)!;
  }
  const hl = Math.max(box.len, MIN_SIDE) / 2, hw = Math.max(box.wid, MIN_SIDE) / 2;
  const wid = hw * 2, len = hl * 2;
  const mesh = new Mesh(box);

  // Interior point for towers and domes: the box centre if it is inside the ring, else the ring centroid.
  const spot = (): [number, number] | null => {
    if (pointInRing(0, 0, uv)) return [0, 0];
    const cx = uv.reduce((s, p) => s + p[0], 0) / uv.length, cy = uv.reduce((s, p) => s + p[1], 0) / uv.length;
    return pointInRing(cx, cy, uv) ? [cx, cy] : null;
  };

  let roof: Roof;
  let parapet = 0;
  switch (family) {
    case "flat":
      roof = FLAT;
      parapet = 0.6;
      break;
    case "hip":
      roof = hipRoof(hl, hw, clamp(wid * 0.25, 1, 5));
      break;
    case "worship":
      roof = gableRoof(hw, clamp(wid * 0.28, 1.2, 4.5));
      break;
    case "tower":
      roof = kind === "castle" ? FLAT : hipRoof(hl, hw, clamp(wid * 0.22, 1, 4));
      parapet = kind === "castle" ? 0.9 : 0;
      break;
    default:
      roof = gableRoof(hw, clamp(wid * 0.34, 1.2, 5.5));
  }
  walls(mesh, uv, h, roof, wallC, parapet);
  roofSurface(mesh, tris, h, roof, roofC);

  const ridge = h + roof.rise(0, 0);
  const at = spot();
  if (family === "worship" && at) {
    // Drum and dome (tent when small) over the main volume, shifted towards one end of a long church; a slim bell tower
    // at the other, narrow end when the ring is long enough.
    const shift = len / wid > 1.8 ? len * 0.15 : 0;
    const du = pointInRing(at[0] + shift, at[1], uv) ? shift : 0;
    const r = clamp(wid * 0.26, 1.1, 4.5);
    const drumH = clamp(r * 0.9, 1, 3.5);
    drumAndDome(mesh, at[0] + du, at[1], r, h, ridge + drumH, r * (r >= 1.8 ? 1.2 : 2.2), wallC, accC, r < 1.8);
    if (len >= 14 && wid >= 5) {
      const side = clamp(wid * 0.28, 2, 3.2);
      const tu = -hl + side / 2 + 0.3;
      if (pointInRing(tu, 0, uv) && pointInRing(tu - side / 2, 0, uv) && pointInRing(tu + side / 2, 0, uv)) {
        const top = ridge + clamp(len * 0.35, 5, 14);
        tower(mesh, tu, 0, side, 0, top, side * 1.6, wallC, accC);
      }
    }
  } else if (family === "tower" && at) {
    if (kind === "monument") {
      const side = clamp(wid * 0.6, 1.5, 8);
      tower(mesh, at[0], at[1], side, h, h + clamp(h * 0.3, 1, 6), side * 1.3, wallC, accC);
    } else {
      const side = clamp(wid * 0.4, 2.4, 7);
      tower(mesh, at[0], at[1], side, h, h + clamp(wid * 0.8, 4, 12), side * 1.5, wallC, accC);
    }
  }
  return mesh.m;
}

// Walls only, as high as `height` allows at the given progress: the pale scaffold look of a building under construction.
export function buildScaffold(ringIn: readonly XY[], height: number, progress: number): HeritageModel {
  const ring = prepareRing(ringIn);
  const box = orientedBox(ring);
  const uv = ring.map((p): XY => [(p[0] - box.cx) * box.ux + (p[1] - box.cy) * box.uy, -(p[0] - box.cx) * box.uy + (p[1] - box.cy) * box.ux]);
  const mesh = new Mesh(box);
  const pal = MODEL_COLORS.scaffold;
  const h = Math.max(0.5, clamp(Number.isFinite(height) ? height : 6, 2, 60) * clamp(progress, 0, 1));
  walls(mesh, uv, h, FLAT, rgb(pal.wall));
  const tris = triangulate(uv);
  if (tris) roofSurface(mesh, tris, h, FLAT, rgb(pal.roof));
  return mesh.m;
}
