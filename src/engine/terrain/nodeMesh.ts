import { geodeticToEcef, WGS84_A, WGS84_B, WGS84_E2, type Vec3 } from "../geo/ellipsoid";
import { mxToLng, myToLat } from "../geo/mercator";

// One shared grid mesh for every terrain node, plus per-node vertex positions computed on the CPU in f64.
//
// Why per-node positions and not lat/lng -> ECEF in the vertex shader: f32 trig on absolute angles gives ECEF with
// ~0.5 m error (ulp of 6.4e6 m), and subtracting the node origin afterwards cannot recover it. A Taylor patch around
// the origin works for small nodes but not for z0-z5 nodes that span continents. Precomputing f32 offsets from the
// node origin in f64 is exact at every level and costs ~35 KB per node, generated once when the node first appears.
//
// The origin sits at the node's centre lifted to a base height `hb` (the middle of its height range), and every vertex
// is stored at that same height: position = origin + local + up * (h - hb). Near the eye both `origin - eye` and
// `h - hb` are then small, so f32 rounding stays sub-millimetre on a 4 km summit as at sea level.

export const GRID = 33; // vertices per node edge: 32 x 32 quads
export const GRID_VERTS = GRID * GRID;
export const SKIRT_VERTS = 4 * GRID; // drawn from the border vertices, dropped by the node's skirt depth
export const NODE_VERTS = GRID_VERTS + SKIRT_VERTS;
export const FLOATS_PER_VERTEX = 8; // vec4 position (xyz, w unused) + vec4 geodetic up (xyz)
export const NODE_FLOATS = GRID_VERTS * FLOATS_PER_VERTEX;

const RAD = Math.PI / 180;

// Tile-centre point at height h above the ellipsoid: the node's f64 origin.
export function nodeOrigin(z: number, x: number, y: number, h = 0, out: Vec3 = [0, 0, 0]): Vec3 {
  const n = 2 ** z;
  return geodeticToEcef(myToLat((y + 0.5) / n), mxToLng((x + 0.5) / n), h, out);
}

const rowSin = new Float64Array(GRID);
const rowCos = new Float64Array(GRID);
const rowN = new Float64Array(GRID);
const colSin = new Float64Array(GRID);
const colCos = new Float64Array(GRID);

// Positions relative to the origin (f32, at base height hb) and geodetic up vectors of the grid vertices, written at
// `at` (floats). Separable: 33 latitudes and 33 longitudes worth of trig per node, not 1089 (same formula and order as
// geodeticToEcef, so the result is bit-identical to calling it per vertex).
export function buildNodeVertices(z: number, x: number, y: number, origin: Readonly<Vec3>, out: Float32Array, at = 0, hb = 0): void {
  const n = 2 ** z;
  for (let k = 0; k < GRID; k++) {
    const phi = myToLat((y + k / (GRID - 1)) / n) * RAD;
    const s = Math.sin(phi);
    rowSin[k] = s;
    rowCos[k] = Math.cos(phi);
    rowN[k] = WGS84_A / Math.sqrt(1 - WGS84_E2 * s * s);
    const lam = mxToLng((x + k / (GRID - 1)) / n) * RAD;
    colSin[k] = Math.sin(lam);
    colCos[k] = Math.cos(lam);
  }
  const [ox, oy, oz] = origin;
  for (let j = 0; j < GRID; j++) {
    const sp = rowSin[j];
    const cp = rowCos[j];
    const nh = rowN[j] + hb;
    const zz = (rowN[j] * (1 - WGS84_E2) + hb) * sp - oz;
    for (let i = 0; i < GRID; i++) {
      const cl = colCos[i];
      const sl = colSin[i];
      const o = at + (j * GRID + i) * FLOATS_PER_VERTEX;
      out[o] = nh * cp * cl - ox;
      out[o + 1] = nh * cp * sl - oy;
      out[o + 2] = zz;
      out[o + 3] = 0;
      out[o + 4] = cp * cl;
      out[o + 5] = cp * sl;
      out[o + 6] = sp;
      out[o + 7] = 0;
    }
  }
}

// Polar caps. The mercator quadtree ends at +-85.05 deg; nodes on its top (bottom) row turn their north (south) skirt
// into a fan from the edge row to an apex at the pole, which closes the hole instead of letting the sky pass show
// through. Every cap node uses the same apex height (the mean ground along the edge, terrain.ts), so neighbouring fans meet.
// Flags: bit 0 north edge (y = 0), bit 1 south edge (y = 2^z - 1).
export const CAP_NORTH = 1;
export const CAP_SOUTH = 2;

export function capFlags(z: number, y: number): number {
  return (y === 0 ? CAP_NORTH : 0) | (y === 2 ** z - 1 ? CAP_SOUTH : 0);
}

// The cap apex, the pole at height h, relative to the node origin (f64 difference, then f32 in the chunk table).
export function poleLocal(north: boolean, origin: Readonly<Vec3>, h: number, out: Vec3 = [0, 0, 0]): Vec3 {
  const z = (WGS84_B + h) * (north ? 1 : -1);
  out[0] = -origin[0];
  out[1] = -origin[1];
  out[2] = z - origin[2];
  return out;
}

// Grid vertex index of skirt vertex k (edges: 0 top j=0, 1 right i=N-1, 2 bottom j=N-1, 3 left i=0). The vertex
// shader repeats this mapping.
export function skirtSource(k: number): number {
  const e = Math.floor(k / GRID);
  const t = k % GRID;
  if (e === 0) return t;
  if (e === 1) return t * GRID + GRID - 1;
  if (e === 2) return (GRID - 1) * GRID + t;
  return t * GRID;
}

// 16-bit: a node has 1221 vertices, and a view draws some millions of indices a frame.
export function buildIndices(): Uint16Array<ArrayBuffer> {
  const quads = (GRID - 1) * (GRID - 1);
  const skirtQuads = 4 * (GRID - 1);
  const idx = new Uint16Array((quads + skirtQuads) * 6);
  let o = 0;
  for (let j = 0; j < GRID - 1; j++)
    for (let i = 0; i < GRID - 1; i++) {
      const a = j * GRID + i;
      const b = a + 1;
      const c = a + GRID;
      const d = c + 1;
      idx.set([a, c, b, b, c, d], o);
      o += 6;
    }
  for (let e = 0; e < 4; e++)
    for (let t = 0; t < GRID - 1; t++) {
      const k = e * GRID + t;
      const g0 = skirtSource(k);
      const g1 = skirtSource(k + 1);
      const s0 = GRID_VERTS + k;
      const s1 = s0 + 1;
      idx.set([g0, s0, g1, g1, s0, s1], o);
      o += 6;
    }
  return idx;
}
