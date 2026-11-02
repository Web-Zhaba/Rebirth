import { locate } from "./mercator";
import { TERRAIN_ZOOM } from "./nature";
import { neighboursNeeded, sampleBlock, TERRARIUM_SIZE, type DemBlock } from "./terrain";
import { getDemTile } from "./tiles";

// Synchronous ground height for what is drawn on the ground in bulk (water, fields): the z11 DEM the rules and the
// engine's near terrain read, sampled the same way (terrain.ts sampleBlock), from tiles kept here once loaded.
// groundAt answers null while a tile it needs is missing; loadGround fetches them.

const N = 2 ** TERRAIN_ZOOM;
const grids = new Map<string, Float32Array | null>(); // null: failed or past the poles, the edge clamp stands in
const pending = new Map<string, Promise<void>>();
const key = (x: number, y: number) => `${((x % N) + N) % N}/${y}`;

function needs(lng: number, lat: number): { t: ReturnType<typeof locate>; px: number; py: number; keys: [string, number][] } {
  const t = locate(lng, lat, TERRAIN_ZOOM);
  const px = t.u * TERRARIUM_SIZE;
  const py = t.v * TERRARIUM_SIZE;
  const need = neighboursNeeded(px, py);
  const keys: [string, number][] = [];
  for (const dy of need.dy)
    for (const dx of need.dx) {
      const y = t.y + dy;
      if (y >= 0 && y < N) keys.push([key(t.x + dx, y), (dy + 1) * 3 + dx + 1]);
    }
  return { t, px, py, keys };
}

// Raw DEM metres (not exaggerated) at a point, or null while its tiles load.
export function groundAt(lng: number, lat: number): number | null {
  const { px, py, keys } = needs(lng, lat);
  const block: DemBlock = new Array(9).fill(null);
  for (const [k, slot] of keys) {
    const g = grids.get(k);
    if (g === undefined) return null;
    block[slot] = g;
  }
  if (!block[4]) return 0;
  return sampleBlock(block, px, py);
}

// Fetches the tiles the points need.
export function loadGround(points: readonly (readonly [number, number])[]): Promise<void> {
  const want = new Set<string>();
  for (const [lng, lat] of points) for (const [k] of needs(lng, lat).keys) if (!grids.has(k)) want.add(k);
  return Promise.all(
    [...want].map((k) => {
      let p = pending.get(k);
      if (!p) {
        const [x, y] = k.split("/").map(Number);
        p = getDemTile(x, y)
          .then(
            (g) => void grids.set(k, g),
            () => void grids.set(k, null),
          )
          .finally(() => pending.delete(k));
        pending.set(k, p);
      }
      return p;
    }),
  ).then(() => undefined);
}
