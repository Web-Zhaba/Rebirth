const MAX_LAT = 85.0511287798;
const EQUATOR_M = 40075016.686;

// Fractional tile coordinates of a point at zoom z (Web Mercator).
export function lngLatToTile(lng: number, lat: number, z: number): { x: number; y: number } {
  const n = 2 ** z;
  const phi = (Math.max(-MAX_LAT, Math.min(MAX_LAT, lat)) * Math.PI) / 180;
  return { x: ((lng + 180) / 360) * n, y: ((1 - Math.asinh(Math.tan(phi)) / Math.PI) / 2) * n };
}

// Ground size of one 256 px tile pixel at the given latitude and zoom.
export function metersPerPixel(lat: number, z: number): number {
  return (EQUATOR_M * Math.cos((lat * Math.PI) / 180)) / (256 * 2 ** z);
}

export interface TileLocation {
  x: number; // integer tile column (wrapped around the antimeridian)
  y: number; // integer tile row (clamped)
  u: number; // position inside the tile, 0..1
  v: number;
}

export function locate(lng: number, lat: number, z: number): TileLocation {
  const n = 2 ** z;
  const f = lngLatToTile(lng, lat, z);
  const tx = Math.floor(f.x);
  const ty = Math.floor(f.y);
  return {
    x: ((tx % n) + n) % n,
    y: Math.max(0, Math.min(n - 1, ty)),
    u: f.x - tx,
    v: f.y - ty,
  };
}
