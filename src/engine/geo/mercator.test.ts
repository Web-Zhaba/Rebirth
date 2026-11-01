import { describe, expect, it } from "vitest";
import { lngLatToTile as worldTile } from "../../world/mercator";
import { keyToTile, lngLatToTile, MAX_MERCATOR_LAT, tileAt, tileBounds, tileKey, tileToLngLat } from "./mercator";

describe("web mercator tiles", () => {
  it("matches the game's tile maths", () => {
    for (const [lng, lat] of [[11.4041, 47.2692], [-179.99, 60], [37.5, 59.2], [0, 0]])
      for (const z of [0, 5, 11, 17]) {
        const a = lngLatToTile(lng, lat, z);
        const b = worldTile(lng, lat, z);
        expect(a.x).toBeCloseTo(b.x, 9);
        expect(a.y).toBeCloseTo(b.y, 9);
      }
  });

  it("round-trips a point through tile coordinates", () => {
    for (const z of [0, 3, 11, 17]) {
      const t = lngLatToTile(179.99, 60, z);
      const tx = Math.floor(t.x);
      const ty = Math.floor(t.y);
      const p = tileToLngLat(z, tx, ty, t.x - tx, t.y - ty);
      expect(p.lng).toBeCloseTo(179.99, 9);
      expect(p.lat).toBeCloseTo(60, 9);
    }
  });

  it("covers the square world", () => {
    const b = tileBounds(0, 0, 0);
    expect(b.west).toBe(-180);
    expect(b.east).toBe(180);
    expect(b.north).toBeCloseTo(MAX_MERCATOR_LAT, 9);
    expect(b.south).toBeCloseTo(-MAX_MERCATOR_LAT, 9);
  });

  it("wraps x and clamps y", () => {
    expect(tileAt(180, 0, 2).x).toBe(0);
    expect(tileAt(-180, 0, 2).x).toBe(0);
    expect(tileAt(0, 89.9, 3).y).toBe(0);
    expect(tileAt(0, -89.9, 3).y).toBe(7);
  });

  it("packs keys losslessly up to z20", () => {
    for (const [z, x, y] of [[0, 0, 0], [11, 2047, 1023], [17, 131071, 5], [20, 2 ** 20 - 1, 2 ** 20 - 1]]) {
      expect(keyToTile(tileKey(z, x, y))).toEqual({ z, x, y });
    }
  });
});
