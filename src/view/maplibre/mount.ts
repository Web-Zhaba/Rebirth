import { computed, type ReadonlySignal } from "@preact/signals";
import { oldWorld } from "../../map/excavation";
import { attachBuildingLayer } from "../../map/buildingLayer";
import { attachCityMarker } from "../../map/cityLayer";
import { attachClouds } from "../../map/clouds/attach";
import { attachContextLayer } from "../../map/contextLayer";
import { attachFields3d } from "../../map/fields3d";
import { attachForest } from "../../map/forest";
import { attachLifeLayer, type LifeOptions } from "../../map/lifeLayer";
import { createMap } from "../../map/mapView";
import { attachModels } from "../../map/models";
import type { ModelLayerOptions } from "../../map/modelLayer";
import { attachNightTint } from "../../map/nightLayer";
import { attachPlaceLabels } from "../../map/placeLabels";
import { attachPrecipitation } from "../../map/precipLayer";
import { attachReachLayer } from "../../map/reachLayer";
import { attachRelief } from "../../map/relief";
import { attachRoadLayer } from "../../map/roadLayer";
import { attachRuinsLayer } from "../../map/ruinsLayer";
import { ruinsShown } from "../ruinsShown";
import { attachSmoke } from "../../map/smoke";
import { attachTrackpadGestures } from "../../map/trackpadGestures";
import { attachTrafficLayer } from "../../map/trafficLayer";
import { attachWater } from "../../map/water";
import { attachWeatherLayer } from "../../map/weatherLayer";
import { attachZoneLayer } from "../../map/zoneLayer";
import type { WeatherState } from "../../sim/weather";
import type { Frame } from "../../world/frame";
import { createMapLibreView, type MapLibreView } from "./view";

export interface MountOptions {
  container: string; // element id
  frame: ReadonlySignal<Frame | null>;
  gameClock: ReadonlySignal<number>; // game minutes
  mapClock: ReadonlySignal<number>; // the map's clock: the game's, or another season's while previewing
  sunLight: ModelLayerOptions["light"];
  weather: ReadonlySignal<WeatherState | null>;
  cloudSite: ReadonlySignal<{ seed: number; phase: number } | null>;
  life: Omit<LifeOptions, "frame" | "gameMinutes">;
  debug3dModels: boolean;
}

// Builds the map and every renderer layer on it; returns the View the game talks to.
export function mountMapLibreView(o: MountOptions): MapLibreView {
  const map = createMap(o.container);
  const { frame, gameClock } = o;
  attachTrackpadGestures(map);
  attachPlaceLabels(map);
  attachContextLayer(map);
  attachZoneLayer(map); // zones beneath everything else we add
  attachRuinsLayer(map, frame); // old foundations and streets, beneath the roads
  attachRoadLayer(map); // before the city marker so roads draw beneath it
  attachBuildingLayer(map);
  // Buildings and built roads as three.js models (loaded with the first one); localStorage debug3dModels = "1" shows every model kind instead.
  attachTrafficLayer(map);
  attachLifeLayer(map, { ...o.life, gameMinutes: gameClock, frame });
  attachNightTint(map, gameClock); // dusk tint of the map itself; sits just under the lights
  attachRelief(map, gameClock); // 3D terrain (a setting) and the sky over it
  attachReachLayer(map);
  attachCityMarker(map);
  attachModels(map, { light: o.sunLight, weather: o.weather, debug: o.debug3dModels });
  // 3D trees in the forest around the town, close up, with bushes, reeds, boulders and the overgrown old foundations
  attachForest(map, { light: o.sunLight, weather: o.weather, ruins: computed(() => (ruinsShown.value ? (oldWorld.value?.foundations ?? null) : null)) });
  attachWater(map, { light: o.sunLight, weather: o.weather }); // 3D water, close up
  attachFields3d(map, { light: o.sunLight, weather: o.weather }); // ploughland and crops on the farm fields, close up
  attachSmoke(map, { light: o.sunLight, weather: o.weather }); // smoke from the chimneys of lived-in houses and working shops, close up
  // Clouds above everything on the map, visible only on the far globe views; their ground shadows at every zoom, just
  // under the night tint (so the lights stay bright).
  attachClouds(map, {
    clock: gameClock,
    site: o.cloudSite,
    extraLayers: [{ beforeId: "night-tint", load: async () => (await import("../../map/clouds/cloudShadows")).createShadowLayer(map, { clock: gameClock, site: o.cloudSite }) }],
  });
  attachWeatherLayer(map, { weather: o.weather, clock: o.mapClock });
  attachPrecipitation(map, { weather: o.weather });
  return createMapLibreView(map);
}

// DEV handles and the benchmark hook (docs/PLAN-engine.md N0): window.map, window.runBench(), ?bench=all|<scene>[&variant=full|base].
export function installDevHandles(view: MapLibreView): void {
  const map = view.map;
  Object.assign(window, { map });
  const run = async (opts?: { scenes?: string[]; variants?: ("full" | "base")[] }) => (await import("../../bench/maplibreBench")).runMapLibreBench(map, opts);
  Object.assign(window, { runBench: run });
  const q = new URLSearchParams(location.search);
  const bench = q.get("bench");
  if (bench) {
    const v = q.get("variant");
    // 'load'/'idle' may never fire while animated layers keep repainting: start once the style is in (the runner then settles itself).
    const wait = setInterval(() => {
      if (!(map as any).style?._loaded) return; // isStyleLoaded() flickers false while geojson sources update
      clearInterval(wait);
      void run({ scenes: [bench], variants: v === "full" || v === "base" ? [v] : undefined });
    }, 250);
  }
}
