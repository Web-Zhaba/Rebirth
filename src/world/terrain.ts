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

export async function terrainAt(lng: number, lat: number): Promise<TerrainSample> {
  const t = locate(lng, lat, TERRAIN_ZOOM);
  const grid = await getDemTile(t.x, t.y);
  const px = t.u * TERRARIUM_SIZE;
  const py = t.v * TERRARIUM_SIZE;
  return {
    elevation: sampleGrid(grid, px, py),
    slope: slopeDegrees(grid, px, py, metersPerPixel(lat, TERRAIN_ZOOM)),
  };
}
