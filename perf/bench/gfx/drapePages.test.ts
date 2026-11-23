// The drape bake job's CPU part, without the worker or a canvas (src/engine/bake/drape.ts, drapeWorker.ts:70-75):
//   biomeBase -> paintDrape (canvas, skipped here) -> packDrape + rasterCover -> coverBlocks
// and the DEM job's decode (src/engine/bake/terrarium.ts decodeToPage), plus the per-sample height query the terrain and
// the forest ask through terrain.groundAt.
//
// Budgets from the code: terrain.ts:35-37 UPLOADS_PER_FRAME = 4 height pages, DRAPE_UPLOADS_PER_FRAME = 4 drape pages,
// 6 drape workers (terrain.ts:88) and 8 DEM streams (terrain.ts:86).
import { coverBlocks, DRAPE_SIZE, packDrape, rasterCover, biomeBase, type DrapeSource } from "../../../src/engine/bake/drape";
import { blockRanges, decodeToPage, PAGE_SIZE, samplePage } from "../../../src/engine/bake/terrarium";
import { fillBiomes, type BiomeMap } from "../../../src/world/biomes";
import { describe, expect, it } from "vitest";
import { measure, ring, rng, table } from "./util";

describe("DEM page decode (bake/terrarium.ts, one per height page)", () => {
  it("decodes a terrarium tile into a bordered f32 page", () => {
    const rnd = rng(5);
    const rgba = new Uint8ClampedArray(256 * 256 * 4);
    for (let i = 0; i < rgba.length; i += 4) {
      const h = Math.round(32768 + 400 + 200 * Math.sin(i / 9000) + 60 * rnd());
      rgba[i] = (h >> 8) & 0xff;
      rgba[i + 1] = h & 0xff;
      rgba[i + 2] = 0;
      rgba[i + 3] = 255;
    }
    let blocks = 0;
    measure("decodeToPage (256x256 RGBA -> 258x258 f32 + block ranges)", () => void (blocks = decodeToPage(rgba).blocks.length), { reps: 50, note: `${PAGE_SIZE}x${PAGE_SIZE} f32` });
    const page = decodeToPage(rgba).heights;
    measure("blockRanges (16x16 min/max)", () => void blockRanges(page), { reps: 100 });
    expect(blocks).toBe(16 * 16 * 2);

    // terrain.groundAt -> HeightPages.heightAt -> samplePage: the query every label, marker and click pays for.
    let sum = 0;
    measure("samplePage (one bilinear height)", () => void (sum += samplePage(page, 0.31, 0.72)), { reps: 200_000 });
    table("DEM page decode + height sample", `page ${PAGE_SIZE}x${PAGE_SIZE} f32 = ${(PAGE_SIZE * PAGE_SIZE * 4) / 1024} KB of texture a layer.`);
    expect(sum).toBeGreaterThan(0);
  });
});

describe("drape page bake (without the worker, without the canvas)", () => {
  it("rasterises the biome base, the cover classes and the packed colour", () => {
    // The real biome map is src/world/biomes.png: 4096 x 2048 (ids: Uint8Array, row by row from 90 N).
    const W = 4096;
    const H = 2048;
    const ids = new Uint8Array(W * H);
    const rnd = rng(9);
    for (let y = 0; y < H; y++) {
      const band = Math.min(21, Math.floor((Math.abs(y - H / 2) / (H / 2)) * 18));
      for (let x = 0; x < W; x++) ids[y * W + x] = rnd() < 0.02 ? (band + 1) % 22 : band;
    }
    const map: BiomeMap = { width: W, height: H, ids };

    const lngs = Array.from({ length: 65 }, (_, i) => ((17_400 + i / 64) / 2 ** 12) * 360 - 180);
    const lats = Array.from({ length: 65 }, (_, j) => (Math.atan(Math.sinh(Math.PI - (2 * Math.PI * (11_400 + j / 64)) / 2 ** 12)) * 180) / Math.PI);
    measure("fillBiomes 65x65 grid", () => void fillBiomes(map, lngs, lats, 0.8, new Uint8ClampedArray(65 * 65 * 4)), { reps: 20 });
    measure("biomeBase (65x65 samples spread over 256x256 texels)", () => void biomeBase(map, 12, 17_400, 11_400), { reps: 20, note: `${DRAPE_SIZE}x${DRAPE_SIZE}` });

    // The land cover of a dense tile: 200 polygons of 60 vertices plus a big forest of 3 rings x 900 vertices.
    const rnd2 = rng(11);
    const features: DrapeSource["features"] = [];
    for (let i = 0; i < 200; i++) {
      const r = ring(60, 40 + rnd2() * 200, rnd2() * 4096, rnd2() * 4096, rnd2);
      features.push({ kind: "land", color: "#2f4529", cls: "wood", sub: "forest", rings: [r.flat()] });
    }
    const big: number[][] = [0, 1, 2].map((k) => ring(900, 400, 1000 + k * 160, 1000, rnd2).flat());
    features.push({ kind: "land", color: "#2f4529", cls: "wood", sub: "forest", rings: big });
    const src: DrapeSource = { extent: 4096, features };
    const water = new Uint8ClampedArray(DRAPE_SIZE * DRAPE_SIZE * 4);
    for (let i = 0; i < water.length; i += 4) water[i] = rnd2() < 0.15 ? 255 : 0;

    let cover: Uint8Array = new Uint8Array(0);
    measure("rasterCover (200 polys x 60 verts + 3 x 900)", () => void (cover = rasterCover(src, 12, 17_400, 11_400, water)), { reps: 20, note: "scanline fill per polygon" });
    measure("coverBlocks (256x256 classes -> 16x16 x 4 floats)", () => void coverBlocks(cover), { reps: 100 });
    const rgba = new Uint8ClampedArray(DRAPE_SIZE * DRAPE_SIZE * 4);
    measure("packDrape (RGB + alpha mask, 65 536 texels)", () => void packDrape(rgba, water), { reps: 100 });
    let baseBytes = 0;
    measure(
      "one drape page, CPU part (base + cover + blocks + pack)",
      () => {
        const base = biomeBase(map, 12, 17_400, 11_400);
        const c = rasterCover(src, 12, 17_400, 11_400, water);
        coverBlocks(c);
        baseBytes = packDrape(rgba, water).length + base.length;
      },
      { reps: 5 },
    );
    table(
      "drape page bake (terrain.ts:37: 4 pages a frame, 6 workers)",
      "paintDrape itself is canvas work (Path2D fills + ctx.filter blur) and cannot run in node: not measured.",
    );
    expect(cover.length).toBe(DRAPE_SIZE * DRAPE_SIZE);
    expect(baseBytes).toBeGreaterThan(0);
  });
});
