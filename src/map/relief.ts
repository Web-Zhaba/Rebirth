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

// Sky colours at an hour: the paper sky by day, toward dusk at night (the night tint does not reach the sky).
export function skyAt(hour: number): maplibregl.SkySpecification {
  const n = (1 - daylight(hour)) * NIGHT;
  const fog = mixHex(PALETTE.paper, PALETTE.dusk, n);
  return {
    "sky-color": mixHex(SKY, PALETTE.dusk, n),
    "horizon-color": mixHex(HORIZON, PALETTE.dusk, n),
    "fog-color": fog,
    "sky-horizon-blend": 0.6,
    "horizon-fog-blend": 0.6,
    "fog-ground-blend": 0.75, // haze only over the far ground
    "atmosphere-blend": ["interpolate", ["linear"], ["zoom"], 0, 1, 5, 1, 7, 0],
  };
}

// Turns the terrain on and off with the setting and keeps the sky in step with the hour.
export function attachRelief(map: maplibregl.Map, gameMinutes: ReadonlySignal<number>): () => void {
  let stops: (() => void)[] = [];
  const setup = () => {
    stops = [
      effect(() => {
        const k = reliefScale.value;
        map.setTerrain(k > 0 ? { source: "terrain", exaggeration: k } : null);
        // the horizon, the sky and the haze show only on steep views; flat, they would show the end of the map
        map.setMaxPitch(k > 0 ? RELIEF_MAX_PITCH : FLAT_MAX_PITCH);
      }),
      effect(() => {
        const cal = calendar(gameMinutes.value);
        map.setSky(skyAt(cal.hour + cal.minute / 60));
      }),
    ];
  };
  if (map.isStyleLoaded()) setup();
  else map.once("load", setup);
  return () => stops.forEach((s) => s());
}
