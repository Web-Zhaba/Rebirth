import { describe, expect, it } from "vitest";
import { geodeticToEcef } from "../geo/ellipsoid";
import { tileToLngLat } from "../geo/mercator";
import { buildIndices, buildNodeVertices, FLOATS_PER_VERTEX, GRID, GRID_VERTS, NODE_FLOATS, NODE_VERTS, nodeOrigin, skirtSource } from "./nodeMesh";

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
