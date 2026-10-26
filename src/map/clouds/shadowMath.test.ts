import { describe, expect, it } from "vitest";
import { sunDirection, TUNING } from "../../sim/weather";
import { CLOUD_BASE_M, CLOUD_TOP_M, GLOBE_EXAGGERATION } from "./constants";
import { EARTH_RADIUS_M, invert4, lngLatToSphere, rayFromNdc, sphereToLngLat, weatherToSphere, type Vec3 } from "./frame";
import {
  blendDrift,
  darkening,
  DRIFT_DEG,
  driftPhases,
  noiseDetail,
  rayBasis,
  localFrame,
  localToDirection,
  OVERCAST_MAX,
  rotatePolar,
  SHADOW_HEIGHT_M,
  SHADOW_MAX,
  shadowHeight,
  sunLocal,
  sunOffsetLocal,
  sunOffsetM,
  sunStrength,
} from "./shadowMath";

const RAD = Math.PI / 180;
const sinDeg = (d: number) => Math.sin(d * RAD);

describe("sun offset", () => {
  it("is height / tan(elevation)", () => {
    for (const el of [10, 30, 45, 60, 85]) expect(sunOffsetM(sinDeg(el), 6500)).toBeCloseTo(6500 / Math.tan(el * RAD), 6);
  });
  it("is zero when the sun is at or below 3 degrees", () => {
    expect(sunOffsetM(sinDeg(3), 6500)).toBe(0);
    expect(sunOffsetM(sinDeg(-20), 6500)).toBe(0);
    expect(sunOffsetM(sinDeg(2.9), 6500)).toBe(0);
    expect(sunOffsetM(sinDeg(3.5), 6500)).toBeGreaterThan(0);
  });
  it("sun strength fades 3..12 degrees and is zero at night", () => {
    expect(sunStrength(sinDeg(-30))).toBe(0);
    expect(sunStrength(sinDeg(3))).toBe(0);
    expect(sunStrength(sinDeg(12))).toBeCloseTo(1, 9);
    expect(sunStrength(sinDeg(90))).toBe(1);
    expect(sunStrength(sinDeg(7))).toBeGreaterThan(0);
    expect(sunStrength(sinDeg(7))).toBeLessThan(1);
  });
  it("points toward the sun azimuth in the local frame", () => {
    // at (0E, 0N): east is +x, north +y, up +z. A sun 45 degrees up in the north-east.
    const f = localFrame(0, 0);
    const el = 45 * RAD;
    const az = 30 * RAD; // from north toward east
    const sun: Vec3 = [Math.cos(el) * Math.sin(az), Math.cos(el) * Math.cos(az), Math.sin(el)]; // east, north, up in (x, y, z)? no: map the frame
    const world: Vec3 = [
      sun[0] * f.e[0] + sun[1] * f.n[0] + sun[2] * f.o[0],
      sun[0] * f.e[1] + sun[1] * f.n[1] + sun[2] * f.o[1],
      sun[0] * f.e[2] + sun[1] * f.n[2] + sun[2] * f.o[2],
    ];
    const [e, n] = sunOffsetLocal(world, f, 1000);
    expect(Math.hypot(e, n)).toBeCloseTo(1000 / Math.tan(el), 6);
    expect(Math.atan2(e, n)).toBeCloseTo(az, 9);
  });
  it("is [0, 0] with the sun down", () => {
    const f = localFrame(10, 50);
    const down: Vec3 = [-f.o[0], -f.o[1], -f.o[2]];
    expect(sunOffsetLocal(down, f, 6500)).toEqual([0, 0]);
  });
  it("a real sun direction: noon at the subsolar point gives no offset, night gives zero strength", () => {
    const sun = weatherToSphere(sunDirection(0, 0));
    const ll = sphereToLngLat(sun);
    const f = localFrame(ll.lng, ll.lat);
    expect(sunLocal(sun, f).sinElev).toBeCloseTo(1, 9);
    const anti = lngLatToSphere(ll.lng + 180, -ll.lat);
    expect(sunStrength(sunLocal(sun, localFrame(ll.lng + 180, -ll.lat)).sinElev)).toBe(0);
    expect(anti).toHaveLength(3);
  });
});

describe("height", () => {
  it("is the mid layer, stretched on the globe and real from the fade end", () => {
    expect(SHADOW_HEIGHT_M).toBe((CLOUD_BASE_M + CLOUD_TOP_M) / 2);
    expect(shadowHeight(2)).toBeCloseTo(SHADOW_HEIGHT_M * GLOBE_EXAGGERATION, 6);
    expect(shadowHeight(6.5)).toBeCloseTo(SHADOW_HEIGHT_M, 6);
    expect(shadowHeight(12)).toBeCloseTo(SHADOW_HEIGHT_M, 6);
    expect(shadowHeight(5.7)).toBeLessThan(shadowHeight(5.2));
  });
});

describe("local frame", () => {
  it("is orthonormal and east/north point the right way", () => {
    const f = localFrame(37, 55);
    const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    expect(dot(f.o, f.e)).toBeCloseTo(0, 12);
    expect(dot(f.o, f.n)).toBeCloseTo(0, 12);
    expect(dot(f.e, f.n)).toBeCloseTo(0, 12);
    const e = sphereToLngLat(localToDirection(f, 1000, 0));
    expect(e.lng).toBeGreaterThan(37);
    expect(e.lat).toBeCloseTo(55, 2);
    const n = sphereToLngLat(localToDirection(f, 0, 1000));
    expect(n.lat).toBeGreaterThan(55);
  });
  it("maps metres to the sphere", () => {
    const f = localFrame(10, 0);
    const d = localToDirection(f, 0, 5000);
    expect(sphereToLngLat(d).lat * RAD * EARTH_RADIUS_M).toBeCloseTo(5000, 0);
  });
});

describe("drift", () => {
  const P = TUNING.layerDays;
  it("weights are normalised", () => {
    for (const d of [0.3, 5, 11.9, 12, 17.4, 23.99, 100.2]) {
      const ph = driftPhases(d);
      expect(ph[0].w ** 2 + ph[1].w ** 2).toBeCloseTo(1, 9);
    }
  });
  it("each layer vanishes exactly when it restarts, so its epoch offset can change", () => {
    const eps = 1e-6;
    // layer 0 restarts at days = P: before, tau ~ P and w ~ 0; after, tau ~ 0 and w ~ 0
    const before = driftPhases(P - eps);
    const after = driftPhases(P + eps);
    expect(Math.abs(before[0].w)).toBeLessThan(1e-4);
    expect(Math.abs(after[0].w)).toBeLessThan(1e-4);
    expect(before[0].off).not.toEqual(after[0].off);
    // the other layer carries the blend there
    expect(Math.abs(before[1].w)).toBeCloseTo(1, 6);
    expect(before[1].off).toEqual(after[1].off);
  });
  it("the blended value is continuous across epochs and keeps the variance (both layers equal -> same value)", () => {
    const eps = 1e-6;
    for (const edge of [P, 2 * P, P / 2, 1.5 * P]) {
      const a = driftPhases(edge - eps);
      const b = driftPhases(edge + eps);
      // layer samples: the layer that is not restarting keeps its sample; the restarting one has weight ~0
      const sampleOld = [0.8, 0.3];
      const keep = Math.abs(a[0].w) < 1e-3 ? 1 : 0;
      const va = blendDrift(0.5, 0.5, a);
      const vb = blendDrift(0.5, 0.5, b);
      expect(vb).toBeCloseTo(va, 6);
      const s: [number, number] = [0.5, 0.5];
      s[keep] = sampleOld[keep];
      expect(blendDrift(s[0], s[1], b)).toBeCloseTo(blendDrift(s[0], s[1], a), 3);
    }
  });
  it("tau grows by one per day and the weights never leave 0..1", () => {
    const a = driftPhases(3);
    const b = driftPhases(4);
    expect(b[0].tau - a[0].tau).toBeCloseTo(1, 9);
    expect(b[1].tau - a[1].tau).toBeCloseTo(1, 9);
    for (let d = 0; d < 60; d += 0.37) for (const p of driftPhases(d)) expect(p.w).toBeGreaterThanOrEqual(0);
  });
  it("drifts at the westerly rate of the model", () => {
    expect(DRIFT_DEG).toBe(TUNING.windDeg);
  });
  it("kilometre noise fades out when a pixel is wide", () => {
    expect(noiseDetail(20)).toBe(1);
    expect(noiseDetail(10000)).toBe(0);
    expect(noiseDetail(500)).toBeGreaterThan(0);
    expect(noiseDetail(500)).toBeLessThan(1);
    expect(darkening(0.6, 1, 0.1, 1, 0)).toBeCloseTo(darkening(0.6, 1, 0.9, 1, 0), 9);
  });
  it("polar rotation moves a point eastward by the angle", () => {
    const p = lngLatToSphere(20, 40);
    const q = sphereToLngLat(rotatePolar(p, 15 * RAD));
    expect(q.lng).toBeCloseTo(35, 9);
    expect(q.lat).toBeCloseTo(40, 9);
  });
});

describe("darkening", () => {
  it("clear sky and night give nothing", () => {
    expect(darkening(0, 1, 0.9, 1)).toBe(0);
    expect(darkening(0.8, 1, 0.9, 0)).toBe(0);
  });
  it("overcast sheet dims evenly by OVERCAST_MAX at most; noise does not matter", () => {
    expect(darkening(1, 0, 0.1, 1)).toBeCloseTo(OVERCAST_MAX, 9);
    expect(darkening(1, 0, 0.9, 1)).toBeCloseTo(OVERCAST_MAX, 9);
  });
  it("cumulus gives patches: shadow under high noise, none under low", () => {
    const lit = darkening(0.5, 1, 0.1, 1);
    const shaded = darkening(0.5, 1, 0.95, 1);
    expect(lit).toBeLessThan(0.01);
    expect(shaded).toBeGreaterThan(SHADOW_MAX * 0.9);
    expect(darkening(1, 1, 0.5, 1)).toBeCloseTo(SHADOW_MAX + OVERCAST_MAX, 9);
  });
  it("more cover shades more of the noise", () => {
    expect(darkening(0.8, 1, 0.4, 1)).toBeGreaterThan(darkening(0.3, 1, 0.4, 1));
  });
});

describe("ray basis", () => {
  // column-major perspective * lookAt, built by hand: eye looks at the origin from (0.3, 0.2, 2.5), fov 40 deg, aspect 1.5
  const mul = (a: number[], b: number[]) => {
    const o = new Array(16).fill(0);
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
    return o;
  };
  const f = 1 / Math.tan((40 * RAD) / 2), asp = 1.5, n = 0.01, fa = 10;
  const proj = [f / asp, 0, 0, 0, 0, f, 0, 0, 0, 0, (fa + n) / (n - fa), -1, 0, 0, (2 * fa * n) / (n - fa), 0];
  const eye = [0.3, 0.2, 2.5];
  const zAxis = (() => { const l = Math.hypot(...eye); return eye.map((v) => v / l); })();
  const xAxis = (() => { const up = [0, 1, 0]; const x = [up[1] * zAxis[2] - up[2] * zAxis[1], up[2] * zAxis[0] - up[0] * zAxis[2], up[0] * zAxis[1] - up[1] * zAxis[0]]; const l = Math.hypot(...x); return x.map((q) => q / l); })();
  const yAxis = [zAxis[1] * xAxis[2] - zAxis[2] * xAxis[1], zAxis[2] * xAxis[0] - zAxis[0] * xAxis[2], zAxis[0] * xAxis[1] - zAxis[1] * xAxis[0]];
  const dotv = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const view = [xAxis[0], yAxis[0], zAxis[0], 0, xAxis[1], yAxis[1], zAxis[1], 0, xAxis[2], yAxis[2], zAxis[2], 0, -dotv(xAxis, eye), -dotv(yAxis, eye), -dotv(zAxis, eye), 1];
  const m = mul(proj, view);
  const inv = invert4(m)!;
  it("matches the plain per-pixel unprojection", () => {
    const rb = rayBasis(inv)!;
    expect(rb.cam[0]).toBeCloseTo(eye[0], 9);
    expect(rb.cam[2]).toBeCloseTo(eye[2], 9);
    for (const [x, y] of [[0, 0], [0.7, -0.4], [-0.9, 0.9], [1, 1]]) {
      const ref = rayFromNdc(inv, x, y);
      const d: Vec3 = [rb.a[0] + x * rb.b[0] + y * rb.c[0], rb.a[1] + x * rb.b[1] + y * rb.c[1], rb.a[2] + x * rb.b[2] + y * rb.c[2]];
      const l = Math.hypot(...d);
      for (let i = 0; i < 3; i++) expect(d[i] / l).toBeCloseTo(ref.dir[i], 9);
    }
  });
});
