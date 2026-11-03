import { describe, expect, it } from "vitest";
import { enuAt, geodeticToEcef, sub, type Vec3 } from "../geo/ellipsoid";
import { transformPoint } from "../camera/projection";
import { ShadowCache, shadowCovers, shadowFade, shadowFrame, shadowMatrix, shadowRadius, steppedSun, SUN_STEP } from "./shadowMath";

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
  it("puts the target within a texel of the map's centre, at mid depth", () => {
    const [x, y, z] = texelOf(sunAt(120, 35), target, eye, target);
    expect(Math.abs(x - SIZE / 2)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(y - SIZE / 2)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(z - 0.5)).toBeLessThan(0.01); // the depth origin snaps in coarser steps
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

describe("shadowRadius / shadowFade", () => {
  it("grows in steps with the camera's distance", () => {
    expect(shadowRadius(100)).toBe(200);
    expect(shadowRadius(300)).toBe(400);
    expect(shadowRadius(900)).toBe(800);
  });

  it("fades out between 400 and 1200 m above the ground, smoothly", () => {
    expect(shadowFade(100, 1)).toBe(1);
    expect(shadowFade(400, 1)).toBe(1);
    expect(shadowFade(800, 1)).toBeCloseTo(0.5, 6);
    expect(shadowFade(1200, 1)).toBe(0);
    let prev = 1;
    for (let h = 400; h <= 1200; h += 10) {
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

describe("steppedSun", () => {
  it("holds the sun until it moved more than SUN_STEP", () => {
    const a = sunAt(120, 35);
    expect(steppedSun(null, a)).toBe(a);
    const small = sunAt(120 + ((SUN_STEP * 0.5) / Math.PI) * 180, 35);
    expect(steppedSun(a, small)).toBe(a);
    const big = sunAt(120 + ((SUN_STEP * 3) / Math.PI) * 180, 35);
    expect(steppedSun(a, big)).toBe(big);
  });
});

describe("ShadowCache", () => {
  it("is stale when the sun, the terrain, the town or the view change, and on nothing else", () => {
    const c = new ShadowCache();
    const inputs = (sun: number, ground: number, town: number, view: number) => [sun, ground, town, view];
    expect(c.stale(inputs(1, 0, 0, 0))).toBe(true);
    expect(c.stale(inputs(1, 0, 0, 0))).toBe(false);
    expect(c.stale(inputs(2, 0, 0, 0))).toBe(true);
    expect(c.stale(inputs(2, 1, 0, 0))).toBe(true);
    expect(c.stale(inputs(2, 1, 1, 0))).toBe(true);
    expect(c.stale(inputs(2, 1, 1, 1))).toBe(true);
    expect(c.stale(inputs(2, 1, 1, 1))).toBe(false);
    expect(c.version).toBe(5);
    c.reset();
    expect(c.stale(inputs(2, 1, 1, 1))).toBe(true);
  });
});
