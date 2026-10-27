import type maplibregl from "maplibre-gl";
import { effect, type ReadonlySignal } from "@preact/signals";
import type { WeatherState } from "../sim/weather";
import { frame } from "../simClient";
import type { ModelLayerOptions } from "./modelLayer";

// Main-chunk side of the 3D water (waterLayer.ts, PLAN-3d-world.ru.md stage 5): loads the layer, and three.js with
// it, with the first close view of a founded town.

const WATER_FROM_ZOOM = 13; // waterLayer.ts WATER_FROM_ZOOM (not imported: that would pull three.js into this chunk)

export function attachWater(map: maplibregl.Map, opts: { light?: ModelLayerOptions["light"]; weather: ReadonlySignal<WeatherState | null> }): void {
  let started = false;
  const check = () => {
    if (started || !frame.peek() || map.getZoom() < WATER_FROM_ZOOM) return;
    started = true;
    void import("./waterLayer").then((m) => m.attachWaterLayer(map, { frame, light: opts.light, weather: opts.weather }));
  };
  map.on("zoomend", check);
  effect(() => {
    void frame.value;
    check();
  });
}
