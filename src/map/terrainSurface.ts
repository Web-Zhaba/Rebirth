import type { Frame } from "../world/frame";
import { signal } from "@preact/signals";
import { groundAt } from "./relief";

export const TERRAIN_OUTER_HALF = 12_000;
export const TERRAIN_OUTER_CELL = 240;
export const TERRAIN_FINE_HALF = 2_400;
export const TERRAIN_FINE_CELL = 40;
export const TERRAIN_CENTER_STEP = 3_600;

export const terrainSurfaceRevision = signal(0);

let activeFrame: Frame | null = null;
let activeCenter: [number, number] | null = null;
// Every rendered terrain vertex is shared by many nearby trees and buildings.
// Cache only real heights (never null) to avoid repeating DEM lookups while a
// chunk of vegetation is assembled; missing tiles can then load and retry.
const vertexHeights = new Map<string, number>();

export function setTerrainSurfaceWindow(
  frame: Frame,
  center: readonly [number, number],
  notifyDependents = true,
): void {
  if (
    activeFrame === frame &&
    activeCenter?.[0] === center[0] &&
    activeCenter?.[1] === center[1]
  ) {
    return;
  }

  activeFrame = frame;
  activeCenter = [center[0], center[1]];
  vertexHeights.clear();
  // Changing the active mesh window is cheap, but notifying every gameplay
  // layer at once can cause a large synchronous rebuild cascade. Callers may
  // update the sampler without broadcasting this revision.
  if (notifyDependents) terrainSurfaceRevision.value++;
}

export function clearTerrainSurfaceWindow(): void {
  if (!activeFrame && !activeCenter) return;
  activeFrame = null;
  activeCenter = null;
  vertexHeights.clear();
  terrainSurfaceRevision.value++;
}

/**
 * Samples the same piecewise-planar triangle surface used by landscapeLayer,
 * rather than the underlying bilinear DEM. This is the common seating height
 * for buildings, roads, fields and terrain-aware overlays.
 *
 * Returns raw (non-exaggerated) metres, or null while a required DEM sample is
 * missing. Multiplying by reliefScale is the caller's responsibility.
 */
export function terrainSurfaceAt(
  lng: number,
  lat: number,
  frameOverride?: Frame,
): number | null {
  const frame = frameOverride ?? activeFrame;
  const center = activeCenter;

  if (!frame || !center) {
    return groundAt(lng, lat);
  }

  const [x, y] = frame.toLocal(lng, lat);
  const fine =
    Math.abs(x - center[0]) < TERRAIN_FINE_HALF &&
    Math.abs(y - center[1]) < TERRAIN_FINE_HALF;

  const cell = fine ? TERRAIN_FINE_CELL : TERRAIN_OUTER_CELL;
  const half = fine ? TERRAIN_FINE_HALF : TERRAIN_OUTER_HALF;
  const grid = Math.ceil((half * 2) / cell);
  const startX = center[0] - half;
  const startY = center[1] - half;

  if (
    x < startX ||
    y < startY ||
    x > startX + grid * cell ||
    y > startY + grid * cell
  ) {
    return groundAt(lng, lat);
  }

  const ix = Math.max(0, Math.min(grid - 1, Math.floor((x - startX) / cell)));
  const iy = Math.max(0, Math.min(grid - 1, Math.floor((y - startY) / cell)));
  const fx = Math.max(0, Math.min(1, (x - (startX + ix * cell)) / cell));
  const fy = Math.max(0, Math.min(1, (y - (startY + iy * cell)) / cell));

  const sample = (gx: number, gy: number): number | null => {
    const px = startX + gx * cell;
    const py = startY + gy * cell;
    const key = `${px.toFixed(2)}:${py.toFixed(2)}`;
    const cached = vertexHeights.get(key);
    if (cached !== undefined) return cached;

    const [sampleLng, sampleLat] = frame.toLngLat(px, py);
    const h = groundAt(sampleLng, sampleLat);

    if (h !== null) vertexHeights.set(key, h);
    return h;
  };

  const h00 = sample(ix, iy);
  const h10 = sample(ix + 1, iy);
  const h01 = sample(ix, iy + 1);
  const h11 = sample(ix + 1, iy + 1);

  if (
    h00 === null ||
    h10 === null ||
    h01 === null ||
    h11 === null
  ) {
    return null;
  }

  // Keep the diagonal and triangle interpolation in lock-step with the index
  // pattern in landscapeLayer.buildMesh(). The grid origins are aligned to the
  // global cell lattice, so ix + iy carries the same parity in both modules.
  if (((ix + iy) & 1) === 0) {
    if (fx + fy <= 1) {
      return h00 * (1 - fx - fy) + h01 * fy + h10 * fx;
    }

    return (
      h10 * (1 - fy) +
      h01 * (1 - fx) +
      h11 * (fx + fy - 1)
    );
  }

  if (fy >= fx) {
    return h00 * (1 - fy) + h01 * (fy - fx) + h11 * fx;
  }

  return h00 * (1 - fx) + h10 * (fx - fy) + h11 * fy;
}
