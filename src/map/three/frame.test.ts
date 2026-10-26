import { describe, expect, it } from "vitest";
import { sunDirection } from "../../sim/weather";
import {
  EARTH_RADIUS_M,
  invert4,
  lngLatToMercator,
  lngLatToSphere,
  mercatorLocalMatrix,
  mercatorToLngLat,
  rayFromNdc,
  rayGround,
  raySphere,
  sphereToLngLat,
  transformPoint,
  weatherToSphere,
} from "./frame";

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

describe("mercator", () => {
  it("round-trips", () => {
    const m = lngLatToMercator(30.3, 59.9);
    const ll = mercatorToLngLat(m[0], m[1]);
    expect(ll.lng).toBeCloseTo(30.3, 9);
    expect(ll.lat).toBeCloseTo(59.9, 9);
    expect(close(lngLatToMercator(0, 0), [0.5, 0.5])).toBe(true);
  });
});

describe("mercator local matrix", () => {
  it("equals main applied to the mercator point", () => {
    const main = Array.from({ length: 16 }, (_, i) => Math.sin(i * 1.7 + 0.3) + (i % 5 === 0 ? 3 : 0));
    const origin: [number, number] = [0.531, 0.337];
    const s = 2.5e7;
    const local = mercatorLocalMatrix(main, origin, s);
    const a = transformPoint(local, [120, -340, 55]);
    const b = transformPoint(main, [origin[0] + 120 / s, origin[1] + 340 / s, 55 / s]);
    expect(close(a, b, 1e-9)).toBe(true);
  });
});

describe("matrices and rays", () => {
  // perspective matrix, camera at z = 3 looking at the origin
  const f = 1 / Math.tan(0.4);
  const n = 0.1;
  const fr = 10;
  const proj = [f, 0, 0, 0, 0, f, 0, 0, 0, 0, (fr + n) / (n - fr), -1, 0, 0, (2 * fr * n) / (n - fr), 0];
  const view = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, -3, 1];
  const mul = (a: number[], b: number[]) => {
    const o = new Array<number>(16).fill(0);
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
    return o;
  };
  const vp = mul(proj, view);
  it("inverts", () => {
    const inv = invert4(vp)!;
    const id = mul(Array.from(inv), vp);
    for (let i = 0; i < 16; i++) expect(id[i]).toBeCloseTo(i % 5 === 0 ? 1 : 0, 9);
  });
  it("casts a screen-centre ray that hits the unit sphere at its nearest point", () => {
    const inv = invert4(vp)!;
    const { origin, dir } = rayFromNdc(inv, 0, 0);
    const t = raySphere(origin, dir, 1)!;
    expect(close([origin[0] + dir[0] * t, origin[1] + dir[1] * t, origin[2] + dir[2] * t], [0, 0, 1])).toBe(true);
    const p = transformPoint(vp, [0, 0, 1]);
    expect(Math.abs(p[0]) + Math.abs(p[1])).toBeLessThan(1e-9);
  });
  it("misses outside the disc", () => {
    const inv = invert4(vp)!;
    const { origin, dir } = rayFromNdc(inv, 0.99, 0.99);
    expect(raySphere(origin, dir, 1)).toBeNull();
  });
  it("hits the ground plane", () => {
    expect(close(rayGround([0, 0, 10], [0.6, 0, -0.8])!, [7.5, 0, 0])).toBe(true);
    expect(rayGround([0, 0, 10], [1, 0, 0])).toBeNull();
  });
});
