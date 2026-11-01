import { describe, expect, it } from "vitest";
import { biomeColor, C } from "../../world/biome";
import { coverIdOf } from "../../world/forestMix";
import { COVER_BLOCKS, coverBlocks, DRAPE_SIZE, packDrape, pageMpp, rasterCover, sourceOf, type DrapeSource } from "./drape";

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

  it("rasterises cover ids without blending, the first feature winning, nothing under water", () => {
    // a z12 page of a 4096-unit tile: 16 units per texel
    const sq = (x0: number, y0: number, x1: number, y1: number) => [[x0, y0, x1, y0, x1, y1, x0, y1]];
    const src: DrapeSource = {
      extent: 4096,
      features: [
        { kind: "land", color: "", cls: "wood", sub: "forest", rings: sq(0, 0, 2048, 4096) },
        { kind: "land", color: "", cls: "wetland", sub: "marsh", rings: sq(1024, 0, 4096, 4096) },
        { kind: "land", color: "", cls: "farmland", sub: "", rings: sq(0, 0, 4096, 4096) },
      ],
    };
    const water = new Uint8ClampedArray(DRAPE_SIZE * DRAPE_SIZE * 4);
    water[(10 * DRAPE_SIZE + 200) * 4] = 255;
    const c = rasterCover(src, 12, 0, 0, water);
    const wood = coverIdOf("wood", "forest");
    const marsh = coverIdOf("wetland", "marsh");
    expect(c[5 * DRAPE_SIZE + 10]).toBe(wood);
    expect(c[5 * DRAPE_SIZE + 100]).toBe(wood); // both cover it: the first wins
    expect(c[5 * DRAPE_SIZE + 127]).toBe(wood);
    expect(c[5 * DRAPE_SIZE + 128]).toBe(marsh); // the edge falls between texel centres, no mixed id
    expect(c[10 * DRAPE_SIZE + 200]).toBe(0); // water
    expect(new Set(c)).toEqual(new Set([0, wood, marsh]));
    const blocks = coverBlocks(c);
    expect(blocks[0]).toBe(1); // top-left block: all wood, trees
    expect(blocks[(COVER_BLOCKS - 1) * 4 + 2]).toBeCloseTo(0.7, 5); // top-right block: marsh, its reed share
    expect(blocks[(COVER_BLOCKS - 1) * 4]).toBe(0);
  });

  it("fills a ring with a hole by even-odd", () => {
    const src: DrapeSource = {
      extent: 4096,
      features: [{ kind: "land", color: "", cls: "rock", sub: "", rings: [[0, 0, 4096, 0, 4096, 4096, 0, 4096], [1024, 1024, 3072, 1024, 3072, 3072, 1024, 3072]] }],
    };
    const c = rasterCover(src, 12, 0, 0, null);
    expect(c[10 * DRAPE_SIZE + 10]).toBe(coverIdOf("rock", ""));
    expect(c[128 * DRAPE_SIZE + 128]).toBe(0);
  });
});
