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
