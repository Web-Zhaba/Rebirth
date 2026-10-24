import { VectorTile } from "@mapbox/vector-tile";
import { PbfReader } from "pbf";
import {
  NATURE_MAXZOOM,
  OMT_TILEJSON_URL,
  TERRAIN_URL,
  TERRAIN_ZOOM,
  WATERWAY_ZOOM,
  isNatureLandcover,
  isNatureWater,
  isNatureWaterway,
} from "./nature";
import { decodeTerrariumPixels, TERRARIUM_SIZE } from "./terrain";

// Geometry is kept in tile coordinates (0..extent) with a bbox for fast rejection.
export type BBox = [number, number, number, number];
export interface Poly {
  cls: string;
  bbox: BBox;
  rings: number[][]; // flat [x, y, x, y, ...] per ring; even-odd across all rings
}
export interface Line {
  bbox: BBox;
  pts: number[]; // flat [x, y, ...]
}
export interface LandTile {
  extent: number;
  land: Poly[];
  water: Poly[];
}
export interface WaterwayTile {
  extent: number;
  lines: Line[];
}

// Failed loads are dropped from the cache so a later call can retry.
const cache = new Map<string, Promise<unknown>>();
function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  let p = cache.get(key) as Promise<T> | undefined;
  if (!p) {
    p = load();
    cache.set(key, p);
    p.catch(() => {
      if (cache.get(key) === p) cache.delete(key);
    });
  }
  return p;
}

export function getDemTile(x: number, y: number): Promise<Float32Array> {
  return cached(`dem/${x}/${y}`, async () => {
    const url = TERRAIN_URL.replace("{z}", String(TERRAIN_ZOOM)).replace("{x}", String(x)).replace("{y}", String(y));
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${res.status} ${url}`);
    // No color management or alpha premultiplication: the RGB bytes encode meters.
    const bmp = await createImageBitmap(await res.blob(), { colorSpaceConversion: "none", premultiplyAlpha: "none" });
    const ctx = new OffscreenCanvas(TERRARIUM_SIZE, TERRARIUM_SIZE).getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("2d context unavailable");
    ctx.drawImage(bmp, 0, 0);
    bmp.close();
    return decodeTerrariumPixels(ctx.getImageData(0, 0, TERRARIUM_SIZE, TERRARIUM_SIZE).data);
  });
}

// The tile URL is versioned: read it from TileJSON once.
let template: Promise<string> | undefined;
function tileTemplate(): Promise<string> {
  if (!template) {
    const p = fetch(OMT_TILEJSON_URL)
      .then((r) => {
        if (!r.ok) throw new Error(`${r.status} ${OMT_TILEJSON_URL}`);
        return r.json() as Promise<{ tiles: string[] }>;
      })
      .then((j) => j.tiles[0]);
    p.catch(() => {
      if (template === p) template = undefined;
    });
    template = p;
  }
  return template;
}

// A missing tile (404/204) means no features there, e.g. open ocean.
export async function loadVector(z: number, x: number, y: number): Promise<VectorTile | null> {
  const url = (await tileTemplate()).replace("{z}", String(z)).replace("{x}", String(x)).replace("{y}", String(y));
  const res = await fetch(url);
  if (res.status === 404 || res.status === 204) return null;
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return new VectorTile(new PbfReader(await res.arrayBuffer()));
}

type Pt = { x: number; y: number };

function bboxOf(rings: Pt[][]): BBox {
  const b: BBox = [Infinity, Infinity, -Infinity, -Infinity];
  for (const r of rings)
    for (const p of r) {
      if (p.x < b[0]) b[0] = p.x;
      if (p.y < b[1]) b[1] = p.y;
      if (p.x > b[2]) b[2] = p.x;
      if (p.y > b[3]) b[3] = p.y;
    }
  return b;
}

const flat = (r: Pt[]) => r.flatMap((p) => [p.x, p.y]);

export function getLandTile(x: number, y: number): Promise<LandTile> {
  return cached(`land/${x}/${y}`, async () => {
    const out: LandTile = { extent: 4096, land: [], water: [] };
    const vt = await loadVector(NATURE_MAXZOOM, x, y);
    if (!vt) return out;
    const jobs: [string, Poly[], (p: Record<string, unknown>) => boolean][] = [
      ["landcover", out.land, isNatureLandcover],
      ["water", out.water, isNatureWater],
    ];
    for (const [name, list, keep] of jobs) {
      const layer = vt.layers[name];
      if (!layer) continue;
      out.extent = layer.extent;
      for (let i = 0; i < layer.length; i++) {
        const f = layer.feature(i);
        if (f.type !== 3 || !keep(f.properties)) continue;
        const rings = f.loadGeometry();
        list.push({ cls: String(f.properties.class ?? ""), bbox: bboxOf(rings), rings: rings.map(flat) });
      }
    }
    return out;
  });
}

export function getWaterwayTile(x: number, y: number): Promise<WaterwayTile> {
  return cached(`waterway/${x}/${y}`, async () => {
    const out: WaterwayTile = { extent: 4096, lines: [] };
    const vt = await loadVector(WATERWAY_ZOOM, x, y);
    const layer = vt?.layers.waterway;
    if (!layer) return out;
    out.extent = layer.extent;
    for (let i = 0; i < layer.length; i++) {
      const f = layer.feature(i);
      if (f.type !== 2 || !isNatureWaterway(f.properties)) continue;
      for (const line of f.loadGeometry()) out.lines.push({ bbox: bboxOf([line]), pts: flat(line) });
    }
    return out;
  });
}
