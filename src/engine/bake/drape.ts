import type { VectorTile } from "@mapbox/vector-tile";
import { biomeColor, C, isDrawnLandcover } from "../../world/biome";
import { fillBiomes, type BiomeMap } from "../../world/biomes";
import { COVER_TABLE, coverIdOf } from "../../world/forestMix";
import { isNatureWater, isNatureWaterway } from "../../world/nature";

// Drape pages: the land's colour and water coverage over one quadtree tile, rasterised from the OpenMapTiles tile of
// the same place (docs/PLAN-engine.md section 4, "Far world" and "Water") over the biome of the place (world/biomes.ts).
// RGB is the atlas colour (sRGB, the palette of world/biome.ts), alpha is water coverage. The terrain shader lights the colour and
// shades water where alpha is high, so one texture replaces the fill, line, shore and hillshade layers of the old map.
//
// The same page carries the vegetation cover for the GPU tree scatter (N5, `rasterCover`): an 8-bit class id per texel
// (world/forestMix.ts COVER_TABLE, 0 = nothing grows), rasterised without antialiasing so every texel is one class, the
// first feature of the tile winning like the old scatter's point-in-polygon tests.
//
// Nature comes from tiles generalised at z12 at most (world/nature.ts NATURE_MAXZOOM): deeper pages draw a sub-square
// of their z12 ancestor at a finer scale, so edges stay sharp near the camera without fetching z13+ tiles.

export const DRAPE_SIZE = 256;
export const DRAPE_MAX_ZOOM = 16; // ~2.4 m per texel at 60 deg latitude; deeper nodes reuse the z16 page
export const SOURCE_MAX_ZOOM = 12;

const EQUATOR = 2 * Math.PI * 6378137;
const FOREST_EDGE_M = 120; // dark band just inside dense forest
const SHORE_M = 150; // sand band where the land meets water (its outer half shows)
const RIVER_M = 10; // width of a river or stream drawn from a line

export interface DrapeFeature {
  kind: "land" | "water" | "forestEdge" | "river";
  color: string;
  cls: string; // landcover class/subclass (land features), for the cover id
  sub: string;
  rings: number[][]; // flat [x, y, ...] in source tile units; one line per entry for rivers
}

export interface DrapeSource {
  extent: number;
  features: DrapeFeature[];
}

// The source tile of a page and the square of it the page covers, in source tile units.
export function sourceOf(z: number, x: number, y: number): { z: number; x: number; y: number; dz: number } {
  const sz = Math.min(z, SOURCE_MAX_ZOOM);
  const dz = z - sz;
  return { z: sz, x: x >> dz, y: y >> dz, dz };
}

// Ground metres per page pixel at the page's centre latitude.
export function pageMpp(z: number, y: number): number {
  const n = Math.PI - (2 * Math.PI * (y + 0.5)) / 2 ** z;
  const lat = Math.atan(Math.sinh(n));
  return (EQUATOR * Math.cos(lat)) / 2 ** z / DRAPE_SIZE;
}

// Features of an OpenMapTiles tile the drape draws, in paint order: landcover, then water, then rivers.
export function parseSource(vt: VectorTile | null): DrapeSource {
  const out: DrapeSource = { extent: 4096, features: [] };
  if (!vt) return out;
  const land = vt.layers.landcover;
  if (land) {
    out.extent = land.extent;
    for (let i = 0; i < land.length; i++) {
      const f = land.feature(i);
      if (f.type !== 3 || !isDrawnLandcover(f.properties)) continue;
      const cls = String(f.properties.class ?? "");
      const sub = String(f.properties.subclass ?? "");
      const rings = f.loadGeometry().map(flat);
      out.features.push({ kind: "land", color: biomeColor(cls, sub), cls, sub, rings });
      if (cls === "wood" && sub === "forest") out.features.push({ kind: "forestEdge", color: C.forestDeep, cls, sub, rings });
    }
  }
  const water = vt.layers.water;
  if (water) {
    out.extent = water.extent;
    for (let i = 0; i < water.length; i++) {
      const f = water.feature(i);
      if (f.type === 3 && isNatureWater(f.properties)) out.features.push({ kind: "water", color: C.water, cls: "", sub: "", rings: f.loadGeometry().map(flat) });
    }
  }
  const ways = vt.layers.waterway;
  if (ways)
    for (let i = 0; i < ways.length; i++) {
      const f = ways.feature(i);
      if (f.type === 2 && isNatureWaterway(f.properties)) out.features.push({ kind: "river", color: C.water, cls: "", sub: "", rings: f.loadGeometry().map(flat) });
    }
  return out;
}

const flat = (r: { x: number; y: number }[]) => r.flatMap((p) => [p.x, p.y]);

type Ctx = OffscreenCanvasRenderingContext2D;

// The square of the source tile a page covers: page px = (source unit - o) * k.
function pageWindow(src: DrapeSource, z: number, x: number, y: number): { ox: number; oy: number; k: number } {
  const n = 2 ** sourceOf(z, x, y).dz;
  const size = src.extent / n; // source units the page spans
  return { ox: (x % n) * size, oy: (y % n) * size, k: DRAPE_SIZE / size };
}

// The land's base colour under page (z, x, y), RGBA row by row: the biome field (world/biomes.ts) sampled on a
// (BASE_GRID + 1)^2 grid of points from edge to edge, so neighbouring pages share their edge samples, and bilinearly
// spread over the texels. Far pages show the biome as seen from orbit, near ones its open ground
// (docs/PLAN-biomes.md step 3).
const BASE_GRID = 64;
export function biomeBase(map: BiomeMap, z: number, x: number, y: number): Uint8ClampedArray<ArrayBuffer> {
  const G = BASE_GRID;
  const n = 2 ** z;
  const lngs = Array.from({ length: G + 1 }, (_, i) => ((x + i / G) / n) * 360 - 180);
  const lats = Array.from({ length: G + 1 }, (_, j) => (Math.atan(Math.sinh(Math.PI - (2 * Math.PI * (y + j / G)) / n)) * 180) / Math.PI);
  const grid = new Uint8ClampedArray((G + 1) * (G + 1) * 4);
  fillBiomes(map, lngs, lats, smoothstep(7, 11, z), grid);
  const S = DRAPE_SIZE;
  const out = new Uint8ClampedArray(S * S * 4);
  for (let j = 0; j < S; j++) {
    const v = ((j + 0.5) / S) * G;
    const j0 = Math.min(G - 1, Math.floor(v));
    const fv = v - j0;
    for (let i = 0; i < S; i++) {
      const u = ((i + 0.5) / S) * G;
      const i0 = Math.min(G - 1, Math.floor(u));
      const fu = u - i0;
      const a = (j0 * (G + 1) + i0) * 4;
      const b = a + (G + 1) * 4;
      const o = (j * S + i) * 4;
      for (let k = 0; k < 3; k++) {
        const top = grid[a + k] + (grid[a + 4 + k] - grid[a + k]) * fu;
        const bottom = grid[b + k] + (grid[b + 4 + k] - grid[b + k]) * fu;
        out[o + k] = top + (bottom - top) * fv;
      }
      out[o + 3] = 255;
    }
  }
  return out;
}

const smoothstep = (a: number, b: number, t: number) => {
  const k = Math.min(1, Math.max(0, (t - a) / (b - a)));
  return k * k * (3 - 2 * k);
};

// Paint page (z, x, y) from its source tile over its base colour (`biomeBase`, or the meadow fill without one).
// `colour` gets the atlas colours, `water` the coverage mask (white = water).
export function paintDrape(colour: Ctx, water: Ctx, src: DrapeSource, z: number, x: number, y: number, base: ImageData | null): void {
  const S = DRAPE_SIZE;
  const { ox, oy, k } = pageWindow(src, z, x, y);
  const mpp = pageMpp(z, y);
  const px = (m: number) => m / mpp;

  const path = (rings: number[][], close: boolean) => {
    const p = new Path2D();
    for (const r of rings) {
      p.moveTo((r[0] - ox) * k, (r[1] - oy) * k);
      for (let i = 2; i < r.length; i += 2) p.lineTo((r[i] - ox) * k, (r[i + 1] - oy) * k);
      if (close) p.closePath();
    }
    return p;
  };
  // A band too thin to see at this scale fades instead of drawing a hairline.
  const band = (ctx: Ctx, p: Path2D, colour: string, widthM: number, alpha: number) => {
    const w = px(widthM);
    if (w < 0.5) return;
    ctx.save();
    ctx.globalAlpha = alpha * Math.min(1, w / 2);
    ctx.strokeStyle = colour;
    ctx.lineWidth = w;
    ctx.lineJoin = "round";
    ctx.filter = `blur(${Math.max(0.5, w / 4)}px)`;
    ctx.stroke(p);
    ctx.restore();
  };

  if (base) colour.putImageData(base, 0, 0);
  else {
    colour.fillStyle = C.meadow;
    colour.fillRect(0, 0, S, S);
  }
  water.fillStyle = "#000";
  water.fillRect(0, 0, S, S);

  const waters: Path2D[] = [];
  for (const f of src.features) {
    if (f.kind === "land") {
      colour.fillStyle = f.color;
      colour.fill(path(f.rings, true), "evenodd");
    } else if (f.kind === "forestEdge") {
      const p = path(f.rings, true);
      colour.save();
      colour.clip(p, "evenodd"); // inside only: the edge of the forest reads as a gradient into it
      band(colour, p, f.color, FOREST_EDGE_M, 0.6);
      colour.restore();
    } else if (f.kind === "water") waters.push(path(f.rings, true));
  }
  // Shore under the water fill, so only its outer half shows; then the water itself, in colour and in the mask.
  for (const p of waters) band(colour, p, C.shore, SHORE_M, 1);
  colour.fillStyle = C.water;
  water.fillStyle = "#fff";
  for (const p of waters) {
    colour.fill(p, "evenodd");
    water.fill(p, "evenodd");
  }
  const river = Math.max(1, px(RIVER_M));
  for (const f of src.features) {
    if (f.kind !== "river") continue;
    const p = path(f.rings, false);
    for (const ctx of [colour, water]) {
      ctx.save();
      ctx.strokeStyle = ctx === colour ? C.water : "#fff";
      ctx.lineWidth = river;
      ctx.lineCap = ctx.lineJoin = "round";
      ctx.stroke(p);
      ctx.restore();
    }
  }

}

// The vegetation class id of every texel of page (z, x, y), row by row: a scanline fill of each landcover polygon
// (even-odd, texel centres inside), where no earlier feature already claimed the texel; texels under water (the mask's
// red at least half) stay 0.
export function rasterCover(src: DrapeSource, z: number, x: number, y: number, water: Uint8ClampedArray | null): Uint8Array<ArrayBuffer> {
  const S = DRAPE_SIZE;
  const out = new Uint8Array(S * S);
  const { ox, oy, k } = pageWindow(src, z, x, y);
  const xs: number[] = [];
  for (const f of src.features) {
    if (f.kind !== "land") continue;
    const id = coverIdOf(f.cls, f.sub);
    if (!id) continue;
    // the feature's rings in page px, and the rows they span
    const rings = f.rings.map((r) => r.map((v, i) => (i & 1 ? (v - oy) * k : (v - ox) * k)));
    let top = Infinity;
    let bottom = -Infinity;
    for (const r of rings) for (let i = 1; i < r.length; i += 2) (top = Math.min(top, r[i])), (bottom = Math.max(bottom, r[i]));
    const j0 = Math.max(0, Math.ceil(top - 0.5));
    const j1 = Math.min(S - 1, Math.floor(bottom - 0.5));
    for (let j = j0; j <= j1; j++) {
      const cy = j + 0.5;
      xs.length = 0;
      for (const r of rings) {
        const n = r.length;
        for (let a = 0, b = n - 2; a < n; b = a, a += 2) {
          const ya = r[a + 1];
          const yb = r[b + 1];
          if (ya > cy !== yb > cy) xs.push(r[a] + ((cy - ya) * (r[b] - r[a])) / (yb - ya));
        }
      }
      xs.sort((p, q) => p - q);
      const row = j * S;
      for (let s = 0; s + 1 < xs.length; s += 2) {
        const i0 = Math.max(0, Math.ceil(xs[s] - 0.5));
        const i1 = Math.min(S, Math.ceil(xs[s + 1] - 0.5));
        for (let i = i0; i < i1; i++) if (!out[row + i]) out[row + i] = id;
      }
    }
  }
  if (water) for (let i = 0; i < out.length; i++) if (water[i * 4] >= 128) out[i] = 0;
  return out;
}

// What grows over each of COVER_BLOCKS x COVER_BLOCKS squares of a page: the mean tree, bush, reed and boulder share of
// its texels (world/forestMix.ts COVER_TABLE), 4 floats per block, row by row. The scatter's budget reads the blocks
// under a tile, so a coarse page standing in for a finer one still gives the local mix, not the whole page's.
export const COVER_BLOCKS = 16;
export function coverBlocks(cover: Uint8Array): Float32Array<ArrayBuffer> {
  const B = COVER_BLOCKS;
  const side = DRAPE_SIZE / B;
  const out = new Float32Array(B * B * 4);
  for (let j = 0; j < DRAPE_SIZE; j++)
    for (let i = 0; i < DRAPE_SIZE; i++) {
      const c = COVER_TABLE[cover[j * DRAPE_SIZE + i] - 1];
      if (!c) continue;
      const o = (Math.floor(j / side) * B + Math.floor(i / side)) * 4;
      out[o] += c.tree ? 1 : 0;
      out[o + 1] += c.bush;
      out[o + 2] += c.reed;
      out[o + 3] += c.boulder;
    }
  for (let k = 0; k < out.length; k++) out[k] /= side * side;
  return out;
}

// Interleave the colour canvas's RGB with the mask's red channel as alpha.
export function packDrape(rgba: Uint8ClampedArray, mask: Uint8ClampedArray): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(rgba.length);
  for (let i = 0; i < rgba.length; i += 4) {
    out[i] = rgba[i];
    out[i + 1] = rgba[i + 1];
    out[i + 2] = rgba[i + 2];
    out[i + 3] = mask[i];
  }
  return out;
}
