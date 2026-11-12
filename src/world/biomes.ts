import { C } from "./biome";
import { decodePng } from "./pngDecoder";

// Biomes of the rewilded Earth: which one covers a place, and the colour the drape bake paints
// as the land's base under the landcover polygons (engine/bake/drape.ts). The map is RESOLVE Ecoregions 2017
// rasterised by scripts/bake-biomes.mjs: an equirectangular grid of class ids (BIOMES[id - 1]), the sea filled with
// the nearest land's class, since the drape decides water.
//
// A place's colour blends the four map pixels around it, at a point warped by world-space noise, so borders read as
// ragged ecotones rather than 10 km squares; low-frequency patches mix in each biome's second tone. Noise runs on the
// unit-sphere position: no seam at the antimeridian or between pages.

export interface Biome {
  key: string;
  far: string; // how it reads from orbit (a jungle is canopy)
  alt: string; // second tone, in patches
  open: string; // open ground between the landcover polygons, near the camera
  cold?: string; // far and open colour towards the poles (cold deserts)
}

// Ids from 1, in the order of scripts/bake-biomes.mjs CLASS_OF.
export const BIOMES: readonly Biome[] = [
  { key: "rainforest", far: "#1f3a1c", alt: "#284520", open: "#4a6a35" },
  { key: "dryForest", far: "#3d4a26", alt: "#4f5530", open: "#6a6a3c" },
  { key: "savanna", far: "#7a7140", alt: "#6b6a3a", open: "#857a48" },
  { key: "broadleaf", far: "#33482a", alt: "#3c5030", open: "#55663f" },
  { key: "conifer", far: "#26362a", alt: "#2f3f2c", open: "#4e5a42" },
  { key: "taiga", far: "#263224", alt: "#343d2c", open: "#56604a" },
  { key: "steppe", far: "#77754a", alt: "#6c6d45", open: "#7d7a4e" },
  { key: "swamp", far: "#3f5236", alt: "#4a5a3c", open: "#4a5a3c" },
  { key: "mountainMeadow", far: "#6b6a4d", alt: "#5f604a", open: "#6e6c50" },
  { key: "tundra", far: "#6a6a55", alt: "#5d6050", open: "#6e6d58" },
  { key: "mediterranean", far: "#5d6040", alt: "#6b6847", open: "#6c6a45" },
  { key: "desert", far: "#a08a5c", alt: "#8c7a58", open: "#a08a5c", cold: "#8a806a" },
  { key: "mangrove", far: "#2b4028", alt: "#2f4529", open: "#3f5236" },
  { key: "ice", far: C.ice, alt: "#d2dcdc", open: C.ice },
];

export const biomeId = (key: string): number => BIOMES.findIndex((b) => b.key === key) + 1;

export interface BiomeMap {
  width: number;
  height: number;
  ids: Uint8Array; // class id per pixel, row by row from 90 deg N, columns from 180 deg W
}

export async function decodeBiomeMap(png: ArrayBuffer | Uint8Array): Promise<BiomeMap> {
  const { width, height, rgba } = await decodePng(png);
  const ids = new Uint8Array(width * height);
  for (let i = 0; i < ids.length; i++) ids[i] = rgba[i * 4];
  return { width, height, ids };
}

let loading: Promise<BiomeMap> | null = null;
export function loadBiomeMap(): Promise<BiomeMap> {
  loading ??= fetch(new URL("./biomes.png", import.meta.url))
    .then((r) => {
      if (!r.ok) throw new Error(`biome map: HTTP ${r.status}`);
      return r.arrayBuffer();
    })
    .then(decodeBiomeMap);
  return loading;
}

// The class at a point, nearest pixel, no warp.
export function biomeAt(map: BiomeMap, lng: number, lat: number): number {
  const { width: W, height: H } = map;
  const x = Math.floor((((lng + 180) / 360) * W) % W);
  const y = Math.min(H - 1, Math.max(0, Math.floor(((90 - lat) / 180) * H)));
  return map.ids[y * W + ((x + W) % W)];
}

const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const TONES = BIOMES.map((b) => ({ far: rgb(b.far), alt: rgb(b.alt), open: rgb(b.open), cold: b.cold ? rgb(b.cold) : null }));

// Value noise on the integer lattice, 0..1.
function hash(i: number, j: number, k: number): number {
  let h = Math.imul(i, 0x27d4eb2d) ^ Math.imul(j, 0x165667b1) ^ Math.imul(k, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function noise(x: number, y: number, z: number): number {
  const i = Math.floor(x);
  const j = Math.floor(y);
  const k = Math.floor(z);
  const fx = x - i;
  const fy = y - j;
  const fz = z - k;
  const u = fx * fx * (3 - 2 * fx);
  const v = fy * fy * (3 - 2 * fy);
  const w = fz * fz * (3 - 2 * fz);
  const h000 = hash(i, j, k);
  const h100 = hash(i + 1, j, k);
  const h010 = hash(i, j + 1, k);
  const h110 = hash(i + 1, j + 1, k);
  const h001 = hash(i, j, k + 1);
  const h101 = hash(i + 1, j, k + 1);
  const h011 = hash(i, j + 1, k + 1);
  const h111 = hash(i + 1, j + 1, k + 1);
  const a = h000 + (h100 - h000) * u;
  const b = h010 + (h110 - h010) * u;
  const c = h001 + (h101 - h001) * u;
  const d = h011 + (h111 - h011) * u;
  const near = a + (b - a) * v;
  return near + (c + (d - c) * v - near) * w;
}

const R_KM = 6371;
const WARP = [
  { f: R_KM / 70, deg: 0.4 }, // cells (km) and how far they push the sample point (deg of latitude)
  { f: R_KM / 14, deg: 0.08 },
];
const PATCH = [R_KM / 180, R_KM / 30];
const smooth = (a: number, b: number, t: number) => {
  const k = Math.min(1, Math.max(0, (t - a) / (b - a)));
  return k * k * (3 - 2 * k);
};

// Add class `id`'s colour, weighted, to acc: patch share p of its second tone, cold share, near share of open ground.
function addTone(acc: Float64Array, id: number, wgt: number, p: number, cold: number, near: number): void {
  const t = TONES[id - 1];
  if (!wgt || !t) return;
  for (let k = 0; k < 3; k++) {
    let far = t.far[k] + (t.alt[k] - t.far[k]) * p;
    let open = t.open[k];
    if (t.cold) {
      far += (t.cold[k] - far) * cold;
      open += (t.cold[k] - open) * cold;
    }
    acc[k] += (far + (open - far) * near) * wgt;
  }
}

// Fill `out` (RGBA, row by row) with the base colour of a grid of points: `lngs` per column, `lats` per row (degrees).
// `near` 0..1 blends from the far colours to the open ground.
export function fillBiomes(map: BiomeMap, lngs: ArrayLike<number>, lats: ArrayLike<number>, near: number, out: Uint8ClampedArray): void {
  const { width: W, height: H, ids } = map;
  const cosLng = Float64Array.from(lngs, (l) => Math.cos((l * Math.PI) / 180));
  const sinLng = Float64Array.from(lngs, (l) => Math.sin((l * Math.PI) / 180));
  const acc = new Float64Array(3);
  for (let r = 0; r < lats.length; r++) {
    const lat = lats[r];
    const cl = Math.cos((lat * Math.PI) / 180);
    const sl = Math.sin((lat * Math.PI) / 180);
    const cold = smooth(30, 42, Math.abs(lat));
    const lngScale = 1 / Math.max(0.2, cl);
    for (let c = 0; c < lngs.length; c++) {
      const x = cl * cosLng[c];
      const y = cl * sinLng[c];
      const z = sl;
      let dLat = 0;
      let dLng = 0;
      for (const o of WARP) {
        dLat += (noise(x * o.f, y * o.f, z * o.f) - 0.5) * 2 * o.deg;
        dLng += (noise(x * o.f + 31.7, y * o.f + 17.3, z * o.f + 5.1) - 0.5) * 2 * o.deg * lngScale;
      }
      const patch = 0.65 * noise(x * PATCH[0], y * PATCH[0], z * PATCH[0]) + 0.35 * noise(x * PATCH[1], y * PATCH[1], z * PATCH[1]);
      const p = smooth(0.4, 0.75, patch) * (1 - near);

      // The four map pixels around the warped point, by their centres.
      const u = ((lngs[c] + dLng + 180) / 360) * W - 0.5;
      const v = Math.min(H - 1, Math.max(0, ((90 - lat - dLat) / 180) * H - 0.5));
      const i0 = Math.floor(u);
      const j0 = Math.floor(v);
      const fu = u - i0;
      const fv = v - j0;
      const xa = ((i0 % W) + W) % W;
      const xb = (xa + 1) % W;
      const ya = j0 * W;
      const yb = Math.min(H - 1, j0 + 1) * W;
      acc.fill(0);
      addTone(acc, ids[ya + xa], (1 - fu) * (1 - fv), p, cold, near);
      addTone(acc, ids[ya + xb], fu * (1 - fv), p, cold, near);
      addTone(acc, ids[yb + xa], (1 - fu) * fv, p, cold, near);
      addTone(acc, ids[yb + xb], fu * fv, p, cold, near);
      const o = (r * lngs.length + c) * 4;
      out[o] = acc[0];
      out[o + 1] = acc[1];
      out[o + 2] = acc[2];
      out[o + 3] = 255;
    }
  }
}
