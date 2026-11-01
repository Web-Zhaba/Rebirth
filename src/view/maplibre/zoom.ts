// MapLibre zoom <-> the view's camera scale (eye distance, metres per CSS pixel). Pure maths, shared with the
// benchmark scenes (src/bench/scenes.ts).

import type { CameraGoal } from "../view";

// MapLibre's vertical field of view and the earth radius its metre conversions use.
export const FOV_DEG = 36.87;
export const EARTH_RADIUS = 6371008.8;
export const TILE_PX = 512;

// Metres per CSS pixel at the target for a MapLibre zoom.
export function metersPerPixel(zoom: number, lat: number): number {
  return (2 * Math.PI * EARTH_RADIUS * Math.cos((lat * Math.PI) / 180)) / (TILE_PX * 2 ** zoom);
}

export function mppToZoom(mpp: number, lat: number): number {
  return Math.log2(metersPerPixel(0, lat) / mpp);
}

// Eye-to-target distance (m) MapLibre keeps for a zoom in a viewport `heightPx` CSS pixels tall.
export function zoomToDistance(zoom: number, lat: number, heightPx: number): number {
  return ((0.5 * heightPx) / Math.tan(((FOV_DEG / 2) * Math.PI) / 180)) * metersPerPixel(zoom, lat);
}

export function distanceToZoom(distance: number, lat: number, heightPx: number): number {
  const unit = zoomToDistance(0, lat, heightPx);
  return Math.log2(unit / distance);
}

// The zoom a goal asks for at latitude `lat`, or undefined when it leaves the scale alone.
export function goalZoom(goal: Pick<CameraGoal, "distance" | "mpp">, lat: number, heightPx: number): number | undefined {
  if (goal.distance !== undefined) return distanceToZoom(goal.distance, lat, heightPx);
  if (goal.mpp !== undefined) return mppToZoom(goal.mpp, lat);
  return undefined;
}
