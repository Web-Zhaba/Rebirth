import { describe, expect, it } from "vitest";
import { iceOpacity, overcastOpacity, precipDensity, precipSlant, precipVisibility, snowOpacity, sunAzimuth, weatherCoverVisibility } from "./weatherMath";

const RAD = Math.PI / 180;

const sunAt = (lat: number, lng: number): [number, number, number] => [
  Math.cos(lat * RAD) * Math.cos(lng * RAD),
  Math.cos(lat * RAD) * Math.sin(lng * RAD),
  Math.sin(lat * RAD),
];

describe("snow cover", () => {
  it("stays invisible below a dusting and saturates at 0.4 m", () => {
    expect(snowOpacity(-1)).toBe(0);
    expect(snowOpacity(0)).toBe(0);
    expect(snowOpacity(0.009)).toBe(0);
    expect(snowOpacity(0.01)).toBe(0);
    expect(snowOpacity(0.4)).toBeCloseTo(0.5, 12);
    expect(snowOpacity(1)).toBeCloseTo(0.5, 12);
  });

  it("rises smoothly and monotonically between the thresholds", () => {
    let prev = snowOpacity(0.01);
    for (let m = 0.02; m <= 0.45; m += 0.01) {
      const cur = snowOpacity(m);
      expect(cur).toBeGreaterThanOrEqual(prev);
      expect(cur).toBeLessThanOrEqual(0.5);
      prev = cur;
    }
    expect(snowOpacity(0.2)).toBeGreaterThan(0);
    expect(snowOpacity(0.2)).toBeLessThan(0.5);
  });
});

describe("ice cover", () => {
  it("stays invisible below 0.15 and saturates at 0.8", () => {
    expect(iceOpacity(0)).toBe(0);
    expect(iceOpacity(0.149)).toBe(0);
    expect(iceOpacity(0.15)).toBe(0);
    expect(iceOpacity(0.8)).toBeCloseTo(0.55, 12);
    expect(iceOpacity(1)).toBeCloseTo(0.55, 12);
  });

  it("rises smoothly and monotonically", () => {
    let prev = iceOpacity(0.15);
    for (let v = 0.16; v <= 0.85; v += 0.01) {
      const cur = iceOpacity(v);
      expect(cur).toBeGreaterThanOrEqual(prev);
      expect(cur).toBeLessThanOrEqual(0.55);
      prev = cur;
    }
    expect(iceOpacity(0.5)).toBeGreaterThan(0);
    expect(iceOpacity(0.5)).toBeLessThan(0.55);
  });
});

describe("overcast haze", () => {
  it("is zero on a clear dry day and never above 0.12", () => {
    expect(overcastOpacity(0, 0)).toBe(0);
    for (const cloud of [0, 0.25, 0.5, 0.75, 1]) {
      for (const precip of [0, 0.1, 1, 3, 10]) expect(overcastOpacity(cloud, precip)).toBeLessThanOrEqual(0.12);
    }
    expect(overcastOpacity(1, 3)).toBeCloseTo(0.12, 12);
  });

  it("thickens with cloud and a little more with rain", () => {
    expect(overcastOpacity(0.7, 0)).toBeGreaterThan(overcastOpacity(0.3, 0));
    expect(overcastOpacity(0.7, 2)).toBeGreaterThan(overcastOpacity(0.7, 0));
    expect(overcastOpacity(1, 0)).toBeLessThan(overcastOpacity(1, 3));
  });
});

describe("precipitation", () => {
  it("needs a real rain rate before particles appear", () => {
    expect(precipDensity(0)).toBe(0);
    expect(precipDensity(0.049)).toBe(0);
    expect(precipDensity(0.05)).toBe(0);
    expect(precipDensity(3)).toBeCloseTo(1, 12);
    expect(precipDensity(10)).toBeCloseTo(1, 12);
  });

  it("density rises monotonically", () => {
    let prev = precipDensity(0.05);
    for (let p = 0.1; p <= 3; p += 0.1) {
      const cur = precipDensity(p);
      expect(cur).toBeGreaterThanOrEqual(prev);
      prev = cur;
    }
    expect(precipDensity(1)).toBeGreaterThan(0);
    expect(precipDensity(1)).toBeLessThan(1);
  });

  it("slant follows the wind and clamps", () => {
    expect(precipSlant(0)).toBe(0);
    expect(precipSlant(5)).toBeGreaterThan(0);
    expect(precipSlant(-5)).toBeLessThan(0);
    expect(precipSlant(100)).toBe(1.2);
    expect(precipSlant(-100)).toBe(-1.2);
  });

  it("visibility is a town-zoom ramp", () => {
    expect(precipVisibility(1)).toBe(0);
    expect(precipVisibility(8.4)).toBe(0);
    expect(precipVisibility(8.5)).toBe(0);
    expect(precipVisibility(11.5)).toBeCloseTo(1, 12);
    expect(precipVisibility(14.5)).toBe(1);
    expect(precipVisibility(10)).toBeGreaterThan(0);
    expect(precipVisibility(10)).toBeLessThan(1);
  });
});

describe("ground cover visibility", () => {
  it("is off on the globe and full at town zoom", () => {
    expect(weatherCoverVisibility(1)).toBe(0);
    expect(weatherCoverVisibility(6.5)).toBe(0);
    expect(weatherCoverVisibility(9)).toBeCloseTo(1, 12);
    expect(weatherCoverVisibility(14.5)).toBe(1);
    expect(weatherCoverVisibility(7.5)).toBeGreaterThan(0);
    expect(weatherCoverVisibility(7.5)).toBeLessThan(1);
  });
});

describe("sun azimuth", () => {
  it("points east and west when the subsolar point is due east or west", () => {
    expect(sunAzimuth(sunAt(0, 90), 0, 0)).toBeCloseTo(90, 9);
    expect(sunAzimuth(sunAt(0, -90), 0, 0)).toBeCloseTo(270, 9);
  });

  it("points north when the sun is due north of the point", () => {
    expect(sunAzimuth(sunAt(45, 0), 0, 0)).toBeCloseTo(0, 9);
    expect(sunAzimuth(sunAt(-45, 0), 0, 0)).toBeCloseTo(180, 9);
  });

  it("accounts for the point's own longitude", () => {
    expect(sunAzimuth(sunAt(0, 0), 90, 0)).toBeCloseTo(270, 9);
    expect(sunAzimuth(sunAt(0, 0), -90, 0)).toBeCloseTo(90, 9);
  });

  it("stays in 0..360", () => {
    for (const lng of [-170, -90, -10, 0, 37, 90, 170]) {
      for (const lat of [-60, -20, 0, 30, 70]) {
        const az = sunAzimuth(sunAt(10, 45), lng, lat);
        expect(az).toBeGreaterThanOrEqual(0);
        expect(az).toBeLessThan(360);
      }
    }
  });
});
