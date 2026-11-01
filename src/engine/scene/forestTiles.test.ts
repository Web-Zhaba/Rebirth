import { describe, expect, it } from "vitest";
import { geodeticToEcef } from "../geo/ellipsoid";
import { tileToLngLat } from "../geo/mercator";
import { keepAt, MIN_KEEP, SCATTER_ZOOM, steadyReach, strideLevel, thinReach, tileFrame } from "./forestTiles";

describe("forest tiles", () => {
  it("keeps everything within the reach and thins to a sixteenth", () => {
    expect(keepAt(100, 500)).toBe(1);
    expect(keepAt(1000, 500)).toBe(0.5);
    expect(keepAt(1e6, 500)).toBe(MIN_KEEP);
  });

  it("strides only as far as the nearest point's keep allows", () => {
    expect(strideLevel(400, 500)).toBe(0);
    expect(strideLevel(1900, 500)).toBe(0); // keep 0.26 > 1/4
    expect(strideLevel(2100, 500)).toBe(1); // keep 0.24 <= 1/4
    expect(strideLevel(1e6, 500)).toBe(2);
    expect(strideLevel(1e6, Infinity)).toBe(0);
    for (const d of [600, 2000, 5000, 9000]) expect(4 ** -strideLevel(d, 500)).toBeGreaterThanOrEqual(keepAt(d, 500));
  });

  it("finds the reach that fits the budget, everything when it fits", () => {
    const tiles = Array.from({ length: 40 }, (_, i) => ({ n: 1000, d: 200 + i * 300 }));
    expect(thinReach(tiles, 1e9, 450)).toBe(Infinity);
    const r = thinReach(tiles, 15000, 450);
    const total = tiles.reduce((a, t) => a + (t.d < 450 ? t.n : t.n * keepAt(t.d, r)), 0);
    expect(total).toBeLessThanOrEqual(15000);
    expect(total).toBeGreaterThan(14900);
  });

  it("moves the reach in steps, only past a band", () => {
    const r = steadyReach(Infinity, 1000);
    expect(r).toBeLessThanOrEqual(1000);
    expect(steadyReach(r, r * 1.2)).toBe(r);
    expect(steadyReach(r, r * 1.5)).toBeGreaterThan(r);
    expect(steadyReach(r, Infinity)).toBe(Infinity);
  });

  it("maps a tile onto a flat square that meets its corners", () => {
    const x = 18_700;
    const y = 10_900;
    const t = tileFrame(x, y);
    for (const [u, v] of [
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 1],
    ]) {
      const ll = tileToLngLat(SCATTER_ZOOM, x, y, u, v);
      const e = geodeticToEcef(ll.lat, ll.lng, 0);
      const p = [0, 1, 2].map((i) => t.centre[i] + (u - 0.5) * t.east[i] + (v - 0.5) * t.south[i]);
      expect(Math.hypot(p[0] - e[0], p[1] - e[1], p[2] - e[2])).toBeLessThan(0.05);
    }
  });
});
