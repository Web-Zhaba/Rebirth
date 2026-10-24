import { locate, metersPerPixel } from "./mercator";
import { NATURE_MAXZOOM, WATERWAY_ZOOM } from "./nature";
import { getLandTile, getWaterwayTile } from "./tiles";

export const LANDS = ["water", "forest", "meadow", "wetland", "sand", "rock", "ice"] as const;
export type Land = (typeof LANDS)[number];

export const RIVER_DIST_M = 30;

const CLASS_TO_LAND: Record<string, Land> = { wood: "forest", wetland: "wetland", sand: "sand", rock: "rock", ice: "ice" };

// Even-odd rule across all rings, so holes carve out of their outer ring.
export function pointInRings(x: number, y: number, rings: number[][]): boolean {
  let inside = false;
  for (const r of rings) {
    for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
      const xi = r[i];
      const yi = r[i + 1];
      const xj = r[j];
      const yj = r[j + 1];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}

export function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

export async function landAt(lng: number, lat: number): Promise<Land> {
  const t = locate(lng, lat, NATURE_MAXZOOM);
  const tile = await getLandTile(t.x, t.y);
  const x = t.u * tile.extent;
  const y = t.v * tile.extent;
  const hit = (p: { bbox: number[]; rings: number[][] }) =>
    x >= p.bbox[0] && x <= p.bbox[2] && y >= p.bbox[1] && y <= p.bbox[3] && pointInRings(x, y, p.rings);
  if (tile.water.some(hit)) return "water";
  const lc = tile.land.find(hit);
  return (lc && CLASS_TO_LAND[lc.cls]) || "meadow";
}

export async function nearRiver(lng: number, lat: number, meters = RIVER_DIST_M): Promise<boolean> {
  const t = locate(lng, lat, WATERWAY_ZOOM);
  const tile = await getWaterwayTile(t.x, t.y);
  const x = t.u * tile.extent;
  const y = t.v * tile.extent;
  const r = meters / ((metersPerPixel(lat, WATERWAY_ZOOM) * 256) / tile.extent); // in tile units
  for (const l of tile.lines) {
    if (x < l.bbox[0] - r || x > l.bbox[2] + r || y < l.bbox[1] - r || y > l.bbox[3] + r) continue;
    const p = l.pts;
    for (let i = 0; i + 3 < p.length; i += 2) {
      if (distToSegment(x, y, p[i], p[i + 1], p[i + 2], p[i + 3]) <= r) return true;
    }
  }
  return false;
}
