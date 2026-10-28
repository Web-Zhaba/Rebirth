import type * as maplibregl from "maplibre-gl";
import { effect, type ReadonlySignal } from "@preact/signals";
import type { WeatherState } from "../sim/weather";
import { frame } from "../simClient";
import type { ModelLayerOptions } from "./modelLayer";

// Main-chunk side of the chimney smoke (smokeLayer.ts, PLAN-3d-world.ru.md stage 7): loads the layer, and three.js with
// it, with the first close view of a founded town.

const SMOKE_FROM_ZOOM = 15.5; // smokeLayer.ts SMOKE_FROM_ZOOM (not imported: that would pull three.js into this chunk)

export function attachSmoke(map: maplibregl.Map, opts: { light?: ModelLayerOptions["light"]; weather: ReadonlySignal<WeatherState | null> }): void {
  let started = false;
  const check = () => {
    if (started || !frame.peek() || map.getZoom() < SMOKE_FROM_ZOOM) return;
    started = true;
    void import("./smokeLayer").then((m) => m.attachSmokeLayer(map, { frame, light: opts.light, weather: opts.weather }));
  };
  map.on("zoomend", check);
  effect(() => {
    void frame.value;
    check();
  });
}
