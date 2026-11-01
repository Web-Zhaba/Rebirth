import { describe, expect, it } from "vitest";
import { brokenWalls, RUIN_WALL_BURY, ruinWallColour, ruinWallModel } from "./ruinsGeometry";
import type { XY } from "../world/oldworld";

const square: XY[] = [
  [0, 0],
  [10, 0],
  [10, 10],
  [0, 10],
];

describe("ruinWallModel", () => {
  it("builds a prism per piece, open below: a top and four sides", () => {
    const pieces = brokenWalls(square, "f1", 6)!;
    const m = ruinWallModel(pieces, () => 0);
    const verts = m.positions.length / 3;
    expect(verts).toBe(pieces.length * (4 + 4 * 4));
    expect(m.indices.length).toBe(pieces.length * (2 + 4 * 2) * 3);
    expect(m.normals.length).toBe(m.positions.length);
    expect(m.colors.length).toBe(m.positions.length);
    expect(m.facade.length).toBe(verts * 4);
    expect(m.lift!.length).toBe(verts);
    expect(Math.max(...m.indices)).toBe(verts - 1);
  });

  it("stands on the mean ground of its corners and reaches below the lowest one", () => {
    const quad: XY[] = [
      [0, 0],
      [2, 0],
      [2, 0.5],
      [0, 0.5],
    ];
    const ground = (x: number) => 100 + x; // 100 .. 102 along the piece
    const m = ruinWallModel([{ quad, h: 1.5 }], ground);
    const zs = m.positions.filter((_, i) => i % 3 === 2);
    expect(Math.max(...zs)).toBeCloseTo(101 + 1.5, 9);
    expect(Math.min(...zs)).toBeCloseTo(100 - RUIN_WALL_BURY, 9);
    expect(m.lift![0]).toBeCloseTo(101, 9);
  });

  it("points every side away from its piece", () => {
    const quad: XY[] = [
      [0, 0],
      [0, 0.5],
      [2, 0.5],
      [2, 0],
    ]; // clockwise
    const m = ruinWallModel([{ quad, h: 1 }], () => 0);
    for (let v = 4; v < m.positions.length / 3; v++) {
      const [x, y] = [m.positions[v * 3] - 1, m.positions[v * 3 + 1] - 0.25];
      const [nx, ny, nz] = m.normals.slice(v * 3, v * 3 + 3);
      expect(nz).toBe(0);
      expect(nx * x + ny * y).toBeGreaterThan(0);
    }
  });

  it("skips pieces without height and colours by height like the old extrusion", () => {
    expect(ruinWallModel([{ quad: square, h: 0 }], () => 0).positions.length).toBe(0);
    const low = ruinWallColour(0.1);
    const high = ruinWallColour(2.5);
    expect(ruinWallColour(0)).toEqual(low);
    expect(ruinWallColour(9)).toEqual(high);
    expect(low[1]).toBeGreaterThan(low[2]); // mossy: greener than blue
    expect(ruinWallColour(1)).not.toEqual(low);
  });
});
