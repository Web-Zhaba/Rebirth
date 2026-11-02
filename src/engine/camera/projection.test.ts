import { describe, expect, it } from "vitest";
import { buildView, cameraAxes, defaultCamera, nearPlane } from "./camera";
import { length, dot, ecefToGeodetic } from "../geo/ellipsoid";
import { perspectiveReversedInfinite, transformPoint } from "./projection";

const depthAt = (m: Float64Array, zView: number) => {
  const c = transformPoint(m, [0, 0, zView]);
  return c[2] / c[3];
};

describe("reversed-Z infinite projection", () => {
  const m = perspectiveReversedInfinite((36.87 * Math.PI) / 180, 16 / 9, 0.1);

  it("maps the near plane to 1 and infinity to 0", () => {
    expect(depthAt(m, -0.1)).toBeCloseTo(1, 12);
    expect(depthAt(m, -1e30)).toBeLessThan(1e-28);
  });

  it("is monotonic and stays inside 0..1 from street level to the far side of the planet", () => {
    let prev = 2;
    for (const z of [0.1, 1, 20, 1e3, 1e5, 1e7, 4e7]) {
      const d = depthAt(m, -z);
      expect(d).toBeLessThan(prev);
      expect(d).toBeGreaterThan(0);
      prev = d;
    }
  });

  it("keeps x/y like an ordinary perspective", () => {
    const f = 1 / Math.tan((36.87 * Math.PI) / 360);
    const c = transformPoint(m, [0, 1, -1]);
    expect(c[1] / c[3]).toBeCloseTo(f, 12);
  });
});

describe("camera", () => {
  it("looks straight down at pitch 0 and keeps the eye `distance` above the target", () => {
    const s = { ...defaultCamera(), lat: 60, lng: 179.99, h: 0, distance: 1000, pitch: 0 };
    const a = cameraAxes(s);
    expect(ecefToGeodetic(a.eye).h).toBeCloseTo(1000, 6);
    const up = a.target.map((v) => v / length(a.target));
    expect(dot(a.forward, up as [number, number, number])).toBeLessThan(-0.99);
  });

  it("has orthonormal axes at any heading and pitch", () => {
    for (const heading of [0, 90, 233])
      for (const pitch of [0, 45, 80]) {
        const a = cameraAxes({ ...defaultCamera(), heading, pitch, distance: 50 });
        for (const v of [a.right, a.up, a.forward]) expect(length(v)).toBeCloseTo(1, 12);
        expect(dot(a.right, a.up)).toBeCloseTo(0, 12);
        expect(dot(a.right, a.forward)).toBeCloseTo(0, 12);
        expect(dot(a.up, a.forward)).toBeCloseTo(0, 12);
      }
  });

  it("puts the target at the screen centre with depth in 0..1", () => {
    const s = { ...defaultCamera(), lat: 47.27, lng: 11.4, h: 900, distance: 9000, heading: 30, pitch: 75 };
    const v = buildView(s, 1280, 720, () => 900);
    const rel = [v.target[0] - v.eye[0], v.target[1] - v.eye[1], v.target[2] - v.eye[2]];
    const c = transformPoint(v.viewProj, rel);
    expect(c[0] / c[3]).toBeCloseTo(0, 9);
    expect(c[1] / c[3]).toBeCloseTo(0, 9);
    expect(c[2] / c[3]).toBeGreaterThan(0);
    expect(c[2] / c[3]).toBeLessThan(1);
  });

  it("scales the near plane with height above ground, never below 0.1 m", () => {
    expect(nearPlane(2)).toBe(0.1);
    expect(nearPlane(-5)).toBe(0.1);
    expect(nearPlane(12_000_000)).toBe(240_000);
  });
});
