// Pure parts of the engine's place-name layer (placeLabels.ts): which tile zoom to read names from and a greedy,
// collision-free pick of labels in priority order.

export type PlaceClass = "city" | "town" | "village" | "hamlet";
export const PLACE_CLASSES: readonly PlaceClass[] = ["city", "town", "village", "hamlet"];

// Same sizes as the old MapLibre symbol layer.
export const LABEL_PX: Record<PlaceClass, number> = { city: 15, town: 13.5, village: 12, hamlet: 11 };

const EQUATOR = 2 * Math.PI * 6378137;
export const LABEL_MAX_TILE_ZOOM = 14; // OpenMapTiles has every place by z14

// Tile zoom whose places suit a view of `mpp` metres per CSS pixel: the zoom a 512 px web map would show at that scale,
// so cities appear from afar and hamlets only close up, as on the old map.
export function labelTileZoom(mpp: number, lat: number): number {
  const z = Math.floor(Math.log2((EQUATOR * Math.cos((lat * Math.PI) / 180)) / (512 * mpp)));
  return Math.max(0, Math.min(LABEL_MAX_TILE_ZOOM, z));
}

export interface LabelBox {
  x: number; // CSS px, centre
  y: number;
  w: number;
  h: number;
  priority: number; // lower first
}

const PAD = 4; // px kept free around a label (text-padding of the old layer)
const CELL = 64; // px a grid cell spans: about a label, so a box is filed under a handful of cells
const INV_CELL = 1 / CELL;
const MAX_CELLS = 1 << 14; // cells (64 KB of scratch): a wilder spread of boxes goes back to the pairwise loop
const GRID_FROM = 64; // boxes from which building the grid beats walking every shown pair
const DIRECT = 8; // shown boxes below which a candidate just tests them all: no cell to look up
// px of slack on a box's padded extent: the exact test below rounds a pair's own widths, and the grid looking one hair
// wider than that can only cost a cell, never hide a pair.
const SLACK = 1e-6;

// Indices of the boxes that are shown: in priority order, each one that does not overlap an already shown one.
//
// Overlap is a screen-space rectangle test, so the shown boxes are filed in a uniform grid over their padded extents and
// a candidate only tests the boxes of the cells it covers: the walk of a thousand candidates drops from every pair (0.85
// ms a frame) to a few hundred tests. The answers are the plain loop's, to the box.
export function pickLabels(boxes: readonly LabelBox[]): number[] {
  const order = boxes.map((_, i) => i).sort((a, b) => boxes[a].priority - boxes[b].priority);
  const shown: number[] = [];
  const n = boxes.length;
  if (n < GRID_FROM) return pickPairwise(boxes, order);
  // The grid only has to hold the padded boxes: their own bounds, in cells. The extents carry SLACK, so a cell range is
  // never negative for the widest box.
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const b of boxes) {
    const hw = (b.w + 2 * PAD) / 2 + SLACK;
    const hh = (b.h + 2 * PAD) / 2 + SLACK;
    if (b.x - hw < x0) x0 = b.x - hw;
    if (b.y - hh < y0) y0 = b.y - hh;
    if (b.x + hw > x1) x1 = b.x + hw;
    if (b.y + hh > y1) y1 = b.y + hh;
  }
  const cols = Math.floor((x1 - x0) * INV_CELL) + 1;
  const rows = Math.floor((y1 - y0) * INV_CELL) + 1;
  // A wild spread (or a NaN coordinate) leaves a grid too large to fill: the pairwise loop answers it as before.
  if (!(cols * rows <= MAX_CELLS)) return pickPairwise(boxes, order);

  const cells = cols * rows;
  if (headBuf.length < cells) headBuf = new Int32Array(cells);
  if (seenBuf.length < n) seenBuf = new Int32Array(n);
  const head = headBuf;
  head.fill(-1, 0, cells);
  const seen = seenBuf;
  // Per cell a list of the shown boxes filed there, as nodes of a pool: a box spanning three cells is three nodes.
  let nodes = 0;

  for (const i of order) {
    const b = boxes[i];
    let free = true;
    if (shown.length < DIRECT) {
      for (const j of shown)
        if (overlaps(b, boxes[j])) {
          free = false;
          break;
        }
    } else {
      const span = cellRange(b, x0, y0);
      const [c0, c1, r0, r1] = span;
      if (++runNo >= 0x7fffff00) (seen.fill(0), (runNo = 1));
      const run = runNo;
      for (let r = r0; r <= r1 && free; r++)
        for (let c = c0; c <= c1 && free; c++)
          for (let nd = head[r * cols + c]; nd >= 0; nd = nodeNext[nd]) {
            const j = nodeBox[nd];
            if (seen[j] === run) continue; // a box filed under several cells is tested once per candidate
            seen[j] = run;
            if (overlaps(b, boxes[j])) {
              free = false;
              break;
            }
          }
    }
    if (!free) continue;
    shown.push(i);
    // File it under every cell it covers (the direct path above never worked them out).
    const [ic0, ic1, ir0, ir1] = cellRange(b, x0, y0);
    const span = (ic1 - ic0 + 1) * (ir1 - ir0 + 1);
    if (nodes + span > nodeBox.length) {
      const capacity = Math.max(1024, (nodes + span) * 2);
      const box = new Int32Array(capacity);
      const next = new Int32Array(capacity);
      box.set(nodeBox.subarray(0, nodes));
      next.set(nodeNext.subarray(0, nodes));
      nodeBox = box;
      nodeNext = next;
    }
    for (let r = ir0; r <= ir1; r++)
      for (let c = ic0; c <= ic1; c++) {
        const cell = r * cols + c;
        nodeBox[nodes] = i;
        nodeNext[nodes] = head[cell];
        head[cell] = nodes++;
      }
  }
  return shown;
}

// The grid cells a box's padded extent covers, as c0, c1, r0, r1 of one shared array (a call allocates nothing).
const CELLS = new Int32Array(4);
function cellRange(b: LabelBox, x0: number, y0: number): Int32Array {
  const hw = (b.w + 2 * PAD) / 2 + SLACK;
  const hh = (b.h + 2 * PAD) / 2 + SLACK;
  CELLS[0] = Math.floor((b.x - hw - x0) * INV_CELL);
  CELLS[1] = Math.floor((b.x + hw - x0) * INV_CELL);
  CELLS[2] = Math.floor((b.y - hh - y0) * INV_CELL);
  CELLS[3] = Math.floor((b.y + hh - y0) * INV_CELL);
  return CELLS;
}

// The padded extents of two boxes meet.
function overlaps(b: LabelBox, o: LabelBox): boolean {
  return Math.abs(b.x - o.x) * 2 < b.w + o.w + 2 * PAD && Math.abs(b.y - o.y) * 2 < b.h + o.h + 2 * PAD;
}

// Every candidate against every shown box: what a grid too large to fill falls back to.
function pickPairwise(boxes: readonly LabelBox[], order: readonly number[]): number[] {
  const shown: number[] = [];
  for (const i of order) {
    const b = boxes[i];
    let free = true;
    for (const j of shown) {
      if (overlaps(b, boxes[j])) {
        free = false;
        break;
      }
    }
    if (free) shown.push(i);
  }
  return shown;
}

// Scratch kept between calls: both label layers pick every frame, and a frame should not allocate three arrays of a
// thousand entries. Nothing outside a call can see it.
let headBuf = new Int32Array(0);
let seenBuf = new Int32Array(0);
let nodeBox = new Int32Array(0);
let nodeNext = new Int32Array(0);
let runNo = 0;

// Priority of a place: the tiles' rank first (lower is more important), the class breaking ties.
export function labelPriority(cls: PlaceClass, rank: number): number {
  return rank * 10 + PLACE_CLASSES.indexOf(cls);
}

// ---------- labels along a line (names of old streets) ----------

export interface LineAnchor {
  x: number; // CSS px, centre of the text
  y: number;
  angle: number; // radians, clockwise on screen, always within -90..90 deg so the text reads left to right
}

const MAX_BEND = 0.6; // rad (~35 deg): a label is not laid over a sharper turn of its line, as MapLibre would not

// Where a text `textW` px long sits on a projected line: centred at half its screen length and turned along the chord
// that spans the text, or null when the line is shorter on screen than the text (plus a little room) or turns too
// sharply under it. One label per line, which suits the short streets of a dig.
export function lineLabelAnchor(pts: readonly (readonly [number, number])[], textW: number): LineAnchor | null {
  if (pts.length < 2) return null;
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const total = cum[cum.length - 1];
  if (!(total >= textW * 1.15 + 8)) return null;
  const at = (s: number): [number, number] => {
    let i = 1;
    while (i < cum.length - 1 && cum[i] < s) i++;
    const seg = cum[i] - cum[i - 1];
    const t = seg > 0 ? (s - cum[i - 1]) / seg : 0;
    return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t];
  };
  const mid = total / 2;
  const a = at(mid - textW / 2);
  const b = at(mid + textW / 2);
  // every vertex under the text keeps close to the chord's direction
  const chord = Math.atan2(b[1] - a[1], b[0] - a[0]);
  for (let i = 1; i < pts.length; i++) {
    if (cum[i] <= mid - textW / 2 || cum[i - 1] >= mid + textW / 2 || cum[i] === cum[i - 1]) continue;
    const dir = Math.atan2(pts[i][1] - pts[i - 1][1], pts[i][0] - pts[i - 1][0]);
    const bend = Math.abs(Math.atan2(Math.sin(dir - chord), Math.cos(dir - chord)));
    if (bend > MAX_BEND) return null;
  }
  const c = at(mid);
  let angle = chord;
  if (angle > Math.PI / 2) angle -= Math.PI;
  else if (angle < -Math.PI / 2) angle += Math.PI;
  return { x: c[0], y: c[1], angle };
}

// Width and height of the screen-aligned box around a w x h text turned by `angle` (for the collision pick).
export function rotatedExtent(w: number, h: number, angle: number): { w: number; h: number } {
  const c = Math.abs(Math.cos(angle));
  const s = Math.abs(Math.sin(angle));
  return { w: w * c + h * s, h: w * s + h * c };
}

// Lines a text of width `w` px breaks into within `maxW` px (MapLibre's text-max-width), and the width of the block.
export function wrapExtent(w: number, maxW: number): { lines: number; w: number } {
  if (!(w > maxW)) return { lines: 1, w };
  const lines = Math.ceil(w / maxW);
  return { lines, w: Math.min(maxW, w / lines + maxW * 0.15) };
}
