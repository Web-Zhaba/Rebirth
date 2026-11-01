import earcut from "earcut";
import type { Feature, FeatureCollection, Position } from "geojson";
import { latToMy, lngToMx } from "../geo/mercator";

// Overlay geometry (overlay/overlayRaster.ts): GeoJSON in lng/lat turned into what the overlay pipelines draw, in
// web-mercator metres (mercator units x the equator) relative to an anchor, so f32 keeps centimetres around the town.
// Mercator is conformal: around one place it is the ground scaled by 1/cos(lat), so shapes keep their angles.

export const EQUATOR = 2 * Math.PI * 6378137;

type Props = Record<string, unknown>;
type Value<T> = T | ((p: Props) => T);

export interface FillStyle {
  kind: "fill";
  color: Value<string>;
  opacity?: Value<number>;
  pattern?: Value<number>; // procedural pattern id (overlay.wgsl), 0 = none
}
export interface LineStyle {
  kind: "line";
  color: Value<string>;
  widthPx?: Value<number>; // screen px (the old map's line-width)
  widthM?: Value<number>; // ground metres; the wider of the two wins
  opacity?: Value<number>;
  dash?: [on: number, off: number]; // in line widths, like MapLibre's line-dasharray
}
export interface CircleStyle {
  kind: "circle";
  radiusPx: Value<number>;
  color: Value<string>;
  opacity?: Value<number>;
  strokeColor?: Value<string>;
  strokeWidthPx?: Value<number>;
  strokeOpacity?: Value<number>;
}
export type OverlayStyle = (FillStyle | LineStyle | CircleStyle) & { filter?: (p: Props) => boolean };

const val = <T>(v: Value<T> | undefined, p: Props, d: T): T => (v === undefined ? d : typeof v === "function" ? (v as (p: Props) => T)(p) : v);

// sRGB hex (#rgb or #rrggbb) and opacity -> packed RGBA8 (little endian: r in the low byte), not premultiplied.
export function packColor(hex: string, opacity = 1): number {
  let h = hex.replace("#", "");
  if (h.length === 3) h = h.replace(/./g, (c) => c + c);
  const n = parseInt(h.slice(0, 6), 16);
  const a = Math.round(Math.max(0, Math.min(1, opacity)) * 255);
  return ((a << 24) | ((n & 0xff) << 16) | (((n >> 8) & 0xff) << 8) | ((n >> 16) & 0xff)) >>> 0;
}

export const mercX = (lng: number) => lngToMx(lng) * EQUATOR;
export const mercY = (lat: number) => latToMy(lat) * EQUATOR;

// One layer's draw lists. Fills: triangle vertices (x, y, colour, pattern). Lines: segments (ax, ay, bx, by, length
// along the line at a, width px, width in mercator metres, colour, dash on, dash off). Circles: (x, y, radius px,
// colour, stroke colour, stroke px). Colours travel as their RGBA8 bits in an f32 slot.
export interface LayerGeometry {
  fills: Float32Array<ArrayBuffer>; // FILL_FLOATS per vertex
  lines: Float32Array<ArrayBuffer>; // LINE_FLOATS per segment
  circles: Float32Array<ArrayBuffer>; // CIRCLE_FLOATS per circle
}
export const LINE_FLOATS = 10;
export const CIRCLE_FLOATS = 6;

const u32 = new Uint32Array(1);
const f32 = new Float32Array(u32.buffer);
const bits = (u: number) => ((u32[0] = u), f32[0]);

export function buildLayer(data: FeatureCollection, style: OverlayStyle, anchor: [number, number]): LayerGeometry {
  const fills: number[] = [];
  const lines: number[] = [];
  const circles: number[] = [];
  const [ax, ay] = anchor;
  const xy = (p: Position): [number, number] => [mercX(p[0]) - ax, mercY(p[1]) - ay];
  for (const f of data.features as Feature[]) {
    const p = (f.properties ?? {}) as Props;
    if (style.filter && !style.filter(p)) continue;
    const g = f.geometry;
    if (!g) continue;
    if (style.kind === "fill") {
      const colour = packColor(val(style.color, p, "#000"), val(style.opacity, p, 1));
      const pattern = val(style.pattern, p, 0);
      const polys = g.type === "Polygon" ? [g.coordinates] : g.type === "MultiPolygon" ? g.coordinates : [];
      for (const poly of polys) {
        const flat: number[] = [];
        const holes: number[] = [];
        poly.forEach((ring, i) => {
          if (i > 0) holes.push(flat.length / 2);
          for (const q of ring) flat.push(...xy(q));
        });
        const tri = earcut(flat, holes, 2);
        for (const i of tri) fills.push(flat[i * 2], flat[i * 2 + 1], bits(colour), pattern);
      }
    } else if (style.kind === "line") {
      const colour = packColor(val(style.color, p, "#000"), val(style.opacity, p, 1));
      const wpx = val(style.widthPx, p, 0);
      const wm = val(style.widthM, p, 0);
      const [on, off] = style.dash ?? [0, 0];
      const parts =
        g.type === "LineString" ? [g.coordinates] : g.type === "MultiLineString" ? g.coordinates : g.type === "Polygon" ? g.coordinates : g.type === "MultiPolygon" ? g.coordinates.flat() : [];
      for (const part of parts) {
        let along = 0;
        for (let i = 0; i + 1 < part.length; i++) {
          const a = xy(part[i]);
          const b = xy(part[i + 1]);
          // Ground metres to mercator metres at this latitude, so the shader scales both widths the same way.
          lines.push(a[0], a[1], b[0], b[1], along, wpx, wm / Math.cos((part[i][1] * Math.PI) / 180), bits(colour), on, off);
          along += Math.hypot(b[0] - a[0], b[1] - a[1]);
        }
      }
    } else {
      const colour = packColor(val(style.color, p, "#000"), val(style.opacity, p, 1));
      const stroke = packColor(val(style.strokeColor, p, "#000"), style.strokeColor === undefined ? 0 : val(style.strokeOpacity, p, 1));
      const r = val(style.radiusPx, p, 4);
      const sw = val(style.strokeWidthPx, p, 0);
      const pts = g.type === "Point" ? [g.coordinates] : g.type === "MultiPoint" ? g.coordinates : [];
      for (const q of pts) {
        const c = xy(q);
        circles.push(c[0], c[1], r, bits(colour), bits(stroke), sw);
      }
    }
  }
  return { fills: new Float32Array(fills), lines: new Float32Array(lines), circles: new Float32Array(circles) };
}

export const FILL_FLOATS = 4;

// The square of mercator a raster level covers: centre snapped to an eighth of the side, side to quarter octaves (at
// most 19 % more than asked), so a moving camera re-rasterises only when it has moved or zoomed a real step.
export function levelSquare(cx: number, cy: number, sideWanted: number): { x0: number; y0: number; side: number } {
  const side = 2 ** (Math.ceil(Math.log2(Math.max(1, sideWanted)) * 4) / 4);
  const step = side / 8;
  const x0 = Math.round(cx / step) * step - side / 2;
  const y0 = Math.round(cy / step) * step - side / 2;
  return { x0, y0, side };
}
