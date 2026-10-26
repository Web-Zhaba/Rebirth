// Coordinate-frame helpers for the cloud layers. Pure maths on plain arrays, no three.js and no MapLibre.
//
// MapLibre unit-sphere frame (globe mode, what `defaultProjectionData.mainMatrix` projects): radius 1 is the planet
// (6 371 008.8 m), a point sits at (sin lng cos lat, sin lat, cos lng cos lat), so +Y is north and +Z is (0E, 0N).
// A point at altitude h metres has radius 1 + h / EARTH_RADIUS_M (MapLibre's shader: spherePos * (1 + h / GLOBE_RADIUS)).
// Mercator frame (mercator mode): x, y in 0..1 over the world (x east from 180W, y south from the north edge of the
// square), z above the ground in the same units (metres / metresPerMercator(lat)), like MapLibre's MercatorCoordinate.

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

// weather.ts frame (x to 0E 0N, y to 90E, z north) to the MapLibre frame.
export function weatherToSphere(w: ArrayLike<number>): Vec3 {
  return [w[1], w[2], w[0]];
}

export function lngLatToMercator(lng: number, lat: number): [number, number] {
  const s = Math.sin(lat * RAD);
  return [(lng + 180) / 360, 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)];
}

export function mercatorToLngLat(x: number, y: number): { lng: number; lat: number } {
  return { lng: x * 360 - 180, lat: (2 * Math.atan(Math.exp(Math.PI - 2 * Math.PI * y)) - Math.PI / 2) * DEG };
}

// Metres per mercator unit at a latitude (the world is 2 pi R * cos(lat) wide there).
export const metresPerMercator = (lat: number): number => 2 * Math.PI * EARTH_RADIUS_M * Math.cos(lat * RAD);

// ---- 4x4 matrices, column-major like WebGL and gl-matrix ----

export type Mat4 = Float64Array;

export function invert4(m: ArrayLike<number>, out: Mat4 = new Float64Array(16)): Mat4 | null {
  const a00 = m[0], a01 = m[1], a02 = m[2], a03 = m[3];
  const a10 = m[4], a11 = m[5], a12 = m[6], a13 = m[7];
  const a20 = m[8], a21 = m[9], a22 = m[10], a23 = m[11];
  const a30 = m[12], a31 = m[13], a32 = m[14], a33 = m[15];
  const b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10, b02 = a00 * a13 - a03 * a10;
  const b03 = a01 * a12 - a02 * a11, b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12;
  const b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30, b08 = a20 * a33 - a23 * a30;
  const b09 = a21 * a32 - a22 * a31, b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32;
  let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
  if (!det) return null;
  det = 1 / det;
  out[0] = (a11 * b11 - a12 * b10 + a13 * b09) * det;
  out[1] = (a02 * b10 - a01 * b11 - a03 * b09) * det;
  out[2] = (a31 * b05 - a32 * b04 + a33 * b03) * det;
  out[3] = (a22 * b04 - a21 * b05 - a23 * b03) * det;
  out[4] = (a12 * b08 - a10 * b11 - a13 * b07) * det;
  out[5] = (a00 * b11 - a02 * b08 + a03 * b07) * det;
  out[6] = (a32 * b02 - a30 * b05 - a33 * b01) * det;
  out[7] = (a20 * b05 - a22 * b02 + a23 * b01) * det;
  out[8] = (a10 * b10 - a11 * b08 + a13 * b06) * det;
  out[9] = (a01 * b08 - a00 * b10 - a03 * b06) * det;
  out[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det;
  out[11] = (a21 * b02 - a20 * b04 - a23 * b00) * det;
  out[12] = (a11 * b07 - a10 * b09 - a12 * b06) * det;
  out[13] = (a00 * b09 - a01 * b07 + a02 * b06) * det;
  out[14] = (a31 * b01 - a30 * b03 - a32 * b00) * det;
  out[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det;
  return out;
}

// Camera-relative ("relative to centre") matrix for mercator mode. Float32 cannot hold a mercator coordinate to better
// than a few metres at city zoom, so work in a local frame: local (east m, north m, up m) -> clip, equal to
// main * (origin.x + east / s, origin.y - north / s, up / s) with s = metresPerMercator(lat of origin). Float64 maths here,
// small numbers on the GPU. The y flip means three.js sees a mirrored matrix: front faces wind clockwise.
export function mercatorLocalMatrix(main: ArrayLike<number>, origin: [number, number], s: number, out: Mat4 = new Float64Array(16)): Mat4 {
  const [ox, oy] = origin;
  // columns of main * T(origin) * S(1/s, -1/s, 1)
  for (let r = 0; r < 4; r++) {
    out[r] = main[r] / s;
    out[4 + r] = -main[4 + r] / s;
    out[8 + r] = main[8 + r] / s;
    out[12 + r] = main[12 + r] + ox * main[r] + oy * main[4 + r];
  }
  return out;
}

// Multiplies a point (w = 1) by a matrix and divides by w; returns the resulting xyz (NDC for a projection matrix).
export function transformPoint(m: ArrayLike<number>, p: ArrayLike<number>): Vec3 {
  const x = p[0], y = p[1], z = p[2];
  const w = m[3] * x + m[7] * y + m[11] * z + m[15];
  return [
    (m[0] * x + m[4] * y + m[8] * z + m[12]) / w,
    (m[1] * x + m[5] * y + m[9] * z + m[13]) / w,
    (m[2] * x + m[6] * y + m[10] * z + m[14]) / w,
  ];
}

// World-space ray through an NDC position, from the inverse of the view-projection matrix.
export function rayFromNdc(inv: ArrayLike<number>, ndcX: number, ndcY: number): { origin: Vec3; dir: Vec3 } {
  const near = transformPoint(inv, [ndcX, ndcY, -1]);
  const far = transformPoint(inv, [ndcX, ndcY, 1]);
  const d: Vec3 = [far[0] - near[0], far[1] - near[1], far[2] - near[2]];
  const len = Math.hypot(d[0], d[1], d[2]);
  return { origin: near, dir: [d[0] / len, d[1] / len, d[2] / len] };
}

// Nearest intersection in front of the origin with a sphere centred at the origin; null on a miss.
export function raySphere(origin: ArrayLike<number>, dir: ArrayLike<number>, radius: number): number | null {
  const b = origin[0] * dir[0] + origin[1] * dir[1] + origin[2] * dir[2];
  const c = origin[0] ** 2 + origin[1] ** 2 + origin[2] ** 2 - radius * radius;
  const disc = b * b - c;
  if (disc < 0) return null;
  const s = Math.sqrt(disc);
  const t = -b - s;
  return t >= 0 ? t : -b + s >= 0 ? -b + s : null;
}

// Intersection with the plane z = 0 (mercator ground); null when parallel or behind.
export function rayGround(origin: ArrayLike<number>, dir: ArrayLike<number>): Vec3 | null {
  if (Math.abs(dir[2]) < 1e-12) return null;
  const t = -origin[2] / dir[2];
  return t < 0 ? null : [origin[0] + dir[0] * t, origin[1] + dir[1] * t, 0];
}
