import { climate, cloudField, TUNING, yearFrac } from "../sim/weather";

// Pure parts of the cloud layer: the data texture and the zoom fade (PLAN-weather.md section 5).

export const TEX_W = 256;
export const TEX_H = 128;
export const ROWS_PER_FRAME = 16; // the next texture is built in slices of this many rows
export const REBUILD_MIN = 30; // game minutes between two textures

export const FADE_FROM = 5; // fully drawn below this zoom
export const FADE_TO = 6.5; // gone from here up

export const TEMP_MIN = -40; // °C stored as 0 in the B channel
export const TEMP_SPAN = 80;

export function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

// 1 far out on the globe, 0 once the map is close enough to see the town.
export const cloudOpacity = (zoom: number): number => 1 - smoothstep(FADE_FROM, FADE_TO, zoom);

// Index of the texture interval a game minute falls in, and how far through it we are (0..1).
export function interval(t: number): { k: number; f: number } {
  const k = Math.floor(t / REBUILD_MIN);
  return { k, f: t / REBUILD_MIN - k };
}

// RGBA8 grid, row 0 at the south pole, column 0 at -180°. R = cloud cover, G = precipitation (share of the
// model's maximum), B = air temperature at sea level mapped from -40..40 °C (the snow tint), A = 255.
export function buildCloudRows(out: Uint8Array, t: number, seed: number, phase: number, j0: number, j1: number, w = TEX_W, h = TEX_H): void {
  const frac = yearFrac(t, phase);
  for (let j = j0; j < Math.min(j1, h); j++) {
    const lat = -90 + ((j + 0.5) * 180) / h;
    const temp = climate(lat, 0, frac).mean;
    const b = Math.round(Math.min(1, Math.max(0, (temp - TEMP_MIN) / TEMP_SPAN)) * 255);
    for (let i = 0; i < w; i++) {
      const lng = -180 + ((i + 0.5) * 360) / w;
      const c = cloudField(lng, lat, t, seed, phase);
      const o = (j * w + i) * 4;
      out[o] = Math.round(Math.min(1, Math.max(0, c.cloud)) * 255);
      out[o + 1] = Math.round(Math.min(1, Math.max(0, c.precip / TUNING.precipMax)) * 255);
      out[o + 2] = b;
      out[o + 3] = 255;
    }
  }
}

export function buildCloudData(t: number, seed: number, phase: number, w = TEX_W, h = TEX_H): Uint8Array {
  const out = new Uint8Array(w * h * 4);
  buildCloudRows(out, t, seed, phase, 0, h, w, h);
  return out;
}

// Shell mesh in Web Mercator (0..1) plus lng/lat in radians; the grid stops at the mercator limit.
export const LAT_LIMIT = 85;
export function buildShellMesh(nLng = 120, nLat = 60): { verts: Float32Array; indices: Uint32Array } {
  const verts = new Float32Array((nLng + 1) * (nLat + 1) * 4);
  let o = 0;
  for (let j = 0; j <= nLat; j++) {
    const lat = -LAT_LIMIT + (j / nLat) * 2 * LAT_LIMIT;
    const la = (lat * Math.PI) / 180;
    const my = 0.5 - Math.log(Math.tan(Math.PI / 4 + la / 2)) / (2 * Math.PI);
    for (let i = 0; i <= nLng; i++) {
      const lng = -180 + (i / nLng) * 360;
      verts[o++] = (lng + 180) / 360;
      verts[o++] = my;
      verts[o++] = (lng * Math.PI) / 180;
      verts[o++] = la;
    }
  }
  const indices = new Uint32Array(nLng * nLat * 6);
  let k = 0;
  const row = nLng + 1;
  for (let j = 0; j < nLat; j++) {
    for (let i = 0; i < nLng; i++) {
      const a = j * row + i;
      // counter-clockwise seen from outside the globe (north is up, east to the right, y of mercator points down)
      indices[k++] = a;
      indices[k++] = a + 1;
      indices[k++] = a + row;
      indices[k++] = a + 1;
      indices[k++] = a + row + 1;
      indices[k++] = a + row;
    }
  }
  return { verts, indices };
}
