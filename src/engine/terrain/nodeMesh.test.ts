import { describe, expect, it } from "vitest";
import { ecefToGeodetic, geodeticToEcef } from "../geo/ellipsoid";
import { MAX_MERCATOR_LAT, tileToLngLat } from "../geo/mercator";
import { buildIndices, buildNodeVertices, CAP_NORTH, CAP_SOUTH, capFlags, FLOATS_PER_VERTEX, GRID, GRID_VERTS, NODE_FLOATS, NODE_VERTS, nodeOrigin, poleLocal, skirtSource } from "./nodeMesh";

describe("terrain node mesh", () => {
  it("stores vertices relative to the node origin, exact to f32 rounding at every level", () => {
    for (const [z, x, y] of [
      [0, 0, 0],
      [5, 31, 9],
      [11, 2047, 581],
      [17, 131067, 37243],
    ]) {
      const origin = nodeOrigin(z, x, y);
      const out = new Float32Array(NODE_FLOATS);
      buildNodeVertices(z, x, y, origin, out);
      for (const [i, j] of [
        [0, 0],
        [GRID - 1, 0],
        [7, 19],
        [GRID - 1, GRID - 1],
      ]) {
        const p = tileToLngLat(z, x, y, i / (GRID - 1), j / (GRID - 1));
        const truth = geodeticToEcef(p.lat, p.lng, 0);
        const o = (j * GRID + i) * FLOATS_PER_VERTEX;
        const err = Math.hypot(out[o] + origin[0] - truth[0], out[o + 1] + origin[1] - truth[1], out[o + 2] + origin[2] - truth[2]);
        // Within f32 rounding of the local offset: ~1 m for a z0 node, sub-millimetre from z11 down.
        const span = Math.hypot(out[o], out[o + 1], out[o + 2]);
        expect(err).toBeLessThanOrEqual(span * 2 ** -23 + 1e-9);
      }
    }
  });

  it("stores vertices at the base height around an origin lifted to it", () => {
    const [z, x, y] = [13, 4355, 2878]; // Innsbruck
    const hb = 3800;
    const origin = nodeOrigin(z, x, y, hb);
    const out = new Float32Array(NODE_FLOATS);
    buildNodeVertices(z, x, y, origin, out, 0, hb);
    for (const [i, j] of [
      [0, 0],
      [16, 16],
      [GRID - 1, 5],
    ]) {
      const p = tileToLngLat(z, x, y, i / (GRID - 1), j / (GRID - 1));
      const o = (j * GRID + i) * FLOATS_PER_VERTEX;
      // origin + local + up * (h - hb) is the point at height h.
      const h = 3500;
      const q = [0, 1, 2].map((k) => origin[k] + out[o + k] + out[o + 4 + k] * (h - hb));
      const truth = geodeticToEcef(p.lat, p.lng, h);
      expect(Math.hypot(q[0] - truth[0], q[1] - truth[1], q[2] - truth[2])).toBeLessThan(1e-3);
    }
    // Lifted: the origin is hb above the ellipsoid.
    expect(ecefToGeodetic(origin).h).toBeCloseTo(hb, 6);
  });

  it("closes the polar holes with a fan from the edge row to an apex at the pole", () => {
    expect(capFlags(0, 0)).toBe(CAP_NORTH | CAP_SOUTH);
    expect(capFlags(3, 0)).toBe(CAP_NORTH);
    expect(capFlags(3, 7)).toBe(CAP_SOUTH);
    expect(capFlags(3, 4)).toBe(0);
    // The fan starts where the quadtree ends.
    expect(tileToLngLat(5, 0, 0).lat).toBeCloseTo(MAX_MERCATOR_LAT, 9);
    for (const [north, y] of [
      [true, 0],
      [false, 31],
    ] as const) {
      const origin = nodeOrigin(5, 17, y, 120);
      const h = 2800;
      const pole = poleLocal(north, origin, h);
      const p = [origin[0] + pole[0], origin[1] + pole[1], origin[2] + pole[2]];
      const g = ecefToGeodetic(p as [number, number, number]);
      expect(Math.abs(g.lat)).toBeCloseTo(90, 9);
      expect(Math.sign(g.lat)).toBe(north ? 1 : -1);
      expect(g.h).toBeCloseTo(h, 3);
    }
  });

  it("indexes the grid and the skirts inside the vertex range", () => {
    const idx = buildIndices();
    expect(idx.length).toBe(((GRID - 1) ** 2 + 4 * (GRID - 1)) * 6);
    expect(idx.reduce((a, b) => Math.max(a, b), 0)).toBe(NODE_VERTS - 1);
  });

  it("drops skirts from border vertices only", () => {
    for (let k = 0; k < 4 * GRID; k++) {
      const g = skirtSource(k);
      const i = g % GRID;
      const j = Math.floor(g / GRID);
      expect(g).toBeLessThan(GRID_VERTS);
      expect(i === 0 || j === 0 || i === GRID - 1 || j === GRID - 1).toBe(true);
    }
  });
});
