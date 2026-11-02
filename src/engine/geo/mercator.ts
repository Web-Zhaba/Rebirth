// Web-mercator tile addressing in float64. Terrain nodes are mercator tiles because the DEM is (terrarium); the
// geometry itself lives on the ellipsoid. Latitudes are geodetic WGS84, as EPSG:3857 assumes.

export const MAX_MERCATOR_LAT = 85.0511287798066; // atan(sinh(pi)): the square world's top edge

// Fractional mercator coordinate in 0..1 (x east, y south) for the whole world.
export function lngToMx(lng: number): number {
  return (lng + 180) / 360;
}

export function latToMy(lat: number): number {
  const phi = (Math.max(-MAX_MERCATOR_LAT, Math.min(MAX_MERCATOR_LAT, lat)) * Math.PI) / 180;
  return (1 - Math.asinh(Math.tan(phi)) / Math.PI) / 2;
}

export function mxToLng(mx: number): number {
  return mx * 360 - 180;
}

export function myToLat(my: number): number {
  return (Math.atan(Math.sinh(Math.PI * (1 - 2 * my))) * 180) / Math.PI;
}

// Fractional tile coordinate at zoom z (same as src/world/mercator.ts lngLatToTile).
export function lngLatToTile(lng: number, lat: number, z: number): { x: number; y: number } {
  const n = 2 ** z;
  return { x: lngToMx(lng) * n, y: latToMy(lat) * n };
}

// Lat/lng of a point inside tile (z, x, y); u, v in 0..1 across the tile (v grows south).
export function tileToLngLat(z: number, x: number, y: number, u = 0, v = 0): { lng: number; lat: number } {
  const n = 2 ** z;
  return { lng: mxToLng((x + u) / n), lat: myToLat((y + v) / n) };
}

export interface TileBounds {
  west: number;
  east: number;
  north: number;
  south: number;
}

export function tileBounds(z: number, x: number, y: number): TileBounds {
  const n = 2 ** z;
  return { west: mxToLng(x / n), east: mxToLng((x + 1) / n), north: myToLat(y / n), south: myToLat((y + 1) / n) };
}

// Integer tile holding a point, x wrapped around the antimeridian, y clamped to the square world.
export function tileAt(lng: number, lat: number, z: number): { x: number; y: number } {
  const n = 2 ** z;
  const t = lngLatToTile(lng, lat, z);
  const x = Math.floor(t.x);
  return { x: ((x % n) + n) % n, y: Math.max(0, Math.min(n - 1, Math.floor(t.y))) };
}

// Numeric key for a tile up to z 20: fits a safe integer and avoids string building in the per-frame walk.
export function tileKey(z: number, x: number, y: number): number {
  return z * 2 ** 42 + y * 2 ** 21 + x;
}

export function keyToTile(key: number): { z: number; x: number; y: number } {
  const z = Math.floor(key / 2 ** 42);
  const rest = key - z * 2 ** 42;
  const y = Math.floor(rest / 2 ** 21);
  return { z, x: rest - y * 2 ** 21, y };
}

// Ground length of a tile's east-west edge at a latitude, on the sphere of the equatorial radius (as mercator scales).
export function tileWidthMeters(z: number, lat: number): number {
  return (2 * Math.PI * 6378137 * Math.cos((lat * Math.PI) / 180)) / 2 ** z;
}
