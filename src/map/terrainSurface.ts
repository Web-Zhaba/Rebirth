import type { Frame } from "../world/frame";
import { signal } from "@preact/signals";
import { groundAt } from "./relief";

export const TERRAIN_OUTER_HALF = 12_000;
export const TERRAIN_OUTER_CELL = 120;
export const TERRAIN_FINE_HALF = 2_400;
export const TERRAIN_FINE_CELL = 20;
export const TERRAIN_CENTER_STEP = 3_600;

export const terrainSurfaceRevision = signal(0);

let activeFrame: Frame | null = null;
let activeCenter: [number, number] | null = null;

export function setTerrainSurfaceWindow(
  frame: Frame,
  center: readonly [number, number],
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
  terrainSurfaceRevision.value++;
}

export function clearTerrainSurfaceWindow(): void {
  if (!activeFrame && !activeCenter) return;
  activeFrame = null;
  activeCenter = null;
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

  const sample = (px: number, py: number): number | null => {
    const [sampleLng, sampleLat] = frame.toLngLat(px, py);
    return groundAt(sampleLng, sampleLat);
  };

  const h00 = sample(startX + ix * cell, startY + iy * cell);
  const h10 = sample(startX + (ix + 1) * cell, startY + iy * cell);
  const h01 = sample(startX + ix * cell, startY + (iy + 1) * cell);
  const h11 = sample(startX + (ix + 1) * cell, startY + (iy + 1) * cell);

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
