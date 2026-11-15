import { describe, expect, it } from "vitest";
import { enuAt, geodeticToEcef, sub, type Vec3 } from "../geo/ellipsoid";
import { transformPoint } from "../camera/projection";
import { cascadeSplits, ShadowCache, shadowCovers, shadowFade, shadowFrame, shadowMatrix, shadowStart, sliceSphere, steadyRadius, sunTolerance } from "./shadowMath";

const SIZE = 2048;
const lat = 47.27;
const lng = 11.4;
const target = geodeticToEcef(lat, lng, 600);
const eye = geodeticToEcef(lat - 0.002, lng, 900);
const enu = enuAt(lat, lng);

function sunAt(azDeg: number, elDeg: number): Vec3 {
  const az = (azDeg * Math.PI) / 180;
  const el = (elDeg * Math.PI) / 180;
  const ce = Math.cos(el);
  return [0, 1, 2].map((i) => enu.east[i] * Math.sin(az) * ce + enu.north[i] * Math.cos(az) * ce + enu.up[i] * Math.sin(el)) as Vec3;
}

const offset = (p: Vec3, east: number, north: number, up: number): Vec3 =>
  [0, 1, 2].map((i) => p[i] + enu.east[i] * east + enu.north[i] * north + enu.up[i] * up) as Vec3;

// Texel (fractional, x right, y up from the bottom) and depth a world point lands on.
function texelOf(sun: Vec3, at: Vec3, from: Vec3, p: Vec3, radius = 200): [number, number, number] {
  const f = shadowFrame(sun, at, radius, SIZE);
  const c = transformPoint(shadowMatrix(f, from), sub(p, from));
  return [((c[0] / c[3]) * 0.5 + 0.5) * SIZE, ((c[1] / c[3]) * 0.5 + 0.5) * SIZE, c[2] / c[3]];
}

describe("shadowMatrix", () => {
  it("puts the target within a texel of the map's centre, its depth range reaching further towards the sun", () => {
    const sun = sunAt(120, 35);
    const f = shadowFrame(sun, target, 200, SIZE);
    const [x, y, z] = texelOf(sun, target, eye, target);
    expect(Math.abs(x - SIZE / 2)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(y - SIZE / 2)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(z - (0.5 + (f.depth - 2 * f.radius) / 2 / f.depth))).toBeLessThan(0.01); // the depth origin snaps in coarser steps
    // a roof 500 m nearer the sun than the centre still lands in the map
    const [, , roof] = texelOf(sun, target, eye, [0, 1, 2].map((i) => target[i] + sun[i] * 500) as Vec3);
    expect(roof).toBeGreaterThan(0);
  });

  it("lands a point 100 m east of the target 100 / texel texels over, seen straight down", () => {
    const sun = enu.up;
    const f = shadowFrame(sun, target, 400, SIZE);
    const [x0, y0] = texelOf(sun, target, eye, target, 400);
    const [x1, y1] = texelOf(sun, target, eye, offset(target, 100, 0, 0), 400);
    expect(Math.hypot(x1 - x0, y1 - y0)).toBeCloseTo(100 / f.texel, 3);
  });

  it("puts what stands nearer the sun at a smaller depth", () => {
    const sun = sunAt(200, 40);
    const [, , ground] = texelOf(sun, target, eye, target);
    const [, , roof] = texelOf(sun, target, eye, offset(target, 0, 0, 10));
    expect(roof).toBeLessThan(ground);
  });

  it("moves world points only by whole texels while the camera moves (no shimmer)", () => {
    const sun = sunAt(120, 35);
    const p = offset(target, 37.3, -12.9, 4);
    const a = texelOf(sun, target, eye, p);
    for (const step of [0.013, 0.13, 1.7, 23.4]) {
      // The camera pans and the eye moves with it: the map moves by whole texels, so the point keeps its sub-texel place.
      const b = texelOf(sun, offset(target, step, step * 0.4, 0), offset(eye, step, step * 0.4, 0), p);
      for (const k of [0, 1]) expect(Math.abs(b[k] - a[k] - Math.round(b[k] - a[k]))).toBeLessThan(1e-4);
    }
  });

  it("moves the snapped origin by whole texels when the camera pans further", () => {
    const sun = sunAt(120, 35);
    const a = shadowFrame(sun, target, 200, SIZE);
    const b = shadowFrame(sun, offset(target, 25, 0, 0), 200, SIZE);
    const d = sub(b.origin, a.origin);
    const steps = [a.right, a.up].map((ax) => (d[0] * ax[0] + d[1] * ax[1] + d[2] * ax[2]) / a.texel);
    for (const s of steps) expect(Math.abs(s - Math.round(s))).toBeLessThan(1e-6);
  });
});

describe("shadowCovers", () => {
  it("takes casters inside the map's box and leaves the far ones out", () => {
    const f = shadowFrame(sunAt(120, 35), target, 400, SIZE);
    expect(shadowCovers(f, target, 1)).toBe(true);
    expect(shadowCovers(f, offset(target, 380, 0, 0), 30)).toBe(true);
    expect(shadowCovers(f, offset(target, 5000, 0, 0), 30)).toBe(false);
  });
});

describe("cascades", () => {
  it("start at the nearest ground the view sees, never at the eye", () => {
    expect(shadowStart(500, 0.5, 1, 5000)).toBeCloseTo((0.7 * 440) / 0.5, 6);
    expect(shadowStart(500, 0, 1, 5000)).toBe(20); // looking level: from the minimum
    expect(shadowStart(5000, 0.5, 1, 5000)).toBe(2000); // never past 40 % of the range
  });

  it("split the range from start to far, finer near the eye", () => {
    const s = cascadeSplits(300, 5000, 4);
    expect(s).toHaveLength(5);
    expect(s[0]).toBeCloseTo(300, 6);
    expect(s[4]).toBeCloseTo(5000, 6);
    for (let i = 1; i < 4; i++) expect(s[i + 1] - s[i]).toBeGreaterThan(s[i] - s[i - 1]);
  });

  it("enclose their slice of the view", () => {
    const tanX = 0.88;
    const tanY = 0.45;
    for (const [a, b] of [[20, 190], [300, 700], [1300, 5000]]) {
      const s = sliceSphere(a, b, tanX, tanY);
      for (const d of [a, b]) for (const sx of [-1, 1]) for (const sy of [-1, 1]) expect(Math.hypot(d * tanX * sx, d * tanY * sy, d - s.depth)).toBeLessThanOrEqual(s.radius + 1e-6);
    }
  });

  it("keep their radius while the slice changes a little, and step it otherwise", () => {
    const r = steadyRadius(700, 0);
    expect(r).toBeGreaterThanOrEqual(700);
    expect(steadyRadius(690, r)).toBe(r);
    expect(steadyRadius(r * 1.01, r)).toBeGreaterThan(r);
    expect(steadyRadius(300, r)).toBeLessThan(r);
    expect(Math.log2(steadyRadius(1234, 0)) * 8).toBeCloseTo(Math.round(Math.log2(steadyRadius(1234, 0)) * 8), 6);
  });

  it("let the sun move further on a coarse cascade and a high sun before re-rendering", () => {
    expect(sunTolerance(4, 0.5)).toBeGreaterThan(sunTolerance(0.2, 0.5));
    expect(sunTolerance(0.2, 0.5)).toBeGreaterThan(sunTolerance(0.2, 0.12));
    expect(sunTolerance(0.2, 0)).toBeGreaterThan(0);
  });
});

describe("shadowFade", () => {
  it("fades out between 900 and 2600 m above the ground, smoothly", () => {
    expect(shadowFade(100, 1)).toBe(1);
    expect(shadowFade(900, 1)).toBe(1);
    expect(shadowFade(1750, 1)).toBeCloseTo(0.5, 6);
    expect(shadowFade(2600, 1)).toBe(0);
    expect(shadowFade(1300, 1, 1024)).toBe(0); // half as far on the small map
    let prev = 1;
    for (let h = 900; h <= 2600; h += 10) {
      const f = shadowFade(h, 1);
      expect(prev - f).toBeLessThan(0.02); // no pop
      prev = f;
    }
  });

  it("is gone with the sun at the horizon", () => {
    expect(shadowFade(100, 0)).toBe(0);
    expect(shadowFade(100, 0.5)).toBe(1);
  });
});

describe("ShadowCache", () => {
  it("matches only the inputs it last stored", () => {
    const c = new ShadowCache();
    expect(c.matches([1, 0, 0])).toBe(false);
    c.store([1, 0, 0]);
    expect(c.matches([1, 0, 0])).toBe(true);
    expect(c.matches([2, 0, 0])).toBe(false);
    expect(c.matches([1, 0])).toBe(false);
    c.store([2, 0, 0]);
    expect(c.version).toBe(2);
    c.reset();
    expect(c.matches([2, 0, 0])).toBe(false);
  });
});
