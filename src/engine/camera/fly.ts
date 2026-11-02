// MapLibre's flyTo path (van Wijk & Nuij, "Smooth and efficient zooming and panning"), reduced to pure math.
// Units: w is the width of the visible ground in metres (proportional to the camera distance), u the ground distance
// between the two ends in metres. The path zooms out on long hops and back in on arrival.

export const FLY_RHO = 1.42; // MapLibre's curve: how much to zoom out
export const FLY_SPEED = 1.2; // MapLibre's default speed, S per second

export interface FlyPath {
  S: number; // total path length in the paper's units, the natural duration scale
  // k in 0..1 along the path (already eased): ground fraction travelled and the visible width at that point
  at(k: number): { frac: number; w: number };
}

export function flyPath(w0: number, w1: number, u1: number, rho = FLY_RHO): FlyPath {
  if (u1 < 1e-6 * Math.max(w0, w1)) {
    // Pure zoom: no ground to cover, the path degenerates to an exponential.
    const S = Math.abs(Math.log(w1 / w0)) / rho;
    const sign = w1 < w0 ? -1 : 1;
    return { S, at: (k) => ({ frac: k, w: w0 * Math.exp(sign * rho * k * S) }) };
  }
  const rho2 = rho * rho;
  const b = (i: 0 | 1): number => {
    const wi = i ? w1 : w0;
    return (w1 * w1 - w0 * w0 + (i ? -1 : 1) * rho2 * rho2 * u1 * u1) / (2 * wi * rho2 * u1);
  };
  const r = (i: 0 | 1): number => {
    const bi = b(i);
    return Math.log(Math.sqrt(bi * bi + 1) - bi);
  };
  const r0 = r(0);
  const r1 = r(1);
  const S = (r1 - r0) / rho;
  return {
    S,
    at(k) {
      const s = k * S;
      const w = (w0 * Math.cosh(r0)) / Math.cosh(r0 + rho * s);
      const u = (w0 * ((Math.cosh(r0) * Math.tanh(r0 + rho * s) - Math.sinh(r0)) / rho2)) / u1;
      return { frac: Math.min(1, Math.max(0, u)), w };
    },
  };
}

// MapLibre's default duration: path length over speed; short moves still take a moment.
export function flyDuration(S: number, speed = FLY_SPEED, minMs = 400, maxMs = 6500): number {
  return Math.min(maxMs, Math.max(minMs, (1000 * S) / speed));
}

const RAD = Math.PI / 180;
export const MEAN_RADIUS = 6371008.8;

// Great-circle distance in metres on the mean sphere.
export function groundDistance(lat0: number, lng0: number, lat1: number, lng1: number): number {
  const dLat = (lat1 - lat0) * RAD;
  const dLng = (lng1 - lng0) * RAD;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat0 * RAD) * Math.cos(lat1 * RAD) * Math.sin(dLng / 2) ** 2;
  return 2 * MEAN_RADIUS * Math.asin(Math.min(1, Math.sqrt(a)));
}

// Point a fraction of the great circle from (lat0,lng0) to (lat1,lng1).
export function slerpLatLng(lat0: number, lng0: number, lat1: number, lng1: number, f: number): { lat: number; lng: number } {
  const v0 = unit(lat0, lng0);
  const v1 = unit(lat1, lng1);
  const dot = Math.min(1, Math.max(-1, v0[0] * v1[0] + v0[1] * v1[1] + v0[2] * v1[2]));
  const om = Math.acos(dot);
  if (om < 1e-9) return { lat: lat0, lng: lng0 };
  const sn = Math.sin(om);
  const a = Math.sin((1 - f) * om) / sn;
  const b = Math.sin(f * om) / sn;
  const x = a * v0[0] + b * v1[0];
  const y = a * v0[1] + b * v1[1];
  const z = a * v0[2] + b * v1[2];
  return { lat: Math.atan2(z, Math.hypot(x, y)) / RAD, lng: Math.atan2(y, x) / RAD };
}

function unit(lat: number, lng: number): [number, number, number] {
  const c = Math.cos(lat * RAD);
  return [c * Math.cos(lng * RAD), c * Math.sin(lng * RAD), Math.sin(lat * RAD)];
}

// Signed shortest turn from a to b in degrees.
export function angleDelta(a: number, b: number): number {
  return ((((b - a) % 360) + 540) % 360) - 180;
}
