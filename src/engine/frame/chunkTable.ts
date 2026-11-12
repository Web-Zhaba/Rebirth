import type { Vec3 } from "../geo/ellipsoid";

// Floating origin. Every resident chunk has an f64 ECEF origin; its vertices are f32 metres
// relative to it. Each frame the CPU writes `origin - eye`, subtracted in f64 and only then rounded to f32, so the
// GPU never adds two large numbers: the error of a vertex near the eye is one f32 rounding of |origin - eye| plus
// one of its local offset, i.e. it shrinks with chunk size and with the chunk's distance to the eye.

// Writes origin - eye as three f32 at `at`.
export function writeRelative(out: Float32Array, at: number, origin: Readonly<Vec3>, eye: Readonly<Vec3>): void {
  out[at] = origin[0] - eye[0];
  out[at + 1] = origin[1] - eye[1];
  out[at + 2] = origin[2] - eye[2];
}

const f = Math.fround;

// The exact sequence of f32 operations the terrain vertex shader performs, for precision tests:
// rel = (origin - eye) + local + up * h, left to right, each step rounded to f32.
export function shaderRelative(origin: Readonly<Vec3>, eye: Readonly<Vec3>, local: Readonly<Vec3>, up: Readonly<Vec3> = [0, 0, 0], h = 0): Vec3 {
  const out: Vec3 = [0, 0, 0];
  const hf = f(h);
  for (let i = 0; i < 3; i++) {
    const rel = f(origin[i] - eye[i]);
    const withLocal = f(rel + f(local[i]));
    out[i] = f(withLocal + f(f(up[i]) * hf));
  }
  return out;
}

// Local offset of an absolute point inside a chunk as the CPU stores it (f64 difference, then f32).
export function localOffset(p: Readonly<Vec3>, origin: Readonly<Vec3>): Vec3 {
  return [f(p[0] - origin[0]), f(p[1] - origin[1]), f(p[2] - origin[2])];
}
