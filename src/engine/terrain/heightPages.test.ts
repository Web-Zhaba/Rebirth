import { beforeAll, describe, expect, it } from "vitest";
import { tileKey, tileToLngLat } from "../geo/mercator";
import { BLOCKS, PAGE_SIZE } from "../bake/terrarium";
import { DEM_MAX_ZOOM, HeightPages } from "./heightPages";

const device = {
  createTexture: () => ({}),
  queue: { writeTexture: () => {} },
} as unknown as GPUDevice;

const page = (x: number) => ({
  key: tileKey(DEM_MAX_ZOOM, x, 100),
  heights: new Float32Array(PAGE_SIZE * PAGE_SIZE),
  blocks: new Float32Array(BLOCKS * BLOCKS * 2),
  min: 0,
  max: 0,
});

describe("HeightPages.hold", () => {
  beforeAll(() => {
    // Node has no WebGPU: the flags only need to exist for the texture descriptor.
    Object.assign(globalThis, { GPUTextureUsage: { TEXTURE_BINDING: 4, COPY_DST: 2 } });
  });

  it("keeps a held page and its CPU copy through a pool's worth of newer pages", () => {
    const pages = new HeightPages(device, 100); // more than the 64 CPU copies kept
    const town = page(0);
    pages.hold(town.key);
    pages.upload([town]);
    for (let x = 1; x < 300; x++) {
      pages.frame++;
      pages.upload([page(x)]);
    }
    expect(pages.has(town.key)).toBe(true);
    expect(pages.has(page(1).key)).toBe(false);
    const at = tileToLngLat(DEM_MAX_ZOOM, 0, 100, 0.5, 0.5);
    expect(pages.zoomAt(at.lat, at.lng)).toBe(DEM_MAX_ZOOM);
  });

  it("lets a page go once every holder released it", () => {
    const pages = new HeightPages(device, 4);
    const town = page(0);
    pages.hold(town.key);
    pages.hold(town.key);
    pages.upload([town]);
    pages.release(town.key);
    pages.release(town.key);
    for (let x = 1; x < 10; x++) {
      pages.frame++;
      pages.upload([page(x)]);
    }
    expect(pages.has(town.key)).toBe(false);
  });
});
