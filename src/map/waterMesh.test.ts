import { describe, expect, it } from "vitest";
import type { XY } from "./modelGeometry";
import { buildWaterChunk, clipBox, runsOutside, SHORE_CAP, tileWater, type Box, type Waterway } from "./waterMesh";

const area = (p: XY[]) => Math.abs(p.reduce((a, [x, y], i) => a + x * p[(i + 1) % p.length][1] - p[(i + 1) % p.length][0] * y, 0)) / 2;
const ring = (pts: XY[]) => pts.flat();
const id = (x: number, y: number): XY => [x, y];

function chunkArea(c: ReturnType<typeof buildWaterChunk>): number {
  let a = 0;
  for (let t = 0; t < c.index.length; t += 3)
    a += area([0, 1, 2].map((k) => [c.xy[c.index[t + k] * 2], c.xy[c.index[t + k] * 2 + 1]] as XY));
  return a;
}

describe("clipBox", () => {
  it("keeps the part of a polygon inside a box", () => {
    expect(area(clipBox([[-5, -5], [5, -5], [5, 5], [-5, 5]], [0, 0, 10, 10]))).toBeCloseTo(25);
    expect(clipBox([[20, 20], [30, 20], [25, 30]], [0, 0, 10, 10])).toEqual([]);
  });
});

describe("tileWater", () => {
  // a lake with a 15 x 20 island, running on past the tile's east edge (x = 100), where the tile cut it
  const lake = { rings: [ring([[10, 10], [110, 10], [110, 90], [10, 90]]), ring([[40, 40], [40, 60], [55, 60], [55, 40]])] };
  const w = tileWater([lake], 100, id);
  it("cuts the water into pieces that cover it inside the tile, holes left out", () => {
    expect(w.pieces.reduce((a, p) => a + area(p), 0)).toBeCloseTo(90 * 80 - 15 * 20);
  });
  it("keeps the shore but not where the tile cut the water", () => {
    const xs: number[] = [];
    for (let k = 0; k < w.shores.length; k += 4) xs.push(w.shores[k], w.shores[k + 2]);
    expect(xs.filter((x) => x === 110)).toHaveLength(2); // the north and south shores reach out to the cut ...
    expect(w.shores.length / 4).toBe(3 + 4); // ... but the cut edge is not a shore: three sides of the lake, four of the island
  });
  it("leaves out an edge along the tile's border", () => {
    const edge = { rings: [ring([[0, 10], [50, 10], [50, 90], [0, 90]])] };
    expect(tileWater([edge], 100, id).shores.length / 4).toBe(3);
  });
});

describe("buildWaterChunk", () => {
  const sq = (x0: number, y0: number, x1: number, y1: number): XY[] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
  const shoreOf = (p: XY[]) => p.flatMap((a, i) => [...a, ...p[(i + 1) % p.length]]);
  const lake = sq(0, 0, 400, 400);
  const box: Box = [0, 0, 200, 200];
  it("lays the water of the chunk on cells, covering it exactly", () => {
    const c = buildWaterChunk([lake], shoreOf(lake), [], [], box, 20);
    expect(chunkArea(c)).toBeCloseTo(200 * 200);
    // no triangle wider than a cell
    for (let t = 0; t < c.index.length; t += 3) {
      const xs = [0, 1, 2].map((k) => c.xy[c.index[t + k] * 2]);
      expect(Math.max(...xs) - Math.min(...xs)).toBeLessThanOrEqual(20 + 1e-9);
    }
  });
  it("measures the distance to the shore, capped", () => {
    const c = buildWaterChunk([lake], shoreOf(lake), [], [], box, 20);
    for (let v = 0; v < c.shore.length; v++) {
      const [x, y] = [c.xy[v * 2], c.xy[v * 2 + 1]];
      expect(c.shore[v]).toBeCloseTo(Math.min(SHORE_CAP, x, y), 6);
    }
  });
  it("flows like the nearest river line", () => {
    const river: Waterway = { pts: [[100, -50], [100, 450]], half: 5, speed: 1 };
    const c = buildWaterChunk([lake], shoreOf(lake), [river], [], box, 50);
    const v = c.xy.findIndex((_, k) => k % 2 === 0 && c.xy[k] === 100 && c.xy[k + 1] === 100) / 2;
    expect([c.flow[v * 2], c.flow[v * 2 + 1]]).toEqual([0, 1]);
  });
  it("makes a ribbon of a waterway, deepest along its line", () => {
    const stream: Waterway = { pts: [[10, 50], [150, 50]], half: 3, speed: 0.5 };
    const c = buildWaterChunk([], [], [], [stream], box, 20);
    expect(chunkArea(c)).toBeCloseTo(140 * 6);
    expect(Math.max(...c.shore)).toBe(3);
  });
});

describe("runsOutside", () => {
  it("splits a waterway where it runs through a lake", () => {
    const w: Waterway = { pts: [[0, 0], [10, 0], [20, 0], [30, 0], [40, 0]], half: 3, speed: 1 };
    const runs = runsOutside(w, (x) => x > 12 && x < 28);
    expect(runs.map((r) => r.pts)).toEqual([[[0, 0], [10, 0]], [[30, 0], [40, 0]]]);
  });
});
