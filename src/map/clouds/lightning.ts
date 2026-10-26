// Lightning schedule (PLAN-clouds.md section 5). A pure function of (storm cell index, strength, REAL time in seconds),
// so the flicker does not follow game speed and two layers agree. The GPU only receives the few flashes active now.

export const FLASH_MAX = 6; // flashes drawn at once
export const FLASH_ACTIVE = 0.03; // intensity above which a cell counts as flashing

// 32-bit integer hash of three ints to [0, 1).
export function hash01(a: number, b: number, c: number): number {
  let h = (Math.imul(a | 0, 0x1f1f1f1f) ^ Math.imul(b | 0, 0x2c9277b5) ^ Math.imul(c | 0, 0x6b43a9b5)) | 0;
  h ^= h >>> 15;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export interface CellFlash {
  intensity: number; // 0..1 (before the cell's strength)
  strike: number; // index of the strike, changes the position of the flash
}

// Each cell has its own period (3-10 s) and offset; once per period it may strike with a chance that grows with the
// cell strength. A strike is a bright pulse that decays in about 0.3 s, with a weaker second pulse.
export function cellFlash(cell: number, strength: number, timeS: number): CellFlash {
  const period = 3 + 7 * hash01(cell, 1, 0);
  const u = (timeS + period * hash01(cell, 2, 0)) / period;
  const n = Math.floor(u);
  const local = (u - n) * period;
  if (hash01(cell, 3, n) >= 0.25 + 0.6 * Math.min(1, Math.max(0, strength))) return { intensity: 0, strike: n };
  const first = Math.exp(-local * 10);
  const second = local >= 0.14 ? 0.8 * Math.exp(-(local - 0.14) * 12) : 0;
  const i = Math.max(first, second);
  return { intensity: i < FLASH_ACTIVE ? 0 : i, strike: n };
}

// Position of a strike: the cell direction nudged by up to ~0.035 rad along the surface; deterministic for (cell, strike).
export function strikeDir(cell: number, strike: number, dir: ArrayLike<number>): [number, number, number] {
  const [x, y, z] = [dir[0], dir[1], dir[2]];
  // tangent basis
  let ax = 0, ay = 1, az = 0;
  if (Math.abs(y) > 0.9) {
    ax = 1;
    ay = 0;
  }
  let t1x = ay * z - az * y, t1y = az * x - ax * z, t1z = ax * y - ay * x;
  const l = Math.hypot(t1x, t1y, t1z) || 1;
  t1x /= l;
  t1y /= l;
  t1z /= l;
  const t2x = y * t1z - z * t1y, t2y = z * t1x - x * t1z, t2z = x * t1y - y * t1x;
  const u = (hash01(cell, 4, strike) - 0.5) * 0.07;
  const v = (hash01(cell, 5, strike) - 0.5) * 0.07;
  const px = x + t1x * u + t2x * v, py = y + t1y * u + t2y * v, pz = z + t1z * u + t2z * v;
  const pl = Math.hypot(px, py, pz) || 1;
  return [px / pl, py / pl, pz / pl];
}

// Fills `out` (FLASH_MAX vec4: xyz unit direction, w intensity * strength) with the strongest flashing cells at this
// moment. `visible` may drop cells on the far side of the planet. Returns how many were written.
export function activeFlashes(
  storms: ArrayLike<number>,
  count: number,
  timeS: number,
  out: Float32Array,
  visible?: (x: number, y: number, z: number) => boolean,
): number {
  let n = 0;
  for (let c = 0; c < count; c++) {
    const x = storms[c * 4], y = storms[c * 4 + 1], z = storms[c * 4 + 2], s = storms[c * 4 + 3];
    if (visible && !visible(x, y, z)) continue;
    const f = cellFlash(c, s, timeS);
    if (f.intensity <= 0) continue;
    const w = f.intensity * (0.5 + 0.5 * s);
    let slot = n < FLASH_MAX ? n : -1;
    if (slot < 0) {
      // replace the weakest if this one is stronger
      let weakest = 0;
      for (let k = 1; k < FLASH_MAX; k++) if (out[k * 4 + 3] < out[weakest * 4 + 3]) weakest = k;
      if (out[weakest * 4 + 3] >= w) continue;
      slot = weakest;
    } else n++;
    const d = strikeDir(c, f.strike, [x, y, z]);
    out[slot * 4] = d[0];
    out[slot * 4 + 1] = d[1];
    out[slot * 4 + 2] = d[2];
    out[slot * 4 + 3] = w;
  }
  return n;
}
