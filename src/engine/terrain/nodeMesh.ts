import { geodeticToEcef, type Vec3 } from "../geo/ellipsoid";
import { mxToLng, myToLat } from "../geo/mercator";

// One shared grid mesh for every terrain node, plus per-node vertex positions computed on the CPU in f64.
//
// Why per-node positions and not lat/lng -> ECEF in the vertex shader: f32 trig on absolute angles gives ECEF with
// ~0.5 m error (ulp of 6.4e6 m), and subtracting the node origin afterwards cannot recover it. A Taylor patch around
// the origin works for small nodes but not for z0-z5 nodes that span continents. Precomputing f32 offsets from the
// node origin in f64 is exact at every level and costs ~35 KB per node, generated once when the node first appears.

export const GRID = 33; // vertices per node edge: 32 x 32 quads
export const GRID_VERTS = GRID * GRID;
export const SKIRT_VERTS = 4 * GRID; // drawn from the border vertices, dropped by the node's skirt depth
export const NODE_VERTS = GRID_VERTS + SKIRT_VERTS;
export const FLOATS_PER_VERTEX = 8; // vec4 position (xyz, w unused) + vec4 geodetic up (xyz)
export const NODE_FLOATS = GRID_VERTS * FLOATS_PER_VERTEX;

// Tile-centre point on the ellipsoid: the node's f64 origin.
export function nodeOrigin(z: number, x: number, y: number): Vec3 {
  const n = 2 ** z;
  return geodeticToEcef(myToLat((y + 0.5) / n), mxToLng((x + 0.5) / n), 0);
}

// Positions relative to the origin (f32) and geodetic up vectors of the grid vertices, written at `at` (floats).
export function buildNodeVertices(z: number, x: number, y: number, origin: Readonly<Vec3>, out: Float32Array, at = 0): void {
  const n = 2 ** z;
  const p: Vec3 = [0, 0, 0];
  const RAD = Math.PI / 180;
  for (let j = 0; j < GRID; j++) {
    const lat = myToLat((y + j / (GRID - 1)) / n);
    const phi = lat * RAD;
    const cp = Math.cos(phi);
    const sp = Math.sin(phi);
    for (let i = 0; i < GRID; i++) {
      const lng = mxToLng((x + i / (GRID - 1)) / n);
      geodeticToEcef(lat, lng, 0, p);
      const lam = lng * RAD;
      const o = at + (j * GRID + i) * FLOATS_PER_VERTEX;
      out[o] = p[0] - origin[0];
      out[o + 1] = p[1] - origin[1];
      out[o + 2] = p[2] - origin[2];
      out[o + 3] = 0;
      out[o + 4] = cp * Math.cos(lam);
      out[o + 5] = cp * Math.sin(lam);
      out[o + 6] = sp;
      out[o + 7] = 0;
    }
  }
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

export function buildIndices(): Uint32Array<ArrayBuffer> {
  const quads = (GRID - 1) * (GRID - 1);
  const skirtQuads = 4 * (GRID - 1);
  const idx = new Uint32Array((quads + skirtQuads) * 6);
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
