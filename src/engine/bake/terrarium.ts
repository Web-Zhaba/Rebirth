// Terrarium DEM decoding shared by the bake worker and tests. Same formula as src/world/terrain.ts; kept here so the
// worker bundle does not pull the game's tile modules.

export const DEM_SIZE = 256; // terrarium tile pixels
export const PAGE_SIZE = DEM_SIZE + 2; // page texels: the tile plus a 1-texel border from the neighbours

export const BLOCKS = 16; // min/max grid per page, for tight node bounds below the page's own zoom
export const BLOCK_PX = DEM_SIZE / BLOCKS;

export const TERRARIUM_URL = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png";

export function terrariumUrl(z: number, x: number, y: number): string {
  return TERRARIUM_URL.replace("{z}", String(z)).replace("{x}", String(x)).replace("{y}", String(y));
}

export function decodeTerrarium(r: number, g: number, b: number): number {
  return r * 256 + g + b / 256 - 32768;
}

// RGBA tile -> bordered page. Texel (i + 1, j + 1) holds pixel (i, j); the border starts as a copy of the edge
// (which is exactly src/world/terrain.ts's clamp) and is patched with the neighbour's pixels once it is resident.
export function decodeToPage(rgba: ArrayLike<number>): { heights: Float32Array<ArrayBuffer>; blocks: Float32Array<ArrayBuffer>; min: number; max: number } {
  const out = new Float32Array(PAGE_SIZE * PAGE_SIZE);
  let min = Infinity;
  let max = -Infinity;
  for (let j = 0; j < DEM_SIZE; j++)
    for (let i = 0; i < DEM_SIZE; i++) {
      const s = (j * DEM_SIZE + i) * 4;
      const h = decodeTerrarium(rgba[s], rgba[s + 1], rgba[s + 2]);
      out[(j + 1) * PAGE_SIZE + i + 1] = h;
      if (h < min) min = h;
      if (h > max) max = h;
    }
  for (let j = 1; j <= DEM_SIZE; j++) {
    out[j * PAGE_SIZE] = out[j * PAGE_SIZE + 1];
    out[j * PAGE_SIZE + PAGE_SIZE - 1] = out[j * PAGE_SIZE + PAGE_SIZE - 2];
  }
  out.copyWithin(0, PAGE_SIZE, 2 * PAGE_SIZE);
  out.copyWithin((PAGE_SIZE - 1) * PAGE_SIZE, (PAGE_SIZE - 2) * PAGE_SIZE, (PAGE_SIZE - 1) * PAGE_SIZE);
  return { heights: out, blocks: blockRanges(out), min, max };
}

// Bilinear height at (u, v) in 0..1 across the tile, from a bordered page. Pixel (i, j)'s value sits at its centre
// ((i + 0.5) / 256), as in src/world/terrain.ts sampleGrid. The WGSL `pageHeight` is a line-by-line copy.
export function samplePage(page: Float32Array, u: number, v: number): number {
  const px = u * DEM_SIZE + 0.5; // tile pixel coordinate - 0.5 (centre convention) + 1 (border)
  const py = v * DEM_SIZE + 0.5;
  const x0 = Math.max(0, Math.min(PAGE_SIZE - 2, Math.floor(px)));
  const y0 = Math.max(0, Math.min(PAGE_SIZE - 2, Math.floor(py)));
  const fx = Math.max(0, Math.min(1, px - x0));
  const fy = Math.max(0, Math.min(1, py - y0));
  const at = (x: number, y: number) => page[y * PAGE_SIZE + x];
  const top = at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx;
  const bottom = at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx;
  return top * (1 - fy) + bottom * fy;
}

// Min/max of each 16 x 16 px block (pairs, row-major), widened by one pixel all round: bilinear between a block's
// edge pixels and the next block's can reach that far.
export function blockRanges(page: Float32Array): Float32Array<ArrayBuffer> {
  const out = new Float32Array(BLOCKS * BLOCKS * 2);
  for (let by = 0; by < BLOCKS; by++)
    for (let bx = 0; bx < BLOCKS; bx++) {
      let lo = Infinity;
      let hi = -Infinity;
      // Page texel t holds pixel t - 1, so pixels [b*16 - 1, b*16 + 16] are texels [b*16, b*16 + 17].
      for (let y = by * BLOCK_PX; y <= by * BLOCK_PX + BLOCK_PX + 1; y++)
        for (let x = bx * BLOCK_PX; x <= bx * BLOCK_PX + BLOCK_PX + 1; x++) {
          const h = page[y * PAGE_SIZE + x];
          if (h < lo) lo = h;
          if (h > hi) hi = h;
        }
      out[(by * BLOCKS + bx) * 2] = lo;
      out[(by * BLOCKS + bx) * 2 + 1] = hi;
    }
  return out;
}
