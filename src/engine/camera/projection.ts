// Matrices in float64, column-major (WGSL mat4x4f layout). Converted to f32 only at upload, after the eye has been
// subtracted, so the matrices only ever hold rotations and the projection.

export type Mat4 = Float64Array; // 16, column-major

// Reversed-Z, infinite far plane, WebGPU clip space (z in 0..1): view-space z = -near maps to depth 1, z -> -inf to
// depth 0. With depth32float and compare `greater` this keeps precision roughly constant in log-distance, which is
// what lets one depth buffer cover 0.1 m to the far side of the planet.
export function perspectiveReversedInfinite(fovY: number, aspect: number, near: number, out: Mat4 = new Float64Array(16)): Mat4 {
  const f = 1 / Math.tan(fovY / 2);
  out.fill(0);
  out[0] = f / aspect;
  out[5] = f;
  out[10] = 0;
  out[11] = -1; // w = -z_view
  out[14] = near; // z = near
  return out;
}

// View matrix for an eye at the origin: rows are the camera axes (right, up, back), no translation.
export function viewRotation(right: ArrayLike<number>, up: ArrayLike<number>, forward: ArrayLike<number>, out: Mat4 = new Float64Array(16)): Mat4 {
  out.fill(0);
  for (let i = 0; i < 3; i++) {
    out[i * 4 + 0] = right[i];
    out[i * 4 + 1] = up[i];
    out[i * 4 + 2] = -forward[i];
  }
  out[15] = 1;
  return out;
}

export function multiply(a: Mat4, b: Mat4, out: Mat4 = new Float64Array(16)): Mat4 {
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
      out[c * 4 + r] = s;
    }
  return out;
}

export function transformPoint(m: Mat4, p: ArrayLike<number>): [number, number, number, number] {
  const [x, y, z] = [p[0], p[1], p[2]];
  return [
    m[0] * x + m[4] * y + m[8] * z + m[12],
    m[1] * x + m[5] * y + m[9] * z + m[13],
    m[2] * x + m[6] * y + m[10] * z + m[14],
    m[3] * x + m[7] * y + m[11] * z + m[15],
  ];
}
