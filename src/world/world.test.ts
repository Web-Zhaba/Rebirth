import { describe, expect, it } from "vitest";
import { pointInRings } from "./landcover";
import { lngLatToTile } from "./mercator";
import { decodeTerrarium, decodeTerrariumPixels, slopeDegrees } from "./terrain";

describe("terrarium", () => {
  it("decodes known RGB values", () => {
    expect(decodeTerrarium(128, 0, 0)).toBe(0);
    expect(decodeTerrarium(128, 100, 128)).toBeCloseTo(100.5);
    expect(decodeTerrarium(127, 255, 0)).toBe(-1);
    expect(decodeTerrariumPixels([128, 10, 0, 255, 129, 0, 0, 255])).toEqual(new Float32Array([10, 256]));
  });
});

describe("slope", () => {
  const size = 256;
  const plane = (k: number) => {
    const g = new Float32Array(size * size);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) g[y * size + x] = x * k;
    return g;
  };
  it("matches a tilted plane", () => {
    // 2 m per pixel rise over 10 m per pixel run = atan(0.2)
    expect(slopeDegrees(plane(2), 100.3, 90.7, 10)).toBeCloseTo((Math.atan(0.2) * 180) / Math.PI, 1);
  });
  it("is zero on a flat grid", () => {
    expect(slopeDegrees(new Float32Array(size * size).fill(42), 50, 50, 10)).toBe(0);
  });
});

describe("mercator", () => {
  it("maps lng 0 lat 0 at z1 to tile corner 1,1", () => {
    const t = lngLatToTile(0, 0, 1);
    expect(t.x).toBeCloseTo(1);
    expect(t.y).toBeCloseTo(1);
  });
});

describe("pointInRings", () => {
  const outer = [0, 0, 10, 0, 10, 10, 0, 10];
  const hole = [4, 4, 6, 4, 6, 6, 4, 6];
  it("respects holes", () => {
    expect(pointInRings(2, 2, [outer, hole])).toBe(true);
    expect(pointInRings(5, 5, [outer, hole])).toBe(false);
    expect(pointInRings(5, 5, [outer])).toBe(true);
    expect(pointInRings(20, 5, [outer, hole])).toBe(false);
  });
});
