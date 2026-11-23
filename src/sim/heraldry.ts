import { clipBox } from "../map/geometryClip";

export const FLAG_PATTERNS = ["plain", "pale", "fess", "bend", "chevron", "quarterly", "cross"] as const;
export const FLAG_SYMBOLS = ["pine", "wheat", "sun", "star", "mountain", "tower", "fish", "diamond"] as const;
export const MAX_FLAG_LAYERS = 4;
export type FlagPattern = (typeof FLAG_PATTERNS)[number];
export type FlagSymbol = (typeof FLAG_SYMBOLS)[number];
export type FlagLayer = { symbol: FlagSymbol; color: string; x: number; y: number; size: number };
export type FlagDesign = { pattern: FlagPattern; field: string; division: string; layers: FlagLayer[] };

export const DEFAULT_FLAG: FlagDesign = {
  pattern: "chevron", field: "#285347", division: "#d29c4c",
  layers: [{ symbol: "pine", color: "#f5e6bd", x: 75, y: 52, size: 48 }],
};

const record = (v: unknown, keys: readonly string[]): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v) && Object.keys(v).every(key => keys.includes(key));
const color = (v: unknown): v is string => typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v);
const within = (v: unknown, min: number, max: number) => typeof v === "number" && Number.isFinite(v) && v >= min && v <= max;

export function isFlagDesign(v: unknown): v is FlagDesign {
  return record(v, ["pattern", "field", "division", "layers"]) && FLAG_PATTERNS.some(p => p === v.pattern) && color(v.field) && color(v.division)
    && Array.isArray(v.layers) && v.layers.length <= MAX_FLAG_LAYERS && Object.keys(v.layers).length === v.layers.length
    && Array.from(v.layers).every(l => record(l, ["symbol", "color", "x", "y", "size"]) && FLAG_SYMBOLS.some(s => s === l.symbol) && color(l.color)
      && within(l.x, 20, 130) && within(l.y, 20, 80) && within(l.size, 12, 50));
}

type Point = [number, number];
type Polygon = Point[];
type Shape = { color: string; points: Polygon };
const rect = (x0: number, y0: number, x1: number, y1: number): Polygon => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const FIELD = rect(0, 0, 150, 100);
const divisions: Record<FlagPattern, Polygon[]> = {
  plain: [],
  pale: [rect(75, 0, 150, 100)],
  fess: [rect(0, 50, 150, 100)],
  bend: [[[0, 0], [23, 0], [150, 84], [150, 100], [127, 100], [0, 16]]],
  chevron: [[[0, 64], [75, 15], [75, 36], [0, 85]], [[75, 15], [150, 64], [150, 85], [75, 36]]],
  quarterly: [rect(75, 0, 150, 50), rect(0, 50, 75, 100)],
  cross: [rect(64, 0, 86, 100), rect(0, 39, 150, 61)],
};

// Convex pieces in a unit circle, shared by the SVG and the two faces of the model.
function rosette(tips: number, inner: number): Polygon[] {
  const point = (i: number, radius: number): Point => {
    const a = i * Math.PI / tips - Math.PI / 2;
    return [radius * Math.cos(a), radius * Math.sin(a)];
  };
  return Array.from({ length: tips }, (_, i) => [
    [0, 0], point(2 * i - 1, inner), point(2 * i, 1), point(2 * i + 1, inner),
  ]);
}

const symbols: Record<FlagSymbol, Polygon[]> = {
  pine: [rect(-0.14, 0.44, 0.14, 1), ...[[-1, -0.21, 0.48], [-0.66, 0.21, 0.66], [-0.28, 0.68, 0.86]].map(
    ([top, bottom, width]): Polygon => [[0, top], [width, bottom], [-width, bottom]],
  )],
  wheat: [rect(-0.055, -0.56, 0.055, 1), [[0, -1], [0.2, -0.66], [0, -0.37], [-0.2, -0.66]],
    ...[-0.52, -0.12, 0.28].flatMap(y => [-1, 1].map((side): Polygon => [
      [0, y + 0.5], [side * 0.41, y + 0.31], [side * 0.57, y - 0.12], [side * 0.18, y + 0.03],
    ]))],
  sun: rosette(12, 0.64),
  star: rosette(5, 0.43),
  mountain: [[[-1, 0.72], [-0.35, -0.49], [0.35, 0.72]], [[-0.55, 0.72], [0.25, -0.84], [1, 0.72]]],
  tower: [rect(-0.62, -0.54, 0.62, -0.28), rect(-0.48, -0.28, -0.15, 0.92), rect(0.15, -0.28, 0.48, 0.92),
    rect(-0.48, -0.28, 0.48, 0.36), ...[-0.62, -0.11, 0.4].map(x => rect(x, -0.87, x + 0.22, -0.54))],
  fish: [[[-1, -0.5], [-0.42, 0], [-1, 0.5]], [[-0.52, 0], [-0.13, -0.39], [0.44, -0.39], [1, 0], [0.44, 0.39], [-0.13, 0.39]],
    [[-0.24, -0.31], [0, -0.64], [0.3, -0.31]]],
  diamond: [[[0, -1], [0.77, 0], [0, 1], [-0.77, 0]]],
};

export function flagShapes(flag: FlagDesign): Shape[] {
  const shapes = [{ color: flag.field, points: FIELD }, ...divisions[flag.pattern].map(points => ({ color: flag.division, points }))];
  for (const layer of flag.layers) {
    const radius = layer.size / 2;
    for (const part of symbols[layer.symbol]) {
      const points = clipBox(part.map(([x, y]) => [layer.x + radius * x, layer.y + radius * y]), [0, 0, 150, 100]);
      if (points.length) shapes.push({ color: layer.color, points });
    }
  }
  return shapes;
}
