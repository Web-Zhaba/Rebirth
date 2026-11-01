import { MAX_DISTANCE } from "./camera";
import { MEAN_RADIUS } from "./fly";

// Distance that frames a lat/lng box with padding, at pitch-0 semantics like MapLibre's fitBounds: the box's ground
// extent against the padded viewport, seen straight down.

const RAD = Math.PI / 180;

export interface FitResult {
  lat: number;
  lng: number;
  distance: number;
}

export function fitBounds(
  bounds: [west: number, south: number, east: number, north: number],
  viewW: number,
  viewH: number,
  fovYDeg: number,
  padding: number,
  minDistance: number,
): FitResult {
  const [west, south, east0, north] = bounds;
  const east = east0 < west ? east0 + 360 : east0;
  const lat = (south + north) / 2;
  const lng = (west + east) / 2;
  const widthM = (east - west) * RAD * MEAN_RADIUS * Math.cos(Math.max(Math.abs(south), Math.abs(north)) * RAD);
  const heightM = (north - south) * RAD * MEAN_RADIUS;
  const availW = Math.max(1, viewW - 2 * padding);
  const availH = Math.max(1, viewH - 2 * padding);
  const mpp = Math.max(widthM / availW, heightM / availH);
  const distance = (mpp * viewH) / (2 * Math.tan((fovYDeg * RAD) / 2));
  return { lat, lng: ((((lng + 180) % 360) + 360) % 360) - 180, distance: Math.min(MAX_DISTANCE, Math.max(minDistance, distance)) };
}
