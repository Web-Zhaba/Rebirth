import { orientedBox } from "../sim/heritageGeo";

// The drawings of the museum window (MuseumPanel.tsx), pure geometry in metres:
// - the plan: the museum's own footprint (the old ring) turned so its long side lies across, cut into its halls;
// - the theme map: where a theme's finds lie, with the roads and dug foundations around them.

type Pt = [number, number];

export interface PlanRoom {
  index: number;
  x: number; // top-left corner and size in plan units (metres, y down)
  y: number;
  w: number;
  h: number;
}

export interface MuseumPlan {
  width: number; // the drawing's box: the footprint, padded to a readable shape
  height: number;
  outline: Pt[]; // the footprint in plan units
  rooms: PlanRoom[];
}

const ASPECT = { min: 1.25, max: 3.2 }; // the drawing's width against its height
const FLAT = 3; // a footprint longer than this against its depth gets its halls in one row

// The museum's footprint drawn long side across and cut into `halls` rooms: one row for up to three halls or a long,
// narrow building, else two rows, the first holding the odd one.
export function museumPlan(footprint: readonly Pt[], halls: number): MuseumPlan {
  const box = orientedBox(footprint);
  let ux = Math.cos(box.angle);
  let uy = Math.sin(box.angle);
  const span = (ax: number, ay: number) => {
    let lo = Infinity;
    let hi = -Infinity;
    for (const [x, y] of footprint) {
      const t = x * ax + y * ay;
      lo = Math.min(lo, t);
      hi = Math.max(hi, t);
    }
    return hi - lo;
  };
  if (span(ux, uy) < span(-uy, ux)) [ux, uy] = [-uy, ux]; // the long side across
  // u along the long side, v across it; the drawing's y runs down, so v is flipped
  const local = footprint.map(([x, y]): Pt => [x * ux + y * uy, -(-x * uy + y * ux)]);
  const minX = Math.min(...local.map((p) => p[0]));
  const minY = Math.min(...local.map((p) => p[1]));
  const w0 = Math.max(1, Math.max(...local.map((p) => p[0])) - minX);
  const h0 = Math.max(1, Math.max(...local.map((p) => p[1])) - minY);
  const width = Math.max(w0, h0 * ASPECT.min);
  const height = Math.max(h0, width / ASPECT.max);
  const ox = (width - w0) / 2 - minX;
  const oy = (height - h0) / 2 - minY;
  const outline = local.map(([x, y]): Pt => [x + ox, y + oy]);
  const n = Math.max(1, halls);
  const rows = n <= 3 || w0 / h0 > FLAT ? 1 : 2;
  const perRow = rows === 1 ? [n] : [Math.ceil(n / 2), Math.floor(n / 2)];
  const rooms: PlanRoom[] = [];
  const left = (width - w0) / 2;
  const top = (height - h0) / 2;
  let index = 0;
  perRow.forEach((cols, r) => {
    for (let c = 0; c < cols; c++) rooms.push({ index: index++, x: left + (c * w0) / cols, y: top + (r * h0) / rows, w: w0 / cols, h: h0 / rows });
  });
  return { width, height, outline, rooms };
}

export interface MapFrame {
  x: number; // the box in metres, y up as in the town's frame
  y: number;
  size: number;
}

// A square around the points with a margin, never smaller than `min` metres across.
export function mapFrame(points: readonly Pt[], min = 240, margin = 0.15): MapFrame {
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  const y0 = Math.min(...ys);
  const y1 = Math.max(...ys);
  const size = Math.max(min, Math.max(x1 - x0, y1 - y0) * (1 + 2 * margin));
  return { x: (x0 + x1) / 2 - size / 2, y: (y0 + y1) / 2 - size / 2, size };
}

// A town point inside the frame as drawing units 0..1000, y down.
export const toMap = (f: MapFrame, [x, y]: Pt): Pt => [((x - f.x) / f.size) * 1000, (1 - (y - f.y) / f.size) * 1000];

export const inFrame = (f: MapFrame, [x, y]: Pt): boolean => x >= f.x && x <= f.x + f.size && y >= f.y && y <= f.y + f.size;
