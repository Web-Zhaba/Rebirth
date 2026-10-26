import { TUNING } from "../../sim/weather";
import { CLOUD_BASE_M, CLOUD_TOP_M, FADE_FROM, FADE_TO, GLOBE_EXAGGERATION } from "./constants";
import { EARTH_RADIUS_M, metresPerMercator, type Vec3 } from "./frame";

// Pure maths of the ground-shadow layer (PLAN-clouds.md section 6), mirrored line by line in shadowShaders.ts. No three.js.

const RAD = Math.PI / 180;

// Real mid-layer height the shadow is cast from.
export const SHADOW_HEIGHT_M = (CLOUD_BASE_M + CLOUD_TOP_M) / 2;
// Edge length of the base-noise volume on the ground, metres: patches come out about 0.4 of it, 0.5-2 km.
export const NOISE_TILE_M = 4000;
// Strength: share of the way to `dusk` (multiply blend) at full cumulus shadow, and under thick overcast.
export const SHADOW_MAX = 0.25;
export const OVERCAST_MAX = 0.12;
// The sun fades the whole effect in between these elevations (degrees); nothing below the lower one.
export const SUN_OFF_DEG = 3;
export const SUN_FULL_DEG = 12;

const sstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// Cloud height used for the offset: real at street zoom, stretched like the volume on the globe, with the same zoom
// fade as the volume (FADE_FROM..FADE_TO), so there is no jump at the projection switch (zoom 12).
export function shadowHeight(zoom: number): number {
  return SHADOW_HEIGHT_M * (GLOBE_EXAGGERATION + (1 - GLOBE_EXAGGERATION) * sstep(FADE_FROM, FADE_TO, zoom));
}

// Strength of the sun at an elevation: 0 below SUN_OFF_DEG, 1 from SUN_FULL_DEG.
export function sunStrength(sinElev: number): number {
  return sstep(Math.sin(SUN_OFF_DEG * RAD), Math.sin(SUN_FULL_DEG * RAD), sinElev);
}

// Horizontal distance towards the sun from a ground point to the point under the cloud that shades it. 0 when the
// sun is not above SUN_OFF_DEG.
export function sunOffsetM(sinElev: number, heightM: number): number {
  if (sinElev <= Math.sin(SUN_OFF_DEG * RAD)) return 0;
  const tan = sinElev / Math.sqrt(1 - sinElev * sinElev);
  return heightM / tan;
}

// Local frame at a point of the unit sphere (MapLibre frame): up o, east e, north n.
export interface LocalFrame {
  o: Vec3;
  e: Vec3;
  n: Vec3;
}

export function localFrame(lng: number, lat: number): LocalFrame {
  const l = lng * RAD;
  const p = lat * RAD;
  const sl = Math.sin(l), cl = Math.cos(l), sp = Math.sin(p), cp = Math.cos(p);
  return { o: [sl * cp, sp, cl * cp], e: [cl, 0, -sl], n: [-sl * sp, cp, -cl * sp] };
}

const dot = (a: ArrayLike<number>, b: ArrayLike<number>) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

// Unit direction to the sun in a local frame: east/north components (up is the sine of the elevation).
export function sunLocal(sun: Vec3, f: LocalFrame): { east: number; north: number; sinElev: number } {
  return { east: dot(sun, f.e), north: dot(sun, f.n), sinElev: dot(sun, f.o) };
}

// Offset in local metres (east, north) from a ground point to where the shadow-casting cloud sits; [0, 0] with the
// sun down. The cloud is toward the sun, so the offset points at the sun's azimuth.
export function sunOffsetLocal(sun: Vec3, f: LocalFrame, heightM: number): [number, number] {
  const s = sunLocal(sun, f);
  const h = Math.hypot(s.east, s.north);
  const len = sunOffsetM(s.sinElev, heightM);
  if (h < 1e-9 || len === 0) return [0, 0];
  return [(s.east / h) * len, (s.north / h) * len];
}

// Unit sphere direction of the point (east, north) metres from the frame origin (flat tangent plane, then normalised).
// k rescales the metres of a mercator-local frame to true metres at the origin.
export function localToDirection(f: LocalFrame, east: number, north: number, k = 1): Vec3 {
  const a = (east * k) / EARTH_RADIUS_M;
  const b = (north * k) / EARTH_RADIUS_M;
  const x = f.o[0] + a * f.e[0] + b * f.n[0];
  const y = f.o[1] + a * f.e[1] + b * f.n[1];
  const z = f.o[2] + a * f.e[2] + b * f.n[2];
  const l = Math.hypot(x, y, z);
  return [x / l, y / l, z / l];
}

// True metres of a mercator-local frame (metres at latitude lat0) at the origin's latitude.
export const mercatorScaleK = (originLat: number, lat0: number): number => metresPerMercator(originLat) / metresPerMercator(lat0);

// Drift of the kilometre noise, degrees of longitude per game day: the mid-latitude westerlies of weather.ts, one rate
// for the whole globe. weather.ts shears the wind by latitude (trades vs westerlies), which is fine for 1000 km fronts but
// would stretch kilometre-scale patches into east-west streaks within a few game days.
export const DRIFT_DEG = TUNING.windDeg;

// How much of the kilometre noise survives at a ground footprint of `pxM` metres per pixel: gone (0) once a pixel is
// wider than NOISE_TILE_M / 6 (it would alias), fully there (1) below NOISE_TILE_M / 16.
export const noiseDetail = (pxM: number): number => 1 - sstep(NOISE_TILE_M / 16, NOISE_TILE_M / 6, pxM);

// Rotation about the polar axis (+Y in the MapLibre frame) by `ang` radians, eastward positive (toward +lng).
export function rotatePolar(v: ArrayLike<number>, ang: number): Vec3 {
  const c = Math.cos(ang), s = Math.sin(ang);
  return [c * v[0] + s * v[2], v[1], -s * v[0] + c * v[2]];
}

// Two noise layers advected by the wind and cross-faded with period layerDays, as `field()` in weather.ts: layer k is
// rotated by `tau` days of drift (its own clock restarting every layerDays), weighted sin(pi tau / P), so each layer is
// invisible exactly when it restarts and its offset changes. Weights are normalised to keep the variance.
export interface DriftPhase {
  tau: number; // days since this layer restarted, 0..layerDays
  w: number; // normalised weight, w0^2 + w1^2 = 1
  off: Vec3; // tile offset 0..1 for this layer's epoch
}

function epochOffset(k: number, epoch: number): Vec3 {
  const h = (a: number) => {
    let x = (Math.imul(epoch | 0, 0x9e3779b1) ^ Math.imul(k + 1, 0x85ebca6b) ^ Math.imul(a + 1, 0xc2b2ae35)) | 0;
    x ^= x >>> 15;
    x = Math.imul(x, 0x2c1b3c6d);
    x ^= x >>> 12;
    x = Math.imul(x, 0x297a2d39);
    x ^= x >>> 15;
    return (x >>> 0) / 4294967296;
  };
  return [h(0), h(1), h(2)];
}

export function driftPhases(days: number): [DriftPhase, DriftPhase] {
  const P = TUNING.layerDays;
  const out: DriftPhase[] = [];
  let norm = 0;
  for (let k = 0; k < 2; k++) {
    const shifted = days + (k * P) / 2;
    const epoch = Math.floor(shifted / P);
    const tau = shifted - epoch * P;
    const w = Math.sin((Math.PI * tau) / P);
    out.push({ tau, w, off: epochOffset(k, epoch) });
    norm += w * w;
  }
  const inv = 1 / Math.sqrt(norm);
  for (const p of out) p.w *= inv;
  return out as [DriftPhase, DriftPhase];
}

// Blended noise value from the two layers' samples (each 0..1, mean 0.5).
export const blendDrift = (a: number, b: number, p: [DriftPhase, DriftPhase]): number => 0.5 + p[0].w * (a - 0.5) + p[1].w * (b - 0.5);

// Darkening amount 0..1 (toward dusk) for a cover, cloud type 0..1 (sheet..tower), patchy noise 0..1 and sun strength.
// Cumulus: noise patches whose coverage follows the cover; sheets: an even dim. Mirrors the shader.
export function darkening(cover: number, type: number, noise: number, sun: number, detail = 1): number {
  const th = 1 - cover;
  // With no detail (far zoom) a patch is the area share of the cover: the mean of the patchy shadow.
  const patch = (detail * sstep(th - 0.12, th + 0.12, noise) + (1 - detail) * cover) * sstep(0.05, 0.3, cover);
  const thick = sstep(0.45, 0.95, cover);
  return sun * (SHADOW_MAX * type * patch + OVERCAST_MAX * thick);
}

// Camera ray of a pixel in a perspective view, built in double precision: origin `cam`, direction proportional to
// `a + b * ndcX + c * ndcY` (forward-pointing, not normalised). Unprojecting each pixel with a Float32 copy of the inverse
// matrix loses hundreds of metres on the globe; these three vectors are small and well conditioned. `inv` is the inverse of
// the (globe) view-projection matrix, column-major.
export interface RayBasis {
  cam: Vec3;
  a: Vec3;
  b: Vec3;
  c: Vec3;
}

export function rayBasis(inv: ArrayLike<number>): RayBasis | null {
  // Camera: image of the clip-space point (0, 0, 1, 0), a perspective eye has w = 0.
  const hw = inv[11];
  if (!hw) return null;
  const cam: Vec3 = [inv[8] / hw, inv[9] / hw, inv[10] / hw];
  // u(x, y) = inv * (x, y, 0, 1); point = u.xyz / u.w; point - cam is proportional to hw * u.xyz - u.w * (h.xyz) with
  // h = inv * (0, 0, 1, 0) (so cam = h.xyz / h.w), which is linear in (x, y).
  const hx = inv[8], hy = inv[9], hz = inv[10];
  const col = (k: number) => [inv[4 * k], inv[4 * k + 1], inv[4 * k + 2], inv[4 * k + 3]];
  const lin = (u: number[]): Vec3 => [hw * u[0] - u[3] * hx, hw * u[1] - u[3] * hy, hw * u[2] - u[3] * hz];
  const c0 = col(0), c1 = col(1), c3 = col(3);
  const a = lin(c3); // x = y = 0 (z = 0, w = 1): column 3
  const b = lin(c0);
  const c = lin(c1);
  // Forward sign: toward the point on the far plane.
  const f = [inv[8] + inv[12], inv[9] + inv[13], inv[10] + inv[14], inv[11] + inv[15]]; // inv * (0, 0, 1, 1)
  const fp: Vec3 = [f[0] / f[3], f[1] / f[3], f[2] / f[3]];
  const d = (fp[0] - cam[0]) * a[0] + (fp[1] - cam[1]) * a[1] + (fp[2] - cam[2]) * a[2];
  const sg = d < 0 ? -1 : 1;
  const sc = (v: Vec3): Vec3 => [v[0] * sg, v[1] * sg, v[2] * sg];
  return { cam, a: sc(a), b: sc(b), c: sc(c) };
}
