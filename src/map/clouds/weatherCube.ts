import { climate, cloudField, TUNING, yearFrac } from "../../sim/weather";

// Pure parts of the weather cube map (PLAN-clouds.md section 4).
//
// Frame: MapLibre unit sphere, X = sin(lng)cos(lat), Y = sin(lat) (north), Z = cos(lng)cos(lat).
// Faces: GL order +X -X +Y -Y +Z -Z. A texel (i, j) of an RGBA8 face (row 0 first in memory, i.e. t = 0 first, no
// flipY) has s = (i + .5) / size, t = (j + .5) / size, sc = 2s - 1, tc = 2t - 1 and the direction below, which is the
// inverse of the cube-map selection table of the GL spec (so `textureCube(dir)` finds the same texel):
//   +X: (1, -tc, -sc)   -X: (-1, -tc, sc)   +Y: (sc, 1, tc)   -Y: (sc, -1, -tc)   +Z: (sc, -tc, 1)   -Z: (-sc, -tc, -1)

export type Vec3 = [number, number, number];

export const FACES = 6;
export const STORM_MAX = 64; // strongest storm cells returned per cube
const STORM_TYPE = 0.6;
const STORM_PRECIP = 0.5;
const STORM_SEP = Math.cos(0.1); // cells closer than ~0.1 rad (640 km) are merged into the stronger one

const DEG = 180 / Math.PI;
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const sstep = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

// Unit direction of the centre of texel (i, j) on a face.
export function texelDir(face: number, i: number, j: number, size: number): Vec3 {
  const sc = (2 * (i + 0.5)) / size - 1;
  const tc = (2 * (j + 0.5)) / size - 1;
  let x: number, y: number, z: number;
  switch (face) {
    case 0: x = 1; y = -tc; z = -sc; break;
    case 1: x = -1; y = -tc; z = sc; break;
    case 2: x = sc; y = 1; z = tc; break;
    case 3: x = sc; y = -1; z = -tc; break;
    case 4: x = sc; y = -tc; z = 1; break;
    default: x = -sc; y = -tc; z = -1;
  }
  const n = 1 / Math.hypot(x, y, z);
  return [x * n, y * n, z * n];
}

// Face and texel a direction falls in (the GL selection rule; ties go to the first axis).
export function dirToTexel(x: number, y: number, z: number, size: number): { face: number; i: number; j: number } {
  const ax = Math.abs(x), ay = Math.abs(y), az = Math.abs(z);
  let face: number, sc: number, tc: number, ma: number;
  if (ax >= ay && ax >= az) {
    ma = ax;
    if (x > 0) { face = 0; sc = -z; tc = -y; } else { face = 1; sc = z; tc = -y; }
  } else if (ay >= az) {
    ma = ay;
    if (y > 0) { face = 2; sc = x; tc = z; } else { face = 3; sc = x; tc = -z; }
  } else {
    ma = az;
    if (z > 0) { face = 4; sc = x; tc = -y; } else { face = 5; sc = -x; tc = -y; }
  }
  const px = ((sc / ma + 1) / 2) * size;
  const py = ((tc / ma + 1) / 2) * size;
  return {
    face,
    i: Math.min(size - 1, Math.max(0, Math.floor(px))),
    j: Math.min(size - 1, Math.max(0, Math.floor(py))),
  };
}

// MapLibre-frame direction to degrees: lng in (-180, 180], lat in [-90, 90].
export function dirToLngLat(x: number, y: number, z: number): { lng: number; lat: number } {
  return { lng: Math.atan2(x, z) * DEG, lat: Math.asin(Math.min(1, Math.max(-1, y / Math.hypot(x, y, z)))) * DEG };
}

// Cloud type 0 (stratiform sheet) .. 1 (convective tower).
//   warm  = smoothstep(8, 22, sea-level climate mean temperature, degC)
//   polar = 1 - 0.5 * smoothstep(45, 85, |lat|)
//   type  = clamp((0.7 * warm + 0.4 * precipShare) * polar)
// Warm air gives towers, rain pushes any cloud toward towers, cold polar air flattens them into sheets.
export function cloudType(meanTemp: number, precipShare: number, lat: number): number {
  const warm = sstep(8, 22, meanTemp);
  const polar = 1 - 0.5 * sstep(45, 85, Math.abs(lat));
  return clamp01((0.7 * warm + 0.4 * precipShare) * polar);
}

// Fills one RGBA8 face (size * size * 4 bytes): R cover, G type, B precip / precipMax, A (sea-level mean T + 40) / 80.
// Returns the number of storm texels (type > 0.6 and precip share > 0.5).
export function buildCubeFace(face: number, size: number, t: number, seed: number, phase: number, out: Uint8Array | Uint8ClampedArray): number {
  const frac = yearFrac(t, phase);
  let storms = 0;
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const [x, y, z] = texelDir(face, i, j, size);
      const { lng, lat } = dirToLngLat(x, y, z);
      const c = cloudField(lng, lat, t, seed, phase);
      const mean = climate(lat, 0, frac).mean;
      const cover = clamp01(c.cloud);
      const precip = clamp01(c.precip / TUNING.precipMax);
      const type = cloudType(mean, precip, lat);
      const o = (j * size + i) * 4;
      out[o] = Math.round(cover * 255);
      out[o + 1] = Math.round(type * 255);
      out[o + 2] = Math.round(precip * 255);
      out[o + 3] = Math.round(clamp01((mean + 40) / 80) * 255);
      if (type > STORM_TYPE && precip > STORM_PRECIP) storms++;
    }
  }
  return storms;
}

// Up to `max` strongest storm cells, flat [x, y, z, strength] * n (unit direction in the MapLibre frame, strength 0..1
// = type * precip of the texel), greedily thinned so cells are at least ~0.1 rad apart. Scans the 6 built faces.
export function stormCells(faces: ArrayLike<number>[], size: number, max = STORM_MAX): Float32Array {
  const cand: { x: number; y: number; z: number; s: number }[] = [];
  for (let f = 0; f < faces.length; f++) {
    const d = faces[f];
    for (let j = 0; j < size; j++) {
      for (let i = 0; i < size; i++) {
        const o = (j * size + i) * 4;
        const type = d[o + 1] / 255;
        const precip = d[o + 2] / 255;
        if (type > STORM_TYPE && precip > STORM_PRECIP) {
          const [x, y, z] = texelDir(f, i, j, size);
          cand.push({ x, y, z, s: type * precip });
        }
      }
    }
  }
  cand.sort((a, b) => b.s - a.s);
  const picked: typeof cand = [];
  for (const c of cand) {
    if (picked.length >= max) break;
    if (picked.every((p) => p.x * c.x + p.y * c.y + p.z * c.z < STORM_SEP)) picked.push(c);
  }
  const out = new Float32Array(picked.length * 4);
  picked.forEach((p, k) => out.set([p.x, p.y, p.z, p.s], k * 4));
  return out;
}
