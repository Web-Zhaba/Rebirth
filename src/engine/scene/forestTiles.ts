import { enuAt, geodeticToEcef, type Vec3 } from "../geo/ellipsoid";
import { tileToLngLat } from "../geo/mercator";

// Which tiles the GPU tree scatter (scene/forest.ts) runs over this frame and how thinly.
// Candidates sit on a jittered grid in web-mercator tiles of SCATTER_ZOOM, so a tree keeps its place wherever the camera
// goes; far tiles run only every 2nd or 4th row and column (nested subsets: thinning drops trees, never moves them) and
// the shader keeps each candidate with the distance's share, like the old layer's `keepAt`. A budget fixes the reach of
// full density so the expected count stays under a cap (the old `thinReach`, fed by the cover pages' class shares).

export const SCATTER_ZOOM = 15; // ~1.2 km tiles at the equator, ~770 m at 50 deg
export const MIN_KEEP = 1 / 16;
export const MAX_STRIDE_LEVEL = 2; // stride 4: a sixteenth of the candidates, the thinnest keep

export const keepAt = (d: number, reach: number): number => Math.min(1, Math.max(MIN_KEEP, reach / d));

// The coarsest stride level (stride 2^level, base keep 4^-level) whose candidates still hold every tree the keep of the
// tile's nearest point asks for.
export function strideLevel(dMin: number, reach: number): number {
  if (!(reach < Infinity) || dMin <= reach) return 0;
  return Math.max(0, Math.min(MAX_STRIDE_LEVEL, Math.floor(Math.log2(dMin / reach) / 2)));
}

// Reach of full density so that the expected count (`n` at full density per tile, `d` its distance) stays under `max`;
// tiles nearer than `whole` always keep everything. Infinity when everything fits.
export function thinReach(tiles: readonly { n: number; d: number }[], max: number, whole: number): number {
  const total = (reach: number) => tiles.reduce((a, c) => a + (c.d < whole ? c.n : c.n * keepAt(c.d, reach)), 0);
  if (total(Infinity) <= max) return Infinity;
  let lo = 1;
  let hi = Math.max(whole, ...tiles.map((c) => c.d));
  for (let k = 0; k < 30; k++) {
    const mid = (lo + hi) / 2;
    if (total(mid) > max) hi = mid;
    else lo = mid;
  }
  return lo;
}

// A reach that moves in steps of REACH_STEP and only when the wanted one leaves a band around it: a slowly turning
// camera does not make the far trees flicker in and out.
const REACH_STEP = 1.15;
export function steadyReach(current: number, want: number): number {
  const step = (r: number) => REACH_STEP ** Math.floor(Math.log(r) / Math.log(REACH_STEP));
  if (want < current) return step(want);
  if (want >= current * REACH_STEP * REACH_STEP) return want === Infinity ? Infinity : step(want) / REACH_STEP;
  return current;
}

export interface TileFrame {
  centre: Vec3; // ECEF at height 0
  east: Vec3; // across the tile, u 0 -> 1 (m, ECEF)
  south: Vec3; // down the tile, v 0 -> 1
  up: Vec3;
  width: number; // m
  radius: number; // half diagonal, m
  lat: number;
}

// The tile as a flat parallelogram in ECEF through the middles of its edges: over a tile of under 1.3 km the mercator
// square's sides stay within centimetres of straight (the earth's curvature sags its middle by about a centimetre). Its
// sides differ by the ellipsoid's two radii (spherical mercator on WGS84), so they are measured, not assumed.
export function tileFrame(x: number, y: number): TileFrame {
  const at = (u: number, v: number) => {
    const p = tileToLngLat(SCATTER_ZOOM, x, y, u, v);
    return geodeticToEcef(p.lat, p.lng, 0);
  };
  const c = tileToLngLat(SCATTER_ZOOM, x, y, 0.5, 0.5);
  const [w, e, n, s] = [at(0, 0.5), at(1, 0.5), at(0.5, 0), at(0.5, 1)];
  const east: Vec3 = [e[0] - w[0], e[1] - w[1], e[2] - w[2]];
  const south: Vec3 = [s[0] - n[0], s[1] - n[1], s[2] - n[2]];
  const width = Math.hypot(...east);
  return {
    centre: at(0.5, 0.5),
    east,
    south,
    up: enuAt(c.lat, c.lng).up,
    width,
    radius: 0.5 * Math.hypot(width, Math.hypot(...south)),
    lat: c.lat,
  };
}
