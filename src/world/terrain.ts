import { locate, metersPerPixel } from "./mercator";
import { TERRAIN_ZOOM } from "./nature";
import { getDemTile } from "./tiles";

export const TERRARIUM_SIZE = 256;

export function decodeTerrarium(r: number, g: number, b: number): number {
  return r * 256 + g + b / 256 - 32768;
}

// RGBA pixel bytes -> meters per pixel.
export function decodeTerrariumPixels(rgba: ArrayLike<number>): Float32Array {
  const out = new Float32Array(rgba.length / 4);
  for (let i = 0; i < out.length; i++) out[i] = decodeTerrarium(rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]);
  return out;
}

// Bilinear elevation. px/py are in pixels where the value of pixel (i, j) sits at its
// centre (i + 0.5, j + 0.5); coordinates outside the grid clamp to the edge.
export function sampleGrid(grid: Float32Array, px: number, py: number, size = TERRARIUM_SIZE): number {
  const u = px - 0.5;
  const v = py - 0.5;
  const x0 = Math.floor(u);
  const y0 = Math.floor(v);
  const fx = u - x0;
  const fy = v - y0;
  const at = (x: number, y: number) => grid[Math.max(0, Math.min(size - 1, y)) * size + Math.max(0, Math.min(size - 1, x))];
  const top = at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx;
  const bottom = at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx;
  return top * (1 - fy) + bottom * fy;
}

// 3 x 3 block of DEM tiles around a centre tile, row-major (index (dy + 1) * 3 + dx + 1); null where a tile is not
// available (past the poles, or not loaded).
export type DemBlock = (Float32Array | null)[];

// Pixel (x, y) in the centre tile's pixel coordinates, reaching into the neighbours when outside 0..255. Same
// convention as src/engine/bake/terrarium.ts: where the tile at that spot is missing the coordinate clamps into the
// centre tile (the engine's border starts as a copy of the edge, and a missing diagonal leaves the centre's corner).
function pixelAt(block: DemBlock, x: number, y: number, size: number): number {
  const tx = Math.max(-1, Math.min(1, Math.floor(x / size)));
  const ty = Math.max(-1, Math.min(1, Math.floor(y / size)));
  const t = block[(ty + 1) * 3 + tx + 1];
  const c = block[4] as Float32Array;
  if (!t) return c[Math.max(0, Math.min(size - 1, y)) * size + Math.max(0, Math.min(size - 1, x))];
  return t[Math.max(0, Math.min(size - 1, y - ty * size)) * size + Math.max(0, Math.min(size - 1, x - tx * size))];
}

// sampleGrid across tile edges: px/py are pixels of the centre tile and may fall up to one pixel outside it.
export function sampleBlock(block: DemBlock, px: number, py: number, size = TERRARIUM_SIZE): number {
  const u = px - 0.5;
  const v = py - 0.5;
  const x0 = Math.floor(u);
  const y0 = Math.floor(v);
  const fx = u - x0;
  const fy = v - y0;
  const top = pixelAt(block, x0, y0, size) * (1 - fx) + pixelAt(block, x0 + 1, y0, size) * fx;
  const bottom = pixelAt(block, x0, y0 + 1, size) * (1 - fx) + pixelAt(block, x0 + 1, y0 + 1, size) * fx;
  return top * (1 - fy) + bottom * fy;
}

// Neighbour offsets (-1, 0, 1) a point at (px, py) needs: slope reaches 1 px out and bilinear 1.5 px, so 2.5 px edge band.
export function neighboursNeeded(px: number, py: number, size = TERRARIUM_SIZE): { dx: number[]; dy: number[] } {
  const axis = (p: number) => {
    const out = [0];
    if (Math.floor(p - 1.5) < 0) out.push(-1);
    if (Math.floor(p + 1.5) + 1 > size - 1) out.push(1);
    return out;
  };
  return { dx: axis(px), dy: axis(py) };
}

// Slope in degrees by central differences over +-1 DEM pixel.
export function slopeDegrees(grid: Float32Array, px: number, py: number, metersPerPx: number, size = TERRARIUM_SIZE): number {
  const dx = (sampleGrid(grid, px + 1, py, size) - sampleGrid(grid, px - 1, py, size)) / (2 * metersPerPx);
  const dy = (sampleGrid(grid, px, py + 1, size) - sampleGrid(grid, px, py - 1, size)) / (2 * metersPerPx);
  return (Math.atan(Math.hypot(dx, dy)) * 180) / Math.PI;
}

export interface TerrainSample {
  elevation: number;
  slope: number;
}

// Slope in degrees by central differences over +-1 DEM pixel, across tile edges.
export function slopeBlock(block: DemBlock, px: number, py: number, metersPerPx: number, size = TERRARIUM_SIZE): number {
  const dx = (sampleBlock(block, px + 1, py, size) - sampleBlock(block, px - 1, py, size)) / (2 * metersPerPx);
  const dy = (sampleBlock(block, px, py + 1, size) - sampleBlock(block, px, py - 1, size)) / (2 * metersPerPx);
  return (Math.atan(Math.hypot(dx, dy)) * 180) / Math.PI;
}

// The centre tile is required; neighbours are fetched only when the point is near an edge, and a neighbour that is
// off the map or fails to load falls back to the edge clamp.
export async function terrainAt(lng: number, lat: number): Promise<TerrainSample> {
  const t = locate(lng, lat, TERRAIN_ZOOM);
  const px = t.u * TERRARIUM_SIZE;
  const py = t.v * TERRARIUM_SIZE;
  const need = neighboursNeeded(px, py);
  const n = 2 ** TERRAIN_ZOOM;
  const block: DemBlock = new Array(9).fill(null);
  await Promise.all(
    need.dy.flatMap((dy) =>
      need.dx.map(async (dx) => {
        const y = t.y + dy;
        if (y < 0 || y >= n) return;
        const load = getDemTile((((t.x + dx) % n) + n) % n, y);
        block[(dy + 1) * 3 + dx + 1] = dx === 0 && dy === 0 ? await load : await load.catch(() => null);
      }),
    ),
  );
  return {
    elevation: sampleBlock(block, px, py),
    slope: slopeBlock(block, px, py, metersPerPixel(lat, TERRAIN_ZOOM)),
  };
}
