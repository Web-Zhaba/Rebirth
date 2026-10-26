import { describe, expect, it } from "vitest";
import { activeFlashes, cellFlash, FLASH_ACTIVE, FLASH_MAX, hash01, strikeDir } from "./lightning";

describe("lightning schedule", () => {
  it("is deterministic for (cell, strength, time)", () => {
    for (const t of [0, 1.234, 77.7, 1e6 + 0.5]) {
      expect(cellFlash(7, 0.8, t)).toEqual(cellFlash(7, 0.8, t));
      expect(strikeDir(7, cellFlash(7, 0.8, t).strike, [0, 1, 0])).toEqual(strikeDir(7, cellFlash(7, 0.8, t).strike, [0, 1, 0]));
    }
    expect(hash01(1, 2, 3)).toBe(hash01(1, 2, 3));
    expect(hash01(1, 2, 3)).not.toBe(hash01(1, 2, 4));
  });
  it("hash stays in [0, 1)", () => {
    for (let i = 0; i < 500; i++) {
      const h = hash01(i, i * 7, -i);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(1);
    }
  });
  it("flashes briefly and often enough for strong cells", () => {
    let lit = 0;
    const n = 20000;
    for (let i = 0; i < n; i++) if (cellFlash(3, 1, i * 0.05).intensity > 0) lit++;
    const share = lit / n;
    expect(share).toBeGreaterThan(0.02);
    expect(share).toBeLessThan(0.2);
    for (let i = 0; i < 2000; i++) {
      const f = cellFlash(11, 0.7, i * 0.037);
      expect(f.intensity === 0 || (f.intensity >= FLASH_ACTIVE && f.intensity <= 1)).toBe(true);
    }
  });
  it("strong cells strike more often than weak ones", () => {
    const count = (s: number) => {
      let k = 0;
      for (let c = 0; c < 200; c++) {
        const f = cellFlash(c, s, 10);
        const g = cellFlash(c, s, 10);
        if (f.strike === g.strike) k += hash01(c, 3, f.strike) < 0.25 + 0.6 * s ? 1 : 0;
      }
      return k;
    };
    expect(count(1)).toBeGreaterThan(count(0));
  });
  it("keeps strikes near the cell direction, on the unit sphere", () => {
    const d = strikeDir(5, 12, [0, 0, 1]);
    expect(Math.hypot(...d)).toBeCloseTo(1, 6);
    expect(d[2]).toBeGreaterThan(0.99);
    const pole = strikeDir(5, 12, [0, 1, 0]);
    expect(pole[1]).toBeGreaterThan(0.99);
  });
  it("fills at most FLASH_MAX flashes and honours visibility", () => {
    const cells = new Float32Array(64 * 4);
    for (let c = 0; c < 64; c++) cells.set([0, 0, 1, 1], c * 4);
    const out = new Float32Array(FLASH_MAX * 4);
    let seen = 0;
    for (let t = 0; t < 60; t += 0.1) {
      out.fill(0);
      const n = activeFlashes(cells, 64, t, out);
      expect(n).toBeLessThanOrEqual(FLASH_MAX);
      seen = Math.max(seen, n);
      for (let k = 0; k < n; k++) expect(out[k * 4 + 3]).toBeGreaterThan(0);
    }
    expect(seen).toBeGreaterThan(0);
    expect(activeFlashes(cells, 64, 12.3, out, () => false)).toBe(0);
  });
});
