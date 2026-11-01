import { describe, expect, it } from "vitest";
import { cross, dot, ecefToGeodetic, enuAt, geodeticToEcef, length, WGS84_A, WGS84_B } from "./ellipsoid";

describe("WGS84", () => {
  it("puts the equator at a and the poles at b", () => {
    expect(geodeticToEcef(0, 0, 0)).toEqual([WGS84_A, 0, 0]);
    const p = geodeticToEcef(90, 0, 0);
    expect(p[2]).toBeCloseTo(WGS84_B, 6);
    expect(Math.abs(p[0])).toBeLessThan(1e-6);
  });

  it("round-trips geodetic <-> ECEF to well under a millimetre, ground to orbit", () => {
    for (const lat of [-89.9, -60, -12.3, 0, 0.001, 47.2692, 60, 85, 89.99])
      for (const lng of [-179.99, -45, 0, 11.4041, 179.99])
        for (const h of [-400, 0, 1.5, 2500, 400_000, 20_000_000]) {
          const g = ecefToGeodetic(geodeticToEcef(lat, lng, h));
          expect(Math.abs(g.lat - lat)).toBeLessThan(1e-9);
          if (Math.abs(lat) < 89.9) expect(Math.abs(((g.lng - lng + 540) % 360) - 180)).toBeLessThan(1e-9);
          expect(Math.abs(g.h - h)).toBeLessThan(1e-4);
        }
  });

  it("gives an orthonormal right-handed ENU whose up is the ellipsoid normal", () => {
    for (const [lat, lng] of [[60, 179.99], [0, 0], [-33.9, 151.2]]) {
      const e = enuAt(lat, lng);
      for (const v of [e.east, e.north, e.up]) expect(length(v)).toBeCloseTo(1, 12);
      expect(dot(e.east, e.north)).toBeCloseTo(0, 12);
      expect(dot(e.east, e.up)).toBeCloseTo(0, 12);
      const c = cross(e.east, e.north);
      for (let i = 0; i < 3; i++) expect(c[i]).toBeCloseTo(e.up[i], 12);
      // Moving 1 m along up changes h by 1 m and nothing else.
      const p = geodeticToEcef(lat, lng, 100);
      const g = ecefToGeodetic([p[0] + e.up[0], p[1] + e.up[1], p[2] + e.up[2]]);
      expect(g.h).toBeCloseTo(101, 6);
      expect(g.lat).toBeCloseTo(lat, 9);
    }
  });
});
