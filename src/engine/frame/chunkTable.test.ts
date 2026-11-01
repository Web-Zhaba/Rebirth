import { describe, expect, it } from "vitest";
import { ecefToGeodetic, enuAt, geodeticToEcef, type Vec3 } from "../geo/ellipsoid";
import { tileAt } from "../geo/mercator";
import { nodeOrigin } from "../terrain/nodeMesh";
import { MAX_ZOOM } from "../terrain/quadtree";
import { localOffset, shaderRelative } from "./chunkTable";

// N0 precision test (docs/PLAN-engine.md section 5): camera-relative positions through the chunk-table path stay within
// 1 mm of the f64 truth for points 1-100 m from the eye, at the antimeridian at 60 N and at (0, 0).

function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
}

// Worst error over random points around an eye standing `eyeH` above the ellipsoid, using nodes of zoom z whose
// origin and vertices sit at base height `hb` (terrain/nodeMesh.ts: the middle of the node's height range).
function worstError(lat: number, lng: number, eyeH: number, z: number, hb = eyeH, n = 2000): number {
  const eye = geodeticToEcef(lat, lng, eyeH);
  const rand = rng(12345);
  let worst = 0;
  for (let k = 0; k < n; k++) {
    // Random direction, distance 1..100 m (log-uniform), kept within 100 m of the ground plane.
    const e = enuAt(lat, lng);
    const az = rand() * 2 * Math.PI;
    const el = (rand() - 0.5) * Math.PI;
    const d = 10 ** (rand() * 2);
    const dir = [0, 1, 2].map((i) => (e.east[i] * Math.sin(az) + e.north[i] * Math.cos(az)) * Math.cos(el) + e.up[i] * Math.sin(el));
    const p: Vec3 = [eye[0] + dir[0] * d, eye[1] + dir[1] * d, eye[2] + dir[2] * d];
    // Decompose as the terrain does: a point of the node at base height hb (stored f32 relative to the node origin,
    // itself at hb) lifted by h - hb (f32 in the shader) along its geodetic up.
    const g = ecefToGeodetic(p);
    const t = tileAt(g.lng, g.lat, z);
    const origin = nodeOrigin(z, t.x, t.y, hb);
    const base = geodeticToEcef(g.lat, g.lng, hb);
    const up = enuAt(g.lat, g.lng).up;
    // Heights are f32 data (the page), so the true point is at the f32 height: that rounding is fixed on the ground,
    // not something the eye's position changes.
    const h = Math.fround(g.h);
    const rel = shaderRelative(origin, eye, localOffset(base, origin), up, Math.fround(h - Math.fround(hb)));
    const q = geodeticToEcef(g.lat, g.lng, h);
    const truth = [q[0] - eye[0], q[1] - eye[1], q[2] - eye[2]];
    worst = Math.max(worst, Math.hypot(rel[0] - truth[0], rel[1] - truth[1], rel[2] - truth[2]));
  }
  return worst;
}

describe("chunk-table precision", () => {
  for (const [lat, lng] of [
    [60, 179.99],
    [0, 0],
  ])
    it(`is within 1 mm at ${lat}, ${lng} with the street-level nodes (z${MAX_ZOOM})`, () => {
      for (const eyeH of [2, 300, 2500 * 1.6]) {
        const err = worstError(lat, lng, eyeH, MAX_ZOOM);
        expect(err).toBeLessThan(0.001);
      }
    });

  it("stays sub-0.1 mm on a 4 km summit because the node origin sits at its mid-height (0.46 mm at h = 0)", () => {
    const summit = 2500 * 1.6;
    expect(worstError(47.08, 12.69, summit, MAX_ZOOM, 0)).toBeGreaterThan(0.0002);
    expect(worstError(47.08, 12.69, summit, MAX_ZOOM, summit - 150)).toBeLessThan(0.0001);
  });

  it("would not be with one z11-sized node around the eye (why the quadtree goes deeper)", () => {
    // Informative bound: ~20 km nodes leave f32 local offsets at ulp ~1 mm.
    expect(worstError(60, 179.99, 2, 11, 0)).toBeLessThan(0.005);
  });

  it("would be metres off with absolute f32 ECEF (the thing floating origin avoids)", () => {
    const eye = geodeticToEcef(60, 179.99, 2);
    const p = geodeticToEcef(60.0001, 179.9901, 0);
    const f = Math.fround;
    const naive = [0, 1, 2].map((i) => f(f(p[i]) - f(eye[i])));
    const err = Math.hypot(...[0, 1, 2].map((i) => naive[i] - (p[i] - eye[i])));
    expect(err).toBeGreaterThan(0.01);
  });

  it("survives the f32 view rotation", () => {
    const rand = rng(7);
    const f = Math.fround;
    for (let k = 0; k < 200; k++) {
      const a = rand() * Math.PI * 2;
      const r = [Math.cos(a), Math.sin(a), 0.3].map(f);
      const v = [rand() * 100, rand() * 100, rand() * 100].map(f);
      const exact = r[0] * v[0] + r[1] * v[1] + r[2] * v[2];
      const lowp = f(f(f(r[0] * v[0]) + f(r[1] * v[1])) + f(r[2] * v[2]));
      expect(Math.abs(exact - lowp)).toBeLessThan(1e-4);
    }
  });
});
