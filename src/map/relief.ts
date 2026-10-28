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
const FLAT_MAX_PITCH = 60;
const TERRAIN_3D_SOURCE = "terrain-dem"; // отдельный источник для 3D mesh во избежание конфликта с hillshade

const KEY = "rebirth.relief";
function read(): boolean {
  try {
    return localStorage.getItem(KEY) !== "0";
  } catch {
    return true;
  }
}

export const reliefOn = signal(read());
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

const N = 2 ** TERRAIN_ZOOM;
const grids = new Map<string, Float32Array>();
const pending = new Map<string, Promise<void>>();
const tileKey = (x: number, y: number) => `${((x % N) + N) % N}/${Math.max(0, Math.min(N - 1, y))}`;

// Кэш последнего прочитанного DEM-тайла для быстрого доступа без поиска в Map
let lastTx = -1, lastTy = -1, lastGrid: Float32Array | null = null;

function getGrid(tx: number, ty: number): Float32Array | null {
  if (tx === lastTx && ty === lastTy) return lastGrid;
  const normX = ((tx % N) + N) % N;
  const normY = Math.max(0, Math.min(N - 1, ty));
  const key = `${normX}/${normY}`;
  const g = grids.get(key) ?? null;
  lastTx = tx;
  lastTy = ty;
  lastGrid = g;
  return g;
}

function pixel(lng: number, lat: number): [number, number] {
  const t = lngLatToTile(lng, lat, TERRAIN_ZOOM);
  return [t.x * TERRARIUM_SIZE, t.y * TERRARIUM_SIZE];
}

// Tiles that hold the four DEM pixels around a point (без аллокаций new Set)
export function tilesAround(lng: number, lat: number): string[] {
  const [px, py] = pixel(lng, lat);
  const x0 = Math.floor(px / TERRARIUM_SIZE), x1 = Math.floor((Math.floor(px) + 1) / TERRARIUM_SIZE);
  const y0 = Math.floor(py / TERRARIUM_SIZE), y1 = Math.floor((Math.floor(py) + 1) / TERRARIUM_SIZE);
  const k0 = tileKey(x0, y0);
  if (x0 === x1 && y0 === y1) return [k0];
  const res = [k0];
  const k1 = tileKey(x1, y0);
  if (k1 !== k0) res.push(k1);
  const k2 = tileKey(x0, y1);
  if (k2 !== k0 && k2 !== k1) res.push(k2);
  const k3 = tileKey(x1, y1);
  if (k3 !== k0 && k3 !== k1 && k3 !== k2) res.push(k3);
  return res;
}

// Оптимизированный groundAt: быстрый путь без аллокаций для 99.6% точек
export function groundAt(lng: number, lat: number): number | null {
  const t = lngLatToTile(lng, lat, TERRAIN_ZOOM);
  const px = t.x * TERRARIUM_SIZE;
  const py = t.y * TERRARIUM_SIZE;
  const x0 = Math.floor(px);
  const y0 = Math.floor(py);
  const fx = px - x0;
  const fy = py - y0;

  const tx0 = Math.floor(x0 / TERRARIUM_SIZE);
  const ty0 = Math.floor(y0 / TERRARIUM_SIZE);
  const tx1 = Math.floor((x0 + 1) / TERRARIUM_SIZE);
  const ty1 = Math.floor((y0 + 1) / TERRARIUM_SIZE);

  // 99.6% точек: все 4 угла лежат на одном и том же DEM-тайле
  if (tx0 === tx1 && ty0 === ty1) {
    const g = getGrid(tx0, ty0);
    if (!g) return null;
    const i0 = x0 - tx0 * TERRARIUM_SIZE;
    const j0 = y0 - ty0 * TERRARIUM_SIZE;
    const cj0 = Math.max(0, Math.min(TERRARIUM_SIZE - 1, j0));
    const cj1 = Math.max(0, Math.min(TERRARIUM_SIZE - 1, j0 + 1));
    const v00 = g[cj0 * TERRARIUM_SIZE + i0];
    const v10 = g[cj0 * TERRARIUM_SIZE + (i0 + 1)];
    const v01 = g[cj1 * TERRARIUM_SIZE + i0];
    const v11 = g[cj1 * TERRARIUM_SIZE + (i0 + 1)];
    const top = v00 * (1 - fx) + v10 * fx;
    const bottom = v01 * (1 - fx) + v11 * fx;
    return top * (1 - fy) + bottom * fy;
  }

  // Граничный случай: точки пересекают границу тайлов
  const g00 = getGrid(tx0, ty0);
  const g10 = getGrid(tx1, ty0);
  const g01 = getGrid(tx0, ty1);
  const g11 = getGrid(tx1, ty1);
  if (!g00 || !g10 || !g01 || !g11) return null;

  const v00 = g00[Math.max(0, Math.min(TERRARIUM_SIZE - 1, y0 - ty0 * TERRARIUM_SIZE)) * TERRARIUM_SIZE + (x0 - tx0 * TERRARIUM_SIZE)];
  const v10 = g10[Math.max(0, Math.min(TERRARIUM_SIZE - 1, y0 - ty0 * TERRARIUM_SIZE)) * TERRARIUM_SIZE + (x0 + 1 - tx1 * TERRARIUM_SIZE)];
  const v01 = g01[Math.max(0, Math.min(TERRARIUM_SIZE - 1, y0 + 1 - ty1 * TERRARIUM_SIZE)) * TERRARIUM_SIZE + (x0 - tx0 * TERRARIUM_SIZE)];
  const v11 = g11[Math.max(0, Math.min(TERRARIUM_SIZE - 1, y0 + 1 - ty1 * TERRARIUM_SIZE)) * TERRARIUM_SIZE + (x0 + 1 - tx1 * TERRARIUM_SIZE)];

  const top = v00 * (1 - fx) + v10 * fx;
  const bottom = v01 * (1 - fx) + v11 * fx;
  return top * (1 - fy) + bottom * fy;
}

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

const SKY = "#c9d6dc";
const HORIZON = "#e6e4d6";
const NIGHT = 0.8;

export function skyColours(hour: number): { sky: string; horizon: string } {
  const n = (1 - daylight(hour)) * NIGHT;
  return { sky: mixHex(SKY, PALETTE.dusk, n), horizon: mixHex(HORIZON, PALETTE.dusk, n) };
}

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
    "fog-ground-blend": 0.75,
    "atmosphere-blend": ["interpolate", ["linear"], ["zoom"], 0, 1, 5, 1, 7, 0],
  };
}

const DRAPED = new Set(["background", "fill", "line", "raster", "hillshade", "color-relief"]);

export interface Anchor {
  before: string | null;
  seq: number;
}

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
    const next = order.slice(i + 1).find((n) => DRAPED.has(n.type) || anchors.has(n.id));
    const known = next && anchors.get(next.id);
    anchors.set(l.id, known ? { before: known.before, seq: known.seq - 1 / (anchors.size + 2) } : { before: next?.id ?? null, seq: anchors.size });
  });
}

const anchors = new Map<string, Anchor>();
const layersOf = (map: maplibregl.Map) => map.getLayersOrder().map((id) => ({ id, type: map.getLayer(id)!.type }));

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

// Создаёт отдельный source для 3D terrain, устраняя конфликт с hillshade
function ensureTerrainSource(map: maplibregl.Map): string {
  if (map.getSource(TERRAIN_3D_SOURCE)) return TERRAIN_3D_SOURCE;
  const style = map.getStyle();
  const orig = style?.sources?.["terrain"];
  if (orig) {
    try {
      map.addSource(TERRAIN_3D_SOURCE, { ...orig } as maplibregl.SourceSpecification);
      return TERRAIN_3D_SOURCE;
    } catch {
      /* ignore */
    }
  }
  return "terrain";
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
  const onStyleData = () => {
    if (reliefScale.peek() > 0) {
      ensureTerrainSource(map);
    }
    group();
  };
  const setup = () => {
    map.on("styledata", onStyleData);
    stops = [
      effect(() => {
        const k = reliefScale.value;
        if (k > 0) {
          const src = ensureTerrainSource(map);
          map.setTerrain({ source: src, exaggeration: k });
          map.setMaxPitch(RELIEF_MAX_PITCH);
          group();
        } else {
          map.setTerrain(null);
          map.setMaxPitch(FLAT_MAX_PITCH);
          ungroup();
        }
      }),
      effect(() => {
        const cal = calendar(gameMinutes.value);
        map.setSky(skyAt(cal.hour + cal.minute / 60));
      }),
      () => map.off("styledata", onStyleData),
    ];
  };
  if (map.isStyleLoaded()) setup();
  else map.once("load", setup);
  return () => {
    stops.forEach((s) => s());
    if (map.getSource(TERRAIN_3D_SOURCE)) {
      try {
        map.setTerrain(null);
        map.removeSource(TERRAIN_3D_SOURCE);
      } catch {
        /* ignore */
      }
    }
  };
}