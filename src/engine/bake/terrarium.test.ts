import { describe, expect, it } from "vitest";
import { decodeTerrarium as worldDecode, sampleGrid, TERRARIUM_SIZE } from "../../world/terrain";
import { BLOCKS, decodeTerrarium, decodeToPage, DEM_SIZE, PAGE_SIZE, samplePage } from "./terrarium";

function tile(f: (i: number, j: number) => number): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(DEM_SIZE * DEM_SIZE * 4);
  for (let j = 0; j < DEM_SIZE; j++)
    for (let i = 0; i < DEM_SIZE; i++) {
      const v = f(i, j) + 32768;
      const o = (j * DEM_SIZE + i) * 4;
      rgba[o] = Math.floor(v / 256);
      rgba[o + 1] = Math.floor(v) % 256;
      rgba[o + 2] = Math.round((v - Math.floor(v)) * 256);
      rgba[o + 3] = 255;
    }
  return rgba;
}

describe("terrarium pages", () => {
  it("decodes like the game", () => {
    for (const [r, g, b] of [
      [128, 0, 0],
      [127, 255, 128],
      [130, 17, 3],
    ])
      expect(decodeTerrarium(r, g, b)).toBe(worldDecode(r, g, b));
  });

  it("samples exactly like src/world/terrain.ts sampleGrid (pixel centres, clamped border)", () => {
    const f = (i: number, j: number) => ((i * 37 + j * 91) % 500) - 50;
    const page = decodeToPage(tile(f));
    const grid = new Float32Array(TERRARIUM_SIZE * TERRARIUM_SIZE);
    for (let j = 0; j < DEM_SIZE; j++) for (let i = 0; i < DEM_SIZE; i++) grid[j * DEM_SIZE + i] = f(i, j);
    for (const [u, v] of [
      [0, 0],
      [0.001, 0.5],
      [0.5, 0.5],
      [0.3712, 0.9],
      [0.999, 0.001],
      [1, 1],
    ])
      expect(samplePage(page.heights, u, v)).toBeCloseTo(sampleGrid(grid, u * DEM_SIZE, v * DEM_SIZE), 4);
    expect(page.min).toBe(-50);
  });

  it("is continuous across a tile edge once the neighbour fills the border", () => {
    // A global ramp over two tiles side by side; exchange the facing edges as HeightPages does on upload.
    const left = decodeToPage(tile((i) => i));
    const right = decodeToPage(tile((i) => 256 + i));
    for (let j = 1; j <= DEM_SIZE; j++) left.heights[j * PAGE_SIZE + PAGE_SIZE - 1] = right.heights[j * PAGE_SIZE + 1];
    for (let j = 1; j <= DEM_SIZE; j++) right.heights[j * PAGE_SIZE] = left.heights[j * PAGE_SIZE + DEM_SIZE];
    // At the shared edge both pages give the global bilinear value, halfway between pixel 255 and the next tile's 0.
    expect(samplePage(left.heights, 1, 0.5)).toBeCloseTo(255.5, 4);
    expect(samplePage(right.heights, 0, 0.5)).toBeCloseTo(255.5, 4);
  });
});

describe("page block ranges", () => {
  it("bound every bilinear sample inside the block", () => {
    const f = (i: number, j: number) => Math.round(1000 * Math.sin(i * 0.37) * Math.cos(j * 0.23));
    const page = decodeToPage(tile(f));
    for (let k = 0; k < 2000; k++) {
      const u = (k * 0.6180339) % 1;
      const v = (k * 0.4142135) % 1;
      const b = (Math.floor(v * BLOCKS) * BLOCKS + Math.floor(u * BLOCKS)) * 2;
      const h = samplePage(page.heights, u, v);
      expect(h).toBeGreaterThanOrEqual(page.blocks[b] - 1e-3);
      expect(h).toBeLessThanOrEqual(page.blocks[b + 1] + 1e-3);
    }
  });
});
