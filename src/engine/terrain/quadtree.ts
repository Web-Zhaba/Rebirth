import { dot, geodeticToEcef, type Vec3 } from "../geo/ellipsoid";
import { lngToMx, latToMy, mxToLng, myToLat, tileKey, tileWidthMeters } from "../geo/mercator";
import { GRID, nodeOrigin } from "./nodeMesh";

// Globe quadtree over web-mercator tiles, selected by screen-space error. A node's geometric error is its grid cell
// size, so "refine while a cell covers more than `tau` pixels" keeps triangles about the same size on screen from
// orbit to street level. Pure logic: the height ranges come in through `HeightRanges`, so this runs in vitest.
//
// No CDLOD morphing yet (a later milestone): a level change pops, and cracks between levels are hidden by skirts.

export const MAX_ZOOM = 17; // beyond the z11 DEM the grid only refines the bilinear surface; z17 cells are ~5-10 m
export const DEFAULT_TAU = 8; // px per grid cell
const MERGE = 0.75; // hysteresis: a split node merges only when its error falls below tau * MERGE
const SAMPLES = 5; // per edge, for bounds and the horizon test
const UNKNOWN_RANGE: [number, number] = [-500, 9000 * 1.6];
const EQUATOR_R = 6378137;

export interface HeightRange {
  min: number; // m, as drawn (exaggerated)
  max: number;
  z: number; // zoom of the page the range came from
}

export interface HeightRanges {
  range(z: number, x: number, y: number): HeightRange | null;
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
  rangeZ: number; // zoom of the height range the bounds use, -1 = unknown
  hmin: number;
  hmax: number;
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

  // Drop nodes not visited for a while so a long flight does not grow the cache without bound.
  sweep(maxAge = 600): void {
    for (const [k, n] of this.map) if (this.frame - n.lastUsed > maxAge) this.map.delete(k);
  }

  get size(): number {
    return this.map.size;
  }
}

function makeNode(key: number, z: number, x: number, y: number): NodeInfo {
  const n = 2 ** z;
  const samples = new Float64Array(SAMPLES * SAMPLES * 3);
  const ups = new Float64Array(SAMPLES * SAMPLES * 3);
  const p: Vec3 = [0, 0, 0];
  for (let j = 0; j < SAMPLES; j++) {
    const lat = myToLat((y + j / (SAMPLES - 1)) / n);
    for (let i = 0; i < SAMPLES; i++) {
      const lng = mxToLng((x + i / (SAMPLES - 1)) / n);
      geodeticToEcef(lat, lng, 0, p);
      const o = (j * SAMPLES + i) * 3;
      samples.set(p, o);
      const phi = (lat * Math.PI) / 180;
      const lam = (lng * Math.PI) / 180;
      ups[o] = Math.cos(phi) * Math.cos(lam);
      ups[o + 1] = Math.cos(phi) * Math.sin(lam);
      ups[o + 2] = Math.sin(phi);
    }
  }
  // Widest cell: the edge nearest the equator.
  const latN = myToLat(y / n);
  const latS = myToLat((y + 1) / n);
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
    rangeZ: -2,
    hmin: 0,
    hmax: 0,
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
  const c: Vec3 = [0, 0, 0];
  const count = SAMPLES * SAMPLES;
  const hm = (hmin + hmax) / 2;
  for (let k = 0; k < count; k++) for (let a = 0; a < 3; a++) c[a] += (s[k * 3 + a] + u[k * 3 + a] * hm) / count;
  let r = 0;
  for (let k = 0; k < count; k++)
    for (const h of [hmin, hmax]) {
      const dx = s[k * 3] + u[k * 3] * h - c[0];
      const dy = s[k * 3 + 1] + u[k * 3 + 1] * h - c[1];
      const dz = s[k * 3 + 2] + u[k * 3 + 2] * h - c[2];
      r = Math.max(r, Math.hypot(dx, dy, dz));
    }
  // The surface bulges between samples; add the sagitta of one sample spacing.
  const spacing = (node.cell * (GRID - 1)) / (SAMPLES - 1);
  node.center = c;
  node.radius = r + (spacing * spacing) / (8 * EQUATOR_R) + 1;
}

function refreshBounds(node: NodeInfo, heights: HeightRanges): void {
  const r = heights.range(node.z, node.x, node.y);
  if (!r) {
    if (node.rangeZ !== -1) setBounds(node, UNKNOWN_RANGE[0], UNKNOWN_RANGE[1], -1);
  } else if (r.z !== node.rangeZ) setBounds(node, r.min, r.max, r.z);
}

// Distance from the eye to the node's nearest point: clamp the eye into the tile in mercator space, lift to the
// eye's altitude within the node's height range. Exact enough for LOD, cheap, and correct across the antimeridian.
export function nodeDistance(node: NodeInfo, v: SelectView): number {
  const n = 2 ** node.z;
  let ex = lngToMx(v.eyeLng) * n;
  const cx = node.x + 0.5;
  if (ex - cx > n / 2) ex -= n;
  if (cx - ex > n / 2) ex += n;
  const ey = latToMy(v.eyeLat) * n;
  const mx = Math.max(node.x, Math.min(node.x + 1, ex));
  const my = Math.max(node.y, Math.min(node.y + 1, ey));
  const h = Math.max(node.hmin, Math.min(node.hmax, v.eyeAlt));
  const p = geodeticToEcef(myToLat(my / n), mxToLng(mx / n), h);
  return Math.hypot(p[0] - v.eye[0], p[1] - v.eye[1], p[2] - v.eye[2]);
}

export function screenSpaceError(node: NodeInfo, v: SelectView): number {
  const d = Math.max(nodeDistance(node, v), v.near);
  return (node.cell / d) * (v.viewportH / (2 * v.tanHalfY));
}

export function inFrustum(node: NodeInfo, v: SelectView): boolean {
  const c: Vec3 = [node.center[0] - v.eye[0], node.center[1] - v.eye[1], node.center[2] - v.eye[2]];
  const r = node.radius;
  const z = dot(c, v.forward);
  if (z + r < v.near) return false;
  const tx = v.tanHalfY * v.aspect;
  const ty = v.tanHalfY;
  // Side planes through the eye: n = (1, -tan) / sqrt(1 + tan^2) in (x, z).
  const x = dot(c, v.right);
  const y = dot(c, v.up);
  const sx = Math.sqrt(1 + tx * tx);
  const sy = Math.sqrt(1 + ty * ty);
  if ((Math.abs(x) - z * tx) / sx > r) return false;
  if ((Math.abs(y) - z * ty) / sy > r) return false;
  return true;
}

// Hidden behind the planet if no sample (lifted to the node's max height) has a clear line to the eye. The earth is
// treated as a sphere through each sample, shrunk a little so the ellipsoid's flattening never over-culls.
export function aboveHorizon(node: NodeInfo, v: SelectView): boolean {
  if (node.z < 3) return true;
  const s = node.samples;
  const u = node.ups;
  const e = v.eye;
  const ee = e[0] * e[0] + e[1] * e[1] + e[2] * e[2];
  for (let k = 0; k < SAMPLES * SAMPLES; k++) {
    const qx = s[k * 3] + u[k * 3] * node.hmax;
    const qy = s[k * 3 + 1] + u[k * 3 + 1] * node.hmax;
    const qz = s[k * 3 + 2] + u[k * 3 + 2] * node.hmax;
    const rs = Math.hypot(s[k * 3], s[k * 3 + 1], s[k * 3 + 2]) - 25_000;
    const dx = qx - e[0];
    const dy = qy - e[1];
    const dz = qz - e[2];
    const dd = dx * dx + dy * dy + dz * dz;
    const t = -(e[0] * dx + e[1] * dy + e[2] * dz) / dd;
    if (t <= 0 || t >= 1) return true; // closest approach outside the segment: the planet cannot be in between
    const closest = ee + 2 * t * (e[0] * dx + e[1] * dy + e[2] * dz) + t * t * dd;
    if (closest > rs * rs) return true;
  }
  return false;
}

export function selectNodes(v: SelectView, cache: NodeCache, heights: HeightRanges, prevSplit: ReadonlySet<number>, opt: SelectOptions): Selection {
  const nodes: NodeInfo[] = [];
  const split = new Set<number>();
  let visited = 0;
  const visit = (z: number, x: number, y: number) => {
    visited++;
    const node = cache.get(z, x, y);
    refreshBounds(node, heights);
    if (!inFrustum(node, v) || !aboveHorizon(node, v)) return;
    const sse = screenSpaceError(node, v);
    const limit = prevSplit.has(node.key) ? opt.tau * MERGE : opt.tau;
    if (z < opt.maxZoom && sse > limit && nodes.length < opt.maxNodes) {
      split.add(node.key);
      for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) visit(z + 1, x * 2 + i, y * 2 + j);
    } else nodes.push(node);
  };
  visit(0, 0, 0);
  return { nodes, split, visited };
}
