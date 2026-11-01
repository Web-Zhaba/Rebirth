import { describe, expect, it } from "vitest";
import { biomeColor, C } from "../../world/biome";
import { DRAPE_SIZE, packDrape, pageMpp, sourceOf } from "./drape";

describe("drape", () => {
  it("pages up to z12 read their own tile, deeper ones a square of the z12 ancestor", () => {
    expect(sourceOf(9, 300, 150)).toEqual({ z: 9, x: 300, y: 150, dz: 0 });
    expect(sourceOf(15, 8 * 1000 + 3, 8 * 2000 + 7)).toEqual({ z: 12, x: 1000, y: 2000, dz: 3 });
  });

  it("metres per pixel halve per zoom and shrink with latitude", () => {
    const eq = pageMpp(12, 2 ** 11);
    expect(eq).toBeCloseTo((2 * Math.PI * 6378137) / 2 ** 12 / DRAPE_SIZE, 0);
    expect(pageMpp(13, 2 ** 12)).toBeCloseTo(eq / 2, 1);
    expect(pageMpp(12, 1100)).toBeLessThan(eq); // ~60 deg N
  });

  it("packs colour RGB with the mask's red as alpha", () => {
    const rgba = new Uint8ClampedArray([10, 20, 30, 255, 40, 50, 60, 255]);
    const mask = new Uint8ClampedArray([0, 0, 0, 255, 255, 255, 255, 255]);
    expect([...packDrape(rgba, mask)]).toEqual([10, 20, 30, 0, 40, 50, 60, 255]);
  });

  it("colours by class/subclass, then class, then meadow", () => {
    expect(biomeColor("wood", "forest")).toBe(C.forest);
    expect(biomeColor("wood", "unknown")).toBe(C.forest);
    expect(biomeColor("wetland", "bog")).toBe(C.bog);
    expect(biomeColor("nothing", "")).toBe(C.meadow);
  });
});
