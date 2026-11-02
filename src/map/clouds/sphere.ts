// The unit-sphere frame the weather cube and the cloud maths live in (the old globe map's): radius 1 is the planet
// (6 371 008.8 m), a point sits at (sin lng cos lat, sin lat, cos lng cos lat), so +Y is north and +Z is (0E, 0N); an
// ECEF direction d is d.yzx here (sky/weather.wgsl). A point at altitude h metres has radius 1 + h / EARTH_RADIUS_M.

export type Vec3 = [number, number, number];

export const EARTH_RADIUS_M = 6371008.8;
const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;

export function lngLatToSphere(lng: number, lat: number, altM = 0): Vec3 {
  const r = 1 + altM / EARTH_RADIUS_M;
  const cl = Math.cos(lat * RAD);
  return [Math.sin(lng * RAD) * cl * r, Math.sin(lat * RAD) * r, Math.cos(lng * RAD) * cl * r];
}

export function sphereToLngLat(p: ArrayLike<number>): { lng: number; lat: number; alt: number } {
  const len = Math.hypot(p[0], p[1], p[2]);
  return {
    lng: Math.atan2(p[0], p[2]) * DEG,
    lat: Math.asin(Math.max(-1, Math.min(1, p[1] / len))) * DEG,
    alt: (len - 1) * EARTH_RADIUS_M,
  };
}

// sim/weather.ts frame (x to 0E 0N, y to 90E, z north) to this one.
export function weatherToSphere(w: ArrayLike<number>): Vec3 {
  return [w[1], w[2], w[0]];
}

// Local frame at a point of the unit sphere: up o, east e, north n.
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
