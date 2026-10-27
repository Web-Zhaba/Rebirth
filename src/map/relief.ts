import type maplibregl from "maplibre-gl";
import { computed, effect, signal, type ReadonlySignal } from "@preact/signals";
import { calendar, daylight } from "../sim/clock";
import { mixHex, PALETTE } from "../ui/palette";
import { lngLatToTile } from "../world/mercator";
import { TERRAIN_ZOOM } from "../world/nature";
import { TERRARIUM_SIZE } from "../world/terrain";
import { getDemTile } from "../world/tiles";

// 3D relief of the map (PLAN-3d-world.ru.md stages 2-3): MapLibre's terrain from the style's "terrain" DEM source, a
// sky with haze toward the horizon, and the ground height for our own three.js layers, which MapLibre does not lift.
// No three.js here: the settings dialog and the model layer both import it.

// Height exaggeration of the relief: the plains read flat at 1, mountains turn into a caricature well above 2.
export const RELIEF_EXAGGERATION = 1.6;

const RELIEF_MAX_PITCH = 75;
const FLAT_MAX_PITCH = 60; // MapLibre's default

const KEY = "rebirth.relief";
function read(): boolean {
  try {
    return localStorage.getItem(KEY) !== "0";
  } catch {
    return true;
  }
}

export const reliefOn = signal(read());
// What heights on the map are multiplied by: 0 with the relief off (everything on the flat ground, as before).
export const reliefScale = computed(() => (reliefOn.value ? RELIEF_EXAGGERATION : 0));

export function setRelief(on: boolean): void {
  reliefOn.value = on;
  try {
    localStorage.setItem(KEY, on ? "1" : "0");
  } catch {
    /* no storage: the choice lives for the session */
  }
}

// ---- Ground height, sampled exactly as MapLibre draws the terrain ----
// MapLibre puts the value of DEM pixel i at its corner (i, not i + 0.5 as world/terrain.ts does for the game rules)
// and interpolates bilinearly across tile edges; matching that keeps the models on the drawn ground (checked against
// map.queryTerrainElevation: equal to the centimetre).

const N = 2 ** TERRAIN_ZOOM;
const grids = new Map<string, Float32Array>();
const pending = new Map<string, Promise<void>>();
const tileKey = (x: number, y: number) => `${((x % N) + N) % N}/${Math.max(0, Math.min(N - 1, y))}`;

// Global DEM pixel coordinates of a point.
function pixel(lng: number, lat: number): [number, number] {
  const t = lngLatToTile(lng, lat, TERRAIN_ZOOM);
  return [t.x * TERRARIUM_SIZE, t.y * TERRARIUM_SIZE];
}

// Tiles that hold the four DEM pixels around a point.
function tilesAround(lng: number, lat: number): string[] {
  const [px, py] = pixel(lng, lat);
  const x0 = Math.floor(px / TERRARIUM_SIZE), x1 = Math.floor((Math.floor(px) + 1) / TERRARIUM_SIZE);
  const y0 = Math.floor(py / TERRARIUM_SIZE), y1 = Math.floor((Math.floor(py) + 1) / TERRARIUM_SIZE);
  return [...new Set([tileKey(x0, y0), tileKey(x1, y0), tileKey(x0, y1), tileKey(x1, y1)])];
}

function value(gx: number, gy: number): number {
  const tx = Math.floor(gx / TERRARIUM_SIZE), ty = Math.floor(gy / TERRARIUM_SIZE);
  const g = grids.get(tileKey(tx, ty));
  if (!g) return 0;
  const i = gx - tx * TERRARIUM_SIZE, j = Math.max(0, Math.min(TERRARIUM_SIZE - 1, gy - ty * TERRARIUM_SIZE));
  return g[j * TERRARIUM_SIZE + i];
}

// Ground height in metres (not exaggerated) where the tiles are loaded; null where they are not yet (see loadGround).
export function groundAt(lng: number, lat: number): number | null {
  if (tilesAround(lng, lat).some((k) => !grids.has(k))) return null;
  const [px, py] = pixel(lng, lat);
  const x0 = Math.floor(px), y0 = Math.floor(py), fx = px - x0, fy = py - y0;
  const top = value(x0, y0) * (1 - fx) + value(x0 + 1, y0) * fx;
  const bottom = value(x0, y0 + 1) * (1 - fx) + value(x0 + 1, y0 + 1) * fx;
  return top * (1 - fy) + bottom * fy;
}

// Loads the DEM tiles under the points; resolves once all are in (failed tiles count as flat ground at 0).
export function loadGround(points: readonly [number, number][]): Promise<void> {
  const keys = new Set<string>();
  for (const [lng, lat] of points) for (const k of tilesAround(lng, lat)) if (!grids.has(k)) keys.add(k);
  return Promise.all(
    [...keys].map((k) => {
      let p = pending.get(k);
      if (!p) {
        const [x, y] = k.split("/").map(Number);
        p = getDemTile(x, y)
          .catch(() => new Float32Array(TERRARIUM_SIZE * TERRARIUM_SIZE))
          .then((g) => void grids.set(k, g))
          .finally(() => pending.delete(k));
        pending.set(k, p);
      }
      return p;
    }),
  ).then(() => undefined);
}

// ---- Terrain and sky on the map ----

const SKY = "#c9d6dc"; // pale overcast blue above the paper
const HORIZON = "#e6e4d6";
const NIGHT = 0.8; // how far the sky goes toward dusk at full night

// The sky above and at the horizon at an hour (the water reflects them too).
export function skyColours(hour: number): { sky: string; horizon: string } {
  const n = (1 - daylight(hour)) * NIGHT;
  return { sky: mixHex(SKY, PALETTE.dusk, n), horizon: mixHex(HORIZON, PALETTE.dusk, n) };
}

// Sky colours at an hour: the paper sky by day, toward dusk at night (the night tint does not reach the sky).
export function skyAt(hour: number): maplibregl.SkySpecification {
  const n = (1 - daylight(hour)) * NIGHT;
  const fog = mixHex(PALETTE.paper, PALETTE.dusk, n);
  const c = skyColours(hour);
  return {
    "sky-color": c.sky,
    "horizon-color": c.horizon,
    "fog-color": fog,
    "sky-horizon-blend": 0.6,
    "horizon-fog-blend": 0.6,
    "fog-ground-blend": 0.75, // haze only over the far ground
    "atmosphere-blend": ["interpolate", ["linear"], ["zoom"], 0, 1, 5, 1, 7, 0],
  };
}

// Turns the terrain on and off with the setting and keeps the sky in step with the hour.
// Layers MapLibre drapes over the relief (its render-to-texture types).
const DRAPED = new Set(["background", "fill", "line", "raster", "hillshade", "color-relief"]);

// Where a layer that is not draped sits in the flat order: just under a draped layer (null: above all of them), ordered
// by seq among the layers under the same one, as map.addLayer(layer, before) puts them.
export interface Anchor {
  before: string | null;
  seq: number;
}

// The layer order for the relief, or null when the map has it already. On the relief MapLibre renders the draped
// layers into a texture per terrain tile and keeps them while nothing changes, but every other layer (3D, circles,
// symbols) between them starts a new stack of textures, and with a few stacks its pool of 30 overflows and nothing is
// kept: every tile is drawn again every frame (about 4x the frame). So the draped layers go first, in their order, and
// the others above them in their flat order (anchors: noted the first time a layer is seen, so a layer added later
// before a draped one still lands where it would on the flat map).
export function reliefOrder(order: readonly { id: string; type: string }[], anchors: Map<string, Anchor>): string[] | null {
  noteAnchors(order, anchors);
  const draped = order.filter((l) => DRAPED.has(l.type)).map((l) => l.id);
  const rank = (id: string) => {
    const a = anchors.get(id)!, k = a.before === null ? -1 : draped.indexOf(a.before);
    return k < 0 ? draped.length : k;
  };
  const others = order.filter((l) => !DRAPED.has(l.type)).map((l) => l.id);
  others.sort((a, b) => rank(a) - rank(b) || anchors.get(a)!.seq - anchors.get(b)!.seq);
  const want = [...draped, ...others];
  return want.every((id, i) => order[i].id === id) ? null : want;
}

function noteAnchors(order: readonly { id: string; type: string }[], anchors: Map<string, Anchor>): void {
  order.forEach((l, i) => {
    if (DRAPED.has(l.type) || anchors.has(l.id)) return;
    // the first layer above that is draped, or placed already: just under it (later arrivals nearer it)
    const next = order.slice(i + 1).find((n) => DRAPED.has(n.type) || anchors.has(n.id));
    const known = next && anchors.get(next.id);
    anchors.set(l.id, known ? { before: known.before, seq: known.seq - 1 / (anchors.size + 2) } : { before: next?.id ?? null, seq: anchors.size });
  });
}

// The flat places of the layers that are not draped, while the relief is on (one map).
const anchors = new Map<string, Anchor>();
// getLayersOrder, not getStyle: the style as JSON leaves out the custom (3D) layers
const layersOf = (map: maplibregl.Map) => map.getLayersOrder().map((id) => ({ id, type: map.getLayer(id)!.type }));

// Keeps a draped layer just under another layer as the flat map has it (the night tint under the lights). On the relief
// the draped layers lie under all the others, so it goes under the draped layer that follows the other one there.
export function keepUnder(map: maplibregl.Map, id: string, before: string): void {
  const order = layersOf(map);
  let target: string | undefined = map.getLayer(before) ? before : undefined;
  if (reliefScale.peek() > 0 && target) {
    noteAnchors(order, anchors);
    target = anchors.get(before)?.before ?? order.find((l) => !DRAPED.has(l.type))?.id;
  }
  const at = order.findIndex((l) => l.id === id);
  const next = order.slice(at + 1).find((l) => l.id !== id)?.id;
  if (next !== target && target !== id) map.moveLayer(id, target);
}

export function attachRelief(map: maplibregl.Map, gameMinutes: ReadonlySignal<number>): () => void {
  let stops: (() => void)[] = [];
  let busy = false;
  const moving = (fn: () => void) => {
    busy = true;
    try {
      fn();
    } catch (e) {
      console.error("relief: layer order", e);
    } finally {
      busy = false;
    }
  };
  const group = () => {
    if (busy || reliefScale.peek() <= 0) return;
    const want = reliefOrder(layersOf(map), anchors);
    if (want) moving(() => want.filter((id) => !DRAPED.has(map.getLayer(id)!.type)).forEach((id) => map.moveLayer(id)));
  };
  const ungroup = () => {
    const back = [...anchors].filter(([id]) => map.getLayer(id)).sort((a, b) => a[1].seq - b[1].seq);
    anchors.clear();
    moving(() => back.forEach(([id, a]) => map.moveLayer(id, a.before && map.getLayer(a.before) ? a.before : undefined)));
  };
  const setup = () => {
    map.on("styledata", group);
    stops = [
      effect(() => {
        const k = reliefScale.value;
        map.setTerrain(k > 0 ? { source: "terrain", exaggeration: k } : null);
        // the horizon, the sky and the haze show only on steep views; flat, they would show the end of the map
        map.setMaxPitch(k > 0 ? RELIEF_MAX_PITCH : FLAT_MAX_PITCH);
        if (k > 0) group();
        else ungroup();
      }),
      effect(() => {
        const cal = calendar(gameMinutes.value);
        map.setSky(skyAt(cal.hour + cal.minute / 60));
      }),
      () => map.off("styledata", group),
    ];
  };
  if (map.isStyleLoaded()) setup();
  else map.once("load", setup);
  return () => stops.forEach((s) => s());
}
