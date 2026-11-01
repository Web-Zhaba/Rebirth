import type { VectorTile } from "@mapbox/vector-tile";
import { biomeColor, C, isDrawnLandcover } from "../../world/biome";
import { isNatureWater, isNatureWaterway } from "../../world/nature";

// Drape pages: the land's colour and water coverage over one quadtree tile, rasterised from the OpenMapTiles tile of
// the same place (docs/PLAN-engine.md section 4, "Far world" and "Water"). RGB is the atlas colour (sRGB, the palette of
// world/biome.ts, the same as the MapLibre style), alpha is water coverage. The terrain shader lights the colour and
// shades water where alpha is high, so one texture replaces the fill, line, shore and hillshade layers of the old map.
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
      out.features.push({ kind: "land", color: biomeColor(cls, sub), rings });
      if (cls === "wood" && sub === "forest") out.features.push({ kind: "forestEdge", color: C.forestDeep, rings });
    }
  }
  const water = vt.layers.water;
  if (water) {
    out.extent = water.extent;
    for (let i = 0; i < water.length; i++) {
      const f = water.feature(i);
      if (f.type === 3 && isNatureWater(f.properties)) out.features.push({ kind: "water", color: C.water, rings: f.loadGeometry().map(flat) });
    }
  }
  const ways = vt.layers.waterway;
  if (ways)
    for (let i = 0; i < ways.length; i++) {
      const f = ways.feature(i);
      if (f.type === 2 && isNatureWaterway(f.properties)) out.features.push({ kind: "river", color: C.water, rings: f.loadGeometry().map(flat) });
    }
  return out;
}

const flat = (r: { x: number; y: number }[]) => r.flatMap((p) => [p.x, p.y]);

type Ctx = OffscreenCanvasRenderingContext2D;

// Paint page (z, x, y) from its source tile. `colour` gets the atlas colours, `water` the coverage mask (white = water).
export function paintDrape(colour: Ctx, water: Ctx, src: DrapeSource, z: number, x: number, y: number): void {
  const S = DRAPE_SIZE;
  const { dz } = sourceOf(z, x, y);
  const n = 2 ** dz;
  const size = src.extent / n; // source units the page spans
  const ox = (x % n) * size;
  const oy = (y % n) * size;
  const k = S / size;
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

  colour.fillStyle = C.meadow;
  colour.fillRect(0, 0, S, S);
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
