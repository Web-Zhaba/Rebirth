import { beforeAll, describe, expect, it } from "vitest";
import png from "./biomes.png?inline";
import { biomeAt, biomeId, decodeBiomeMap, fillBiomes, type BiomeMap } from "./biomes";

let map: BiomeMap;
beforeAll(async () => {
  map = await decodeBiomeMap(await (await fetch(png)).arrayBuffer());
});

const colour = (lng: number, lat: number, near: number) => {
  const out = new Uint8ClampedArray(4);
  fillBiomes(map, [lng], [lat], near, out);
  return [...out.slice(0, 3)];
};

describe("biome map", () => {
  it("covers the whole planet, sea included", () => {
    expect(map.width).toBe(2 * map.height);
    expect(map.ids.every((id) => id > 0)).toBe(true);
  });

  it.each([
    ["desert", 13, 23],
    ["rainforest", -60, -3],
    ["savanna", 34.8, -2.3],
    ["broadleaf", 10, 50],
    ["taiga", 100, 62],
    ["tundra", 70, 70],
    ["steppe", -98, 38],
    ["mountainMeadow", 88, 33],
    ["swamp", -57, -17],
    ["ice", -40, 72],
    ["ice", 0, -85],
  ] as const)("%s at %s, %s", (key, lng, lat) => {
    expect(biomeAt(map, lng, lat)).toBe(biomeId(key));
  });
});

describe("biome colours", () => {
  it("meet at the antimeridian", () => {
    expect(colour(180, 66, 0)).toEqual(colour(-180, 66, 0));
  });

  it("differ between far and near", () => {
    expect(colour(-60, -3, 0)).not.toEqual(colour(-60, -3, 1));
  });

  it("make a desert brighter than a jungle", () => {
    const sum = (c: number[]) => c[0] + c[1] + c[2];
    expect(sum(colour(13, 23, 0))).toBeGreaterThan(sum(colour(-60, -3, 0)) + 100);
  });

  it("fill a drape page grid fast enough", () => {
    const n = 65; // the grid engine/bake/drape.ts biomeBase samples per page
    const lngs = Array.from({ length: n }, (_, i) => 10 + i * 0.01);
    const lats = Array.from({ length: n }, (_, j) => 50 - j * 0.01);
    const out = new Uint8ClampedArray(n * n * 4);
    let best = Infinity;
    for (let k = 0; k < 20; k++) {
      const t0 = performance.now();
      fillBiomes(map, lngs, lats, 0.5, out);
      best = Math.min(best, performance.now() - t0);
    }
    expect(best).toBeLessThan(10);
    expect(out[3]).toBe(255);
  });
});
