import { describe, expect, it } from "vitest";
import { enuAt, geodeticToEcef, normalize, scale, add, type Vec3 } from "../geo/ellipsoid";
import { pickGround } from "./pick";

const down = (lat: number, lng: number): Vec3 => scale(enuAt(lat, lng).up, -1);

describe("pickGround", () => {
  it("hits flat ground straight below", () => {
    const g = pickGround(geodeticToEcef(50, 10, 1000), down(50, 10), () => 0)!;
    expect(g.lat).toBeCloseTo(50, 7);
    expect(g.lng).toBeCloseTo(10, 7);
    expect(Math.abs(g.h)).toBeLessThan(0.02);
  });

  it("hits raised ground at its height", () => {
    const g = pickGround(geodeticToEcef(50, 10, 1000), down(50, 10), () => 300)!;
    expect(g.h).toBeCloseTo(300, 1);
  });

  it("hits the planet from orbit", () => {
    const g = pickGround(geodeticToEcef(0, 0, 12_000_000), down(0, 0), () => 0)!;
    expect(g.lat).toBeCloseTo(0, 5);
    expect(g.lng).toBeCloseTo(0, 5);
  });

  it("grazing ray at street level lands where geometry says", () => {
    // Eye 2 m up looking 1 m down over 100 m: the ground is ~200 m ahead.
    const e = enuAt(55, 37);
    const dir = normalize(add(scale(e.north, 100), scale(e.up, -1)));
    const g = pickGround(geodeticToEcef(55, 37, 2), dir, () => 0)!;
    const north = (g.lat - 55) * 111_000;
    expect(north).toBeGreaterThan(190);
    expect(north).toBeLessThan(210);
  });

  it("returns null for a ray into the sky", () => {
    expect(pickGround(geodeticToEcef(50, 10, 1000), enuAt(50, 10).up, () => 0)).toBeNull();
  });
});
