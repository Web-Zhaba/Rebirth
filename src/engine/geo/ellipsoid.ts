// WGS84 in float64. Everything the engine places on the planet goes through here; the GPU
// never sees an absolute ECEF coordinate, only differences against the eye (frame/chunkTable.ts).

export type Vec3 = [number, number, number];

export const WGS84_A = 6378137;
export const WGS84_F = 1 / 298.257223563;
export const WGS84_B = WGS84_A * (1 - WGS84_F);
export const WGS84_E2 = WGS84_F * (2 - WGS84_F);
const EP2 = WGS84_E2 / (1 - WGS84_E2); // second eccentricity squared

const RAD = Math.PI / 180;

export function geodeticToEcef(latDeg: number, lngDeg: number, h = 0, out: Vec3 = [0, 0, 0]): Vec3 {
  const phi = latDeg * RAD;
  const lam = lngDeg * RAD;
  const s = Math.sin(phi);
  const c = Math.cos(phi);
  const n = WGS84_A / Math.sqrt(1 - WGS84_E2 * s * s);
  out[0] = (n + h) * c * Math.cos(lam);
  out[1] = (n + h) * c * Math.sin(lam);
  out[2] = (n * (1 - WGS84_E2) + h) * s;
  return out;
}

export interface Geodetic {
  lat: number; // deg
  lng: number; // deg
  h: number; // m above the ellipsoid
}

// Bowring's start plus two Newton-style refinements: sub-millimetre from the core to far beyond geostationary.
export function ecefToGeodetic(p: Readonly<Vec3>): Geodetic {
  const [x, y, z] = p;
  const r = Math.hypot(x, y);
  const lng = Math.atan2(y, x) / RAD;
  if (r < 1e-9) return { lat: z >= 0 ? 90 : -90, lng: 0, h: Math.abs(z) - WGS84_B };
  let phi = Math.atan2(z * WGS84_A, r * WGS84_B);
  phi = Math.atan2(z + EP2 * WGS84_B * Math.sin(phi) ** 3, r - WGS84_E2 * WGS84_A * Math.cos(phi) ** 3);
  for (let i = 0; i < 2; i++) {
    const s = Math.sin(phi);
    const n = WGS84_A / Math.sqrt(1 - WGS84_E2 * s * s);
    const h = r / Math.cos(phi) - n;
    phi = Math.atan2(z, r * (1 - (WGS84_E2 * n) / (n + h)));
  }
  const s = Math.sin(phi);
  const c = Math.cos(phi);
  const n = WGS84_A / Math.sqrt(1 - WGS84_E2 * s * s);
  // Near the poles r/cos loses precision; use the z form there.
  const h = Math.abs(c) > 0.5 ? r / c - n : z / s - n * (1 - WGS84_E2);
  return { lat: phi / RAD, lng, h };
}

export interface Enu {
  east: Vec3;
  north: Vec3;
  up: Vec3; // geodetic normal
}

export function enuAt(latDeg: number, lngDeg: number): Enu {
  const phi = latDeg * RAD;
  const lam = lngDeg * RAD;
  const sp = Math.sin(phi);
  const cp = Math.cos(phi);
  const sl = Math.sin(lam);
  const cl = Math.cos(lam);
  return {
    east: [-sl, cl, 0],
    north: [-sp * cl, -sp * sl, cp],
    up: [cp * cl, cp * sl, sp],
  };
}

// Meridian and prime-vertical radii: metres per radian of latitude / of longitude (times cos lat).
export function radiiAt(latDeg: number): { m: number; n: number } {
  const s = Math.sin(latDeg * RAD);
  const w = Math.sqrt(1 - WGS84_E2 * s * s);
  return { m: (WGS84_A * (1 - WGS84_E2)) / (w * w * w), n: WGS84_A / w };
}

// ---- small f64 vector helpers ----

export const sub = (a: Readonly<Vec3>, b: Readonly<Vec3>): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const add = (a: Readonly<Vec3>, b: Readonly<Vec3>): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const scale = (a: Readonly<Vec3>, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a: Readonly<Vec3>, b: Readonly<Vec3>): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: Readonly<Vec3>, b: Readonly<Vec3>): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const length = (a: Readonly<Vec3>): number => Math.hypot(a[0], a[1], a[2]);
export const normalize = (a: Readonly<Vec3>): Vec3 => scale(a, 1 / length(a));
export const madd = (a: Readonly<Vec3>, b: Readonly<Vec3>, s: number): Vec3 => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];
