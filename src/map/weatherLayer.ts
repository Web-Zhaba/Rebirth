import type * as maplibregl from "maplibre-gl";
import type { FilterSpecification } from "maplibre-gl";
import { effect, type ReadonlySignal } from "@preact/signals";
import { sunDirection, type WeatherState } from "../sim/weather";
import { WATER_EXCLUDED_CLASSES } from "../world/nature";
import { PALETTE } from "../ui/palette";
import { iceOpacity, overcastOpacity, snowOpacity, sunAzimuth, weatherCoverVisibility } from "./weatherMath";
import { weatherMapOn } from "./weatherSettings";
import { reliefScale } from "./relief";

const BEFORE = "night-tint";
const SRC = "weather-world";
const SNOW = "weather-snow";
const WATER = "weather-water";
const ICE = "weather-ice";
const HAZE = "weather-haze";
const ORDER = [SNOW, WATER, ICE, HAZE];
const GROUND = [SNOW, WATER, ICE];
// The 3D layers and what sits over them: on the flat map the snow, the water and the ice go under these, or they
// would paint over the trees and the buildings that stand in front of the water (on the relief MapLibre lays all the
// fills on the ground anyway). The haze stays over everything.
const ABOVE_GROUND = ["fields-3d", "building-models", "forest-trees", "buildings-outline"];
const HILLSHADE = "hillshade";

const WATER_FILTER: FilterSpecification = [
  "all",
  ["!", ["in", ["get", "class"], ["literal", WATER_EXCLUDED_CLASSES]]],
  ["!=", ["get", "brunnel"], "tunnel"],
];

const round2 = (x: number) => Math.round(x * 100) / 100;

// Weather cover on the map: snow, water repainted above it and ice, under the 3D models and trees, and an overcast
// haze directly under the night tint, so roads, buildings and lights keep their contrast. The hillshade follows the real sun.
export function attachWeatherLayer(map: maplibregl.Map, opts: { weather: ReadonlySignal<WeatherState | null>; clock: ReadonlySignal<number> }): () => void {
  let ready = false;
  let detached = false;
  let stop: (() => void) | null = null;
  let stopSun: (() => void) | null = null;
  let stopZoom: (() => void) | null = null;
  const last = { snow: -1, water: -1, ice: -1, haze: -1 };

  // Keeps `ids` together just under `before` (on top without it).
  const keep = (ids: string[], before: string | undefined) => {
    const order = map.getLayersOrder();
    const b = before ? order.indexOf(before) : order.length;
    if (b - ids.length >= 0 && ids.every((id, i) => order[b - ids.length + i] === id)) return;
    for (const id of ids) if (map.getLayer(id)) map.moveLayer(id, before);
  };
  const place = () => {
    // on the relief relief.ts orders the layers, and every fill lies on the ground under the 3D ones anyway
    if (!ready || reliefScale.peek() > 0) return;
    try {
      const order = map.getLayersOrder();
      keep([HAZE], map.getLayer(BEFORE) ? BEFORE : undefined);
      const first = ABOVE_GROUND.map((id) => order.indexOf(id)).filter((i) => i >= 0);
      keep(GROUND, first.length ? order[Math.min(...first)] : HAZE);
    } catch {
      // The map can be removed while a style event is still queued.
    }
  };

  const applySun = () => {
    try {
      const ws = opts.weather.peek();
      if (!ws?.site || !map.getLayer(HILLSHADE)) return;
      const c = map.getCenter();
      map.setPaintProperty(HILLSHADE, "hillshade-illumination-direction", sunAzimuth(sunDirection(opts.clock.peek(), ws.site.phase), c.lng, c.lat));
    } catch {
      // Same: a queued effect or event may outlive the map.
    }
  };

  const setup = () => {
    if (detached) return;
    map.addSource(SRC, {
      type: "geojson",
      data: {
        type: "Feature",
        properties: {},
        geometry: { type: "Polygon", coordinates: [[[-180, -85], [180, -85], [180, 85], [-180, 85], [-180, -85]]] },
      },
    });
    const under = map.getLayer(BEFORE) ? BEFORE : undefined;
    map.addLayer(
      { id: SNOW, type: "fill", source: SRC, paint: { "fill-color": PALETTE.paperRaised, "fill-opacity": 0, "fill-antialias": false } },
      under,
    );
    map.addLayer(
      { id: WATER, type: "fill", source: "nature", "source-layer": "water", filter: WATER_FILTER, paint: { "fill-color": PALETTE.mapWater, "fill-opacity": 0 } },
      under,
    );
    map.addLayer(
      { id: ICE, type: "fill", source: "nature", "source-layer": "water", filter: WATER_FILTER, paint: { "fill-color": PALETTE.mapIce, "fill-opacity": 0 } },
      under,
    );
    map.addLayer(
      { id: HAZE, type: "fill", source: SRC, paint: { "fill-color": PALETTE.info, "fill-opacity": 0, "fill-antialias": false } },
      under,
    );
    ready = true;
    place();
    applySun();
    const applyCover = () => {
      const ws = opts.weather.value;
      const shown = weatherMapOn.value;
      const near = weatherCoverVisibility(map.getZoom());
      const snow = round2(shown && ws ? snowOpacity(ws.snowpack) * near : 0);
      const ice = round2(shown && ws ? iceOpacity(ws.ice) * near : 0);
      const haze = round2(shown && ws ? overcastOpacity(ws.now.cloud, ws.now.precip) * near : 0);
      // Water is repainted opaquely over the snow veil so lakes stay water. The switch sits exactly where the veil
      // becomes non-zero, so neither side of it shows a step.
      const water = shown && near > 0 && ws && ws.snowpack >= 0.01 ? 1 : 0;
      if (snow !== last.snow) {
        map.setPaintProperty(SNOW, "fill-opacity", snow);
        last.snow = snow;
      }
      if (water !== last.water) {
        map.setPaintProperty(WATER, "fill-opacity", water);
        last.water = water;
      }
      if (ice !== last.ice) {
        map.setPaintProperty(ICE, "fill-opacity", ice);
        last.ice = ice;
      }
      if (haze !== last.haze) {
        map.setPaintProperty(HAZE, "fill-opacity", haze);
        last.haze = haze;
      }
    };
    stop = effect(applyCover);
    map.on("zoom", applyCover);
    stopZoom = () => map.off("zoom", applyCover);
    stopSun = effect(() => {
      opts.clock.value;
      applySun();
    });
  };

  map.on("styledata", place);
  map.on("moveend", applySun);
  if (map.isStyleLoaded()) setup();
  else map.once("load", setup);

  return () => {
    detached = true;
    map.off("load", setup);
    map.off("styledata", place);
    map.off("moveend", applySun);
    stop?.();
    stopSun?.();
    stopZoom?.();
    try {
      for (const id of ORDER) if (map.getLayer(id)) map.removeLayer(id);
      if (map.getSource(SRC)) map.removeSource(SRC);
    } catch {
      // Removing the map first is allowed.
    }
  };
}
