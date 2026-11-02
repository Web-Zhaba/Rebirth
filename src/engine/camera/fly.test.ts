import { describe, expect, it } from "vitest";
import { angleDelta, flyDuration, flyPath, groundDistance, slerpLatLng } from "./fly";

describe("flyPath", () => {
  it("starts and ends at the given widths and ground fractions", () => {
    const p = flyPath(1000, 500, 20_000);
    expect(p.at(0).w).toBeCloseTo(1000, 6);
    expect(p.at(0).frac).toBeCloseTo(0, 9);
    expect(p.at(1).w).toBeCloseTo(500, 4);
    expect(p.at(1).frac).toBeCloseTo(1, 6);
  });
  it("zooms out on a long hop and the fraction rises monotonically", () => {
    const p = flyPath(2000, 2000, 500_000);
    let peak = 0;
    let prev = -1;
    for (let i = 0; i <= 100; i++) {
      const s = p.at(i / 100);
      peak = Math.max(peak, s.w);
      expect(s.frac).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = s.frac;
    }
    expect(peak).toBeGreaterThan(20_000);
  });
  it("pure zoom degenerates to an exponential", () => {
    const p = flyPath(1000, 250, 0);
    expect(p.at(1).w).toBeCloseTo(250, 6);
    expect(p.at(0.5).w).toBeCloseTo(500, 3);
  });
  it("durations scale with distance and are bounded", () => {
    const short = flyPath(1000, 1000, 100).S;
    const long = flyPath(1000, 1000, 5_000_000).S;
    expect(flyDuration(long)).toBeGreaterThan(flyDuration(short));
    expect(flyDuration(0)).toBe(400);
    expect(flyDuration(1e6)).toBe(6500);
  });
});

describe("sphere helpers", () => {
  it("measures a degree of latitude", () => {
    expect(groundDistance(0, 0, 1, 0)).toBeCloseTo(111_195, -2);
  });
  it("slerp hits ends and midpoint on the equator", () => {
    expect(slerpLatLng(0, 0, 0, 90, 0.5).lng).toBeCloseTo(45, 9);
    const e = slerpLatLng(10, 20, 30, 40, 1);
    expect(e.lat).toBeCloseTo(30, 9);
    expect(e.lng).toBeCloseTo(40, 9);
  });
  it("takes the short way over the antimeridian", () => {
    expect(Math.abs(slerpLatLng(0, 170, 0, -170, 0.5).lng)).toBeCloseTo(180, 6);
    expect(angleDelta(350, 10)).toBe(20);
    expect(angleDelta(10, 350)).toBe(-20);
  });
});
