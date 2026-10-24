// Local tangent-plane frame centred on the founding point: x east, y north, meters.
const A = 6378137; // WGS84 semi-major axis, m
const E2 = 0.00669437999014; // WGS84 first eccentricity squared
const RAD = Math.PI / 180;

export interface Frame {
  toLocal(lng: number, lat: number): [number, number];
  toLngLat(x: number, y: number): [number, number];
}

export function makeFrame(lat0: number, lng0: number): Frame {
  const phi0 = lat0 * RAD;
  const w = 1 - E2 * Math.sin(phi0) ** 2;
  const M = (A * (1 - E2)) / w ** 1.5; // meridional radius
  const N = A / Math.sqrt(w); // prime-vertical radius
  const kx = N * Math.cos(phi0);
  return {
    toLocal: (lng, lat) => [(lng - lng0) * RAD * kx, (lat - lat0) * RAD * M],
    toLngLat: (x, y) => [lng0 + x / kx / RAD, lat0 + y / M / RAD],
  };
}
