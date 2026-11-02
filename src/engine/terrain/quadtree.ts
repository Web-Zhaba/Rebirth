import { geodeticToEcef, WGS84_A, WGS84_E2, type Vec3 } from "../geo/ellipsoid";
import { lngToMx, latToMy, mxToLng, myToLat, tileKey, tileWidthMeters } from "../geo/mercator";
import { GRID, nodeOrigin } from "./nodeMesh";

// Globe quadtree over web-mercator tiles, selected by screen-space error. A node's geometric error is its grid cell
// size, so "refine while a cell covers more than `tau` pixels" keeps triangles about the same size on screen from
// orbit to street level. Pure logic: the height ranges come in through `HeightRanges`, so this runs in vitest.
//
// Level changes do not pop: vertices geomorph towards the parent grid (morph.ts, whose band depends on MERGE), and
// skirts stay as a safety net for what the morph bounds do not cover.
//
// Per frame the walk does no trig and no allocation for nodes it has seen before: edges' sin/cos, sample radii and
// bounds are cached on the node, bounds are recomputed only when the height page behind them changes.

export const MAX_ZOOM = 17; // beyond the z11 DEM the grid only refines the bilinear surface; z17 cells are ~5-10 m
export const DEFAULT_TAU = 8; // px per grid cell
export const MERGE = 0.9; // hysteresis: a split node merges only when its error falls below tau * MERGE
const SAMPLES = 5; // per edge, for bounds and the horizon test
const UNKNOWN_RANGE: [number, number] = [-500, 9000 * 1.6];
const EQUATOR_R = 6378137;
const HORIZON_SLACK = 25_000; // m the horizon sphere is shrunk by, so the ellipsoid's flattening never over-culls
const RAD = Math.PI / 180;

export interface HeightRange {
  min: number; // m, as drawn (exaggerated)
  max: number;
  z: number; // zoom of the page the range came from
}

export interface HeightRanges {
  range(z: number, x: number, y: number): HeightRange | null;
  // Identity of the page `range` would read (-1: none). When given, bounds are refreshed only when it changes.
  source?(z: number, x: number, y: number): number;
  // Bumped whenever any range may have changed (a page arrived or left). When given and unchanged, nothing is re-read.
  version?(): number;
}

export interface NodeInfo {
  key: number;
  z: number;
  x: number;
  y: number;
  origin: Vec3; // f64 ECEF, tile centre on the ellipsoid
  cell: number; // geometric error: widest grid cell (m)
  samples: Float64Array; // SAMPLES^2 surface points (ECEF)
  ups: Float64Array; // their geodetic up vectors
  radii: Float64Array; // |sample| - HORIZON_SLACK, for the horizon test
  edges: Float64Array; // sin/cos of the north and south latitudes, west and east longitudes
  rangeZ: number; // zoom of the height range the bounds use, -1 = unknown
  rangeSource: number; // `HeightRanges.source` the bounds came from, NaN = not yet
  rangeVersion: number; // `HeightRanges.version` at the last refresh
  hmin: number;
  hmax: number;
  sse: number; // screen-space error at the last selection that reached it (px per cell)
  kids: (NodeInfo | null)[] | null; // NodeCache.child links
  slot: number; // renderer's vertex slot hint (terrain.ts checks it is still this node's), -1 = none
  parent: NodeInfo | null;
  center: Vec3; // bounding sphere
  radius: number;
  lastUsed: number;
}

export interface SelectView {
  eye: Vec3;
  eyeLat: number;
  eyeLng: number;
  eyeAlt: number;
  right: Vec3;
  up: Vec3;
  forward: Vec3;
  near: number;
  tanHalfY: number;
  aspect: number;
  viewportH: number; // px
}

export interface SelectOptions {
  tau: number;
  maxZoom: number;
  maxNodes: number;
}

export interface Selection {
  nodes: NodeInfo[];
  split: Set<number>; // nodes refined this frame, feeds next frame's hysteresis
  visited: number;
}

export class NodeCache {
  private map = new Map<number, NodeInfo>();
  frame = 0;

  get(z: number, x: number, y: number): NodeInfo {
    const key = tileKey(z, x, y);
    let n = this.map.get(key);
    if (!n) {
      n = makeNode(key, z, x, y);
      this.map.set(key, n);
    }
    n.lastUsed = this.frame;
    return n;
  }

  // Child i (0..3: NW, NE, SW, SE) through the node's own links: no hashing in the per-frame walk.
  child(node: NodeInfo, i: number): NodeInfo {
    const kids = (node.kids ??= [null, null, null, null]);
    let c = kids[i];
    if (!c) {
      c = this.get(node.z + 1, node.x * 2 + (i & 1), node.y * 2 + (i >> 1));
      c.parent = node;
      kids[i] = c;
    }
    c.lastUsed = this.frame;
    return c;
  }

  // Drop nodes not visited for a while so a long flight does not grow the cache without bound. A child is never
  // visited without its parent, so whole subtrees go together; a kept parent just forgets the link.
  sweep(maxAge = 600): void {
    for (const [k, n] of this.map)
      if (this.frame - n.lastUsed > maxAge) {
        this.map.delete(k);
        const p = n.parent;
        if (p?.kids) p.kids[(n.x & 1) + (n.y & 1) * 2] = null;
        n.parent = null;
      }
  }

  get size(): number {
    return this.map.size;
  }
}

function makeNode(key: number, z: number, x: number, y: number): NodeInfo {
  const n = 2 ** z;
  const samples = new Float64Array(SAMPLES * SAMPLES * 3);
  const ups = new Float64Array(SAMPLES * SAMPLES * 3);
  const radii = new Float64Array(SAMPLES * SAMPLES);
  const p: Vec3 = [0, 0, 0];
  for (let j = 0; j < SAMPLES; j++) {
    const lat = myToLat((y + j / (SAMPLES - 1)) / n);
    for (let i = 0; i < SAMPLES; i++) {
      const lng = mxToLng((x + i / (SAMPLES - 1)) / n);
      geodeticToEcef(lat, lng, 0, p);
      const k = j * SAMPLES + i;
      samples.set(p, k * 3);
      radii[k] = Math.sqrt(p[0] * p[0] + p[1] * p[1] + p[2] * p[2]) - HORIZON_SLACK;
      const phi = lat * RAD;
      const lam = lng * RAD;
      ups[k * 3] = Math.cos(phi) * Math.cos(lam);
      ups[k * 3 + 1] = Math.cos(phi) * Math.sin(lam);
      ups[k * 3 + 2] = Math.sin(phi);
    }
  }
  const latN = myToLat(y / n);
  const latS = myToLat((y + 1) / n);
  const lngW = mxToLng(x / n);
  const lngE = mxToLng((x + 1) / n);
  const edges = new Float64Array([
    Math.sin(latN * RAD),
    Math.cos(latN * RAD),
    Math.sin(latS * RAD),
    Math.cos(latS * RAD),
    Math.sin(lngW * RAD),
    Math.cos(lngW * RAD),
    Math.sin(lngE * RAD),
    Math.cos(lngE * RAD),
  ]);
  // Widest cell: the edge nearest the equator.
  const nearEq = latN > 0 && latS < 0 ? 0 : Math.min(Math.abs(latN), Math.abs(latS));
  const cell = tileWidthMeters(z, nearEq) / (GRID - 1);
  const node: NodeInfo = {
    key,
    z,
    x,
    y,
    origin: nodeOrigin(z, x, y),
    cell,
    samples,
    ups,
    radii,
    edges,
    rangeZ: -2,
    rangeSource: NaN,
    rangeVersion: NaN,
    hmin: 0,
    hmax: 0,
    sse: 0,
    kids: null,
    slot: -1,
    parent: null,
    center: [0, 0, 0],
    radius: 0,
    lastUsed: 0,
  };
  setBounds(node, UNKNOWN_RANGE[0], UNKNOWN_RANGE[1], -1);
  return node;
}

function setBounds(node: NodeInfo, hmin: number, hmax: number, rangeZ: number): void {
  node.hmin = hmin;
  node.hmax = hmax;
  node.rangeZ = rangeZ;
  const s = node.samples;
  const u = node.ups;
  const c = node.center;
  c[0] = c[1] = c[2] = 0;
  const count = SAMPLES * SAMPLES;
  const hm = (hmin + hmax) / 2;
  for (let k = 0; k < count; k++) for (let a = 0; a < 3; a++) c[a] += (s[k * 3 + a] + u[k * 3 + a] * hm) / count;
  let r2 = 0;
  for (let k = 0; k < count; k++)
    for (let e = 0; e < 2; e++) {
      const h = e ? hmax : hmin;
      const dx = s[k * 3] + u[k * 3] * h - c[0];
      const dy = s[k * 3 + 1] + u[k * 3 + 1] * h - c[1];
      const dz = s[k * 3 + 2] + u[k * 3 + 2] * h - c[2];
      r2 = Math.max(r2, dx * dx + dy * dy + dz * dz);
    }
  // The surface bulges between samples; add the sagitta of one sample spacing.
  const spacing = (node.cell * (GRID - 1)) / (SAMPLES - 1);
  node.radius = Math.sqrt(r2) + (spacing * spacing) / (8 * EQUATOR_R) + 1;
}

function refreshBounds(node: NodeInfo, heights: HeightRanges, version: number): void {
  if (version === node.rangeVersion) return;
  node.rangeVersion = version;
  if (heights.source) {
    const src = heights.source(node.z, node.x, node.y);
    if (src === node.rangeSource) return;
    node.rangeSource = src;
  }
  const r = heights.range(node.z, node.x, node.y);
  if (!r) {
    if (node.rangeZ !== -1) setBounds(node, UNKNOWN_RANGE[0], UNKNOWN_RANGE[1], -1);
  } else if (r.z !== node.rangeZ || r.min !== node.hmin || r.max !== node.hmax) setBounds(node, r.min, r.max, r.z);
}

// The eye in the forms the per-node tests need, computed once per frame.
export interface EyeCache {
  mx: number; // mercator 0..1
  my: number;
  sinLat: number;
  cosLat: number;
  sinLng: number;
  cosLng: number;
}

export function eyeCache(v: SelectView): EyeCache {
  return {
    mx: lngToMx(v.eyeLng),
    my: latToMy(v.eyeLat),
    sinLat: Math.sin(v.eyeLat * RAD),
    cosLat: Math.cos(v.eyeLat * RAD),
    sinLng: Math.sin(v.eyeLng * RAD),
    cosLng: Math.cos(v.eyeLng * RAD),
  };
}

// Distance from the eye to the node's nearest point: clamp the eye into the tile in mercator space, lift to the
// eye's altitude within the node's height range. Exact enough for LOD, cheap (the clamped point's latitude and
// longitude are either the eye's or a tile edge's, all with cached sin/cos), and correct across the antimeridian.
export function nodeDistance(node: NodeInfo, v: SelectView, e: EyeCache = eyeCache(v)): number {
  const n = 2 ** node.z;
  let ex = e.mx * n;
  const cx = node.x + 0.5;
  if (ex - cx > n / 2) ex -= n;
  if (cx - ex > n / 2) ex += n;
  const ey = e.my * n;
  const g = node.edges;
  let sp: number, cp: number, sl: number, cl: number;
  if (ey <= node.y) (sp = g[0]), (cp = g[1]);
  else if (ey >= node.y + 1) (sp = g[2]), (cp = g[3]);
  else (sp = e.sinLat), (cp = e.cosLat);
  if (ex <= node.x) (sl = g[4]), (cl = g[5]);
  else if (ex >= node.x + 1) (sl = g[6]), (cl = g[7]);
  else (sl = e.sinLng), (cl = e.cosLng);
  const h = Math.max(node.hmin, Math.min(node.hmax, v.eyeAlt));
  const nn = WGS84_A / Math.sqrt(1 - WGS84_E2 * sp * sp);
  const dx = (nn + h) * cp * cl - v.eye[0];
  const dy = (nn + h) * cp * sl - v.eye[1];
  const dz = (nn * (1 - WGS84_E2) + h) * sp - v.eye[2];
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

// Projection scale: px per (metre at one metre's distance).
export function projScale(v: SelectView): number {
  return v.viewportH / (2 * v.tanHalfY);
}

export function screenSpaceError(node: NodeInfo, v: SelectView, e?: EyeCache): number {
  const d = Math.max(nodeDistance(node, v, e), v.near);
  return (node.cell / d) * projScale(v);
}

export function inFrustum(node: NodeInfo, v: SelectView, sx = Math.sqrt(1 + (v.tanHalfY * v.aspect) ** 2), sy = Math.sqrt(1 + v.tanHalfY ** 2)): boolean {
  const cx = node.center[0] - v.eye[0];
  const cy = node.center[1] - v.eye[1];
  const cz = node.center[2] - v.eye[2];
  const r = node.radius;
  const f = v.forward;
  const z = cx * f[0] + cy * f[1] + cz * f[2];
  if (z + r < v.near) return false;
  const tx = v.tanHalfY * v.aspect;
  const ty = v.tanHalfY;
  // Side planes through the eye: n = (1, -tan) / sqrt(1 + tan^2) in (x, z).
  const x = cx * v.right[0] + cy * v.right[1] + cz * v.right[2];
  const y = cx * v.up[0] + cy * v.up[1] + cz * v.up[2];
  if (Math.abs(x) - z * tx > r * sx) return false;
  if (Math.abs(y) - z * ty > r * sy) return false;
  return true;
}

// Hidden behind the planet if no sample (lifted to the node's max height) has a clear line to the eye. The earth is
// treated as a sphere through each sample, shrunk a little so the ellipsoid's flattening never over-culls.
export function aboveHorizon(node: NodeInfo, v: SelectView): boolean {
  if (node.z < 3) return true;
  const s = node.samples;
  const u = node.ups;
  const rad = node.radii;
  const e = v.eye;
  const ee = e[0] * e[0] + e[1] * e[1] + e[2] * e[2];
  const hm = node.hmax;
  for (let k = 0; k < SAMPLES * SAMPLES; k++) {
    const dx = s[k * 3] + u[k * 3] * hm - e[0];
    const dy = s[k * 3 + 1] + u[k * 3 + 1] * hm - e[1];
    const dz = s[k * 3 + 2] + u[k * 3 + 2] * hm - e[2];
    const dd = dx * dx + dy * dy + dz * dz;
    const ed = e[0] * dx + e[1] * dy + e[2] * dz;
    const t = -ed / dd;
    if (t <= 0 || t >= 1) return true; // closest approach outside the segment: the planet cannot be in between
    const closest = ee + 2 * t * ed + t * t * dd;
    if (closest > rad[k] * rad[k]) return true;
  }
  return false;
}

// `split` is cleared and refilled (pass last frame's other set to avoid allocating); `prevSplit` must be a different set.
export function selectNodes(v: SelectView, cache: NodeCache, heights: HeightRanges, prevSplit: ReadonlySet<number>, opt: SelectOptions, split = new Set<number>(), nodes: NodeInfo[] = []): Selection {
  split.clear();
  nodes.length = 0;
  const e = eyeCache(v);
  const k = projScale(v);
  const near = v.near;
  const version = heights.version ? heights.version() : NaN;
  const sx = Math.sqrt(1 + (v.tanHalfY * v.aspect) ** 2);
  const sy = Math.sqrt(1 + v.tanHalfY ** 2);
  let visited = 0;
  const visit = (node: NodeInfo) => {
    visited++;
    refreshBounds(node, heights, version);
    if (!inFrustum(node, v, sx, sy) || !aboveHorizon(node, v)) return;
    const sse = (node.cell / Math.max(nodeDistance(node, v, e), near)) * k;
    node.sse = sse;
    const limit = prevSplit.has(node.key) ? opt.tau * MERGE : opt.tau;
    if (node.z < opt.maxZoom && sse > limit && nodes.length < opt.maxNodes) {
      split.add(node.key);
      for (let i = 0; i < 4; i++) visit(cache.child(node, i));
    } else nodes.push(node);
  };
  visit(cache.get(0, 0, 0));
  return { nodes, split, visited };
}
