import type maplibregl from "maplibre-gl";
import { effect, type ReadonlySignal } from "@preact/signals";
import { FADE_TO } from "./constants";
import { cloudsOn, type CloudSite } from "./settings";

// Main-chunk loader of the cloud layers. It has NO static three.js import: the clouds chunk (three plus the shaders)
// is fetched with a dynamic import() the first time clouds are needed, so the main bundle does not grow.

export interface CloudAttachOptions {
  clock: ReadonlySignal<number>; // game minutes
  site: ReadonlySignal<CloudSite | null>;
  // EXTRA LAYERS HOOK (ground shadows are added here by the coordinator): each entry is loaded together with the clouds,
  // as soon as clouds are on and a site exists (at any zoom, since shadows work at town zoom too), and added to the map
  // before `beforeId` (null/undefined = on top). `load` should itself use a dynamic import, e.g.
  //   { beforeId: "night-tint", load: async () => (await import("./cloudShadows")).createShadowLayer(map, opts) }
  extraLayers?: ExtraCloudLayer[];
}

export interface ExtraCloudLayer {
  beforeId?: string;
  load: () => Promise<maplibregl.CustomLayerInterface>;
}

// Adds the cloud layer (and the extra layers) when first needed; returns a function that detaches everything.
export function attachClouds(map: maplibregl.Map, opts: CloudAttachOptions): () => void {
  const extras = opts.extraLayers ?? [];
  const added: string[] = [];
  let cloudsRequested = false;
  let extrasRequested = false;
  let disposed = false;
  // isStyleLoaded() is false whenever any tile is loading, so only the first answer and the `load` event count.
  let ready = map.isStyleLoaded();
  const onLoad = () => {
    ready = true;
    check();
  };

  const add = (layer: maplibregl.CustomLayerInterface, beforeId?: string) => {
    if (disposed || map.getLayer(layer.id)) return;
    map.addLayer(layer, beforeId && map.getLayer(beforeId) ? beforeId : undefined);
    added.push(layer.id);
  };

  const check = () => {
    if (disposed || !ready || !cloudsOn.peek() || !opts.site.peek()) return;
    // The cloud volume is drawn only on the far globe views, so it is fetched only once zoom is below FADE_TO.
    if (!cloudsRequested && map.getZoom() < FADE_TO) {
      cloudsRequested = true;
      import("./cloudLayer").then(
        (mod) => add(mod.createCloudLayer(map, { clock: opts.clock, site: opts.site })),
        (e: unknown) => {
          cloudsRequested = false;
          console.warn("clouds failed to load", e);
        },
      );
    }
    if (!extrasRequested && extras.length) {
      extrasRequested = true;
      for (const e of extras)
        e.load().then(
          (layer) => add(layer, e.beforeId),
          (err: unknown) => console.warn("cloud extra layer failed to load", err),
        );
    }
  };

  const stop = effect(() => {
    void cloudsOn.value;
    void opts.site.value;
    check();
  });
  map.on("zoom", check);
  if (!ready) map.once("load", onLoad);
  return () => {
    disposed = true;
    stop();
    map.off("zoom", check);
    map.off("load", onLoad);
    for (const id of added) if (map.getLayer(id)) map.removeLayer(id);
  };
}
