import { beforeAll, describe, expect, it } from "vitest";
import { BASE_SIZE, buildBaseNoise, buildDetailNoise, DETAIL_SIZE } from "./noise3d";

let base: Uint8Array;
let detail: Uint8Array;
beforeAll(() => {
  base = buildBaseNoise();
  detail = buildDetailNoise();
});

// Mean absolute difference of neighbouring voxels across the wrap (n-1 to 0) relative to inside the volume.
function seamRatio(v: Uint8Array, n: number, axis: number, ch: number): number {
  const stride = [1, n, n * n][axis];
  const idx = (x: number, y: number, z: number) => ((z * n + y) * n + x) * 4 + ch;
  let wrapSum = 0, inSum = 0, wrapCnt = 0, inCnt = 0;
  for (let a = 0; a < n; a++)
    for (let b = 0; b < n; b++)
      for (let k = 0; k < n; k++) {
        const c = axis === 0 ? [k, a, b] : axis === 1 ? [a, k, b] : [a, b, k];
        const i = idx(c[0], c[1], c[2]);
        const j = k === n - 1 ? i - (n - 1) * stride : i + stride;
        const d = Math.abs(v[i] - v[j]);
        if (k === n - 1) { wrapSum += d; wrapCnt++; } else { inSum += d; inCnt++; }
      }
  return wrapSum / wrapCnt / (inSum / inCnt + 1e-9);
}

describe("noise volumes", () => {
  it("have the right sizes", () => {
    expect(base.length).toBe(BASE_SIZE ** 3 * 4);
    expect(detail.length).toBe(DETAIL_SIZE ** 3 * 4);
  });

  it("tile: the wrap seam is no rougher than the interior", () => {
    for (let axis = 0; axis < 3; axis++) {
      for (const ch of [0, 1, 2, 3]) expect(seamRatio(base, BASE_SIZE, axis, ch)).toBeLessThan(1.6);
      for (const ch of [0, 1, 2]) expect(seamRatio(detail, DETAIL_SIZE, axis, ch)).toBeLessThan(1.6);
    }
  });

  it("are not constant", () => {
    const check = (v: Uint8Array, ch: number) => {
      let s = 0, s2 = 0, c = 0;
      for (let i = ch; i < v.length; i += 4) { s += v[i]; s2 += v[i] * v[i]; c++; }
      const mean = s / c;
      expect(s2 / c - mean * mean).toBeGreaterThan(50);
    };
    for (const ch of [0, 1, 2, 3]) check(base, ch);
    for (const ch of [0, 1, 2]) check(detail, ch);
  });

  it("are deterministic and seeded", () => {
    expect(buildDetailNoise()).toEqual(detail);
    expect(buildDetailNoise(9)).not.toEqual(detail);
  });
});
