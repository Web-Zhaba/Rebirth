import type * as maplibregl from "maplibre-gl";
import { effect, type ReadonlySignal } from "@preact/signals";
import type { WeatherState } from "../sim/weather";
import { frame } from "../simClient";
import type { ModelLayerOptions } from "./modelLayer";

// Main-chunk side of the 3D farm fields (fieldLayer.ts, PLAN-3d-world.ru.md stage 6): loads the layer, and three.js with
// it, with the first close view of a founded town.

const FIELDS_FROM_ZOOM = 14.5; // fieldLayer.ts FIELD_FROM_ZOOM (not imported: that would pull three.js into this chunk)

export function attachFields3d(map: maplibregl.Map, opts: { light?: ModelLayerOptions["light"]; weather: ReadonlySignal<WeatherState | null> }): void {
  let started = false;
  const check = () => {
    if (started || !frame.peek() || map.getZoom() < FIELDS_FROM_ZOOM) return;
    started = true;
    void import("./fieldLayer").then((m) => m.attachFieldLayer(map, { frame, light: opts.light, weather: opts.weather }));
  };
  map.on("zoomend", check);
  effect(() => {
    void frame.value;
    check();
  });
}
