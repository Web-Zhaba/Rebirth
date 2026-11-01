// Pure parts of the engine's place-name layer (placeLabels.ts): which tile zoom to read names from and a greedy,
// collision-free pick of labels in priority order.

export type PlaceClass = "city" | "town" | "village" | "hamlet";
export const PLACE_CLASSES: readonly PlaceClass[] = ["city", "town", "village", "hamlet"];

// Same sizes as the old MapLibre symbol layer (map/style.ts).
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

// Indices of the boxes that are shown: in priority order, each one that does not overlap an already shown one.
export function pickLabels(boxes: readonly LabelBox[]): number[] {
  const order = boxes.map((_, i) => i).sort((a, b) => boxes[a].priority - boxes[b].priority);
  const shown: number[] = [];
  for (const i of order) {
    const b = boxes[i];
    let free = true;
    for (const j of shown) {
      const o = boxes[j];
      if (Math.abs(b.x - o.x) * 2 < b.w + o.w + 2 * PAD && Math.abs(b.y - o.y) * 2 < b.h + o.h + 2 * PAD) {
        free = false;
        break;
      }
    }
    if (free) shown.push(i);
  }
  return shown;
}

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
