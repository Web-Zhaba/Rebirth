import { describe, expect, it } from "vitest";
import { sunDirection } from "../../sim/weather";
import { EARTH_RADIUS_M, lngLatToSphere, sphereToLngLat, weatherToSphere } from "./sphere";

const close = (a: ArrayLike<number>, b: ArrayLike<number>, eps = 1e-9) => a.length === b.length && Array.from(a).every((v, i) => Math.abs(v - b[i]) < eps);

describe("sphere frame", () => {
  it("places the cardinal points", () => {
    expect(close(lngLatToSphere(0, 0), [0, 0, 1])).toBe(true);
    expect(close(lngLatToSphere(90, 0), [1, 0, 0])).toBe(true);
    expect(close(lngLatToSphere(0, 90), [0, 1, 0])).toBe(true);
    expect(close(lngLatToSphere(180, 0), [0, 0, -1])).toBe(true);
  });
  it("scales the radius with altitude", () => {
    expect(Math.hypot(...lngLatToSphere(10, 20, EARTH_RADIUS_M))).toBeCloseTo(2, 12);
  });
  it("round-trips lng/lat/alt", () => {
    for (const [lng, lat, alt] of [[18.42, -33.92, 0], [-157.86, 21.3, 12000], [179.9, 89, 500], [-0.13, 51.5, 0]]) {
      const r = sphereToLngLat(lngLatToSphere(lng, lat, alt));
      expect(r.lng).toBeCloseTo(lng, 9);
      expect(r.lat).toBeCloseTo(lat, 9);
      expect(r.alt).toBeCloseTo(alt, 3);
    }
  });
});

describe("weather frame", () => {
  it("maps weather axes onto the same places on the sphere", () => {
    expect(close(weatherToSphere([1, 0, 0]), lngLatToSphere(0, 0))).toBe(true);
    expect(close(weatherToSphere([0, 1, 0]), lngLatToSphere(90, 0))).toBe(true);
    expect(close(weatherToSphere([0, 0, 1]), lngLatToSphere(0, 90))).toBe(true);
  });
  it("keeps the sun on its subsolar point", () => {
    const w = sunDirection(0, 0);
    const ll = sphereToLngLat(weatherToSphere(w));
    expect(ll.lat).toBeCloseTo((Math.asin(w[2]) * 180) / Math.PI, 9);
    expect(ll.lng).toBeCloseTo((Math.atan2(w[1], w[0]) * 180) / Math.PI, 9);
  });
});
