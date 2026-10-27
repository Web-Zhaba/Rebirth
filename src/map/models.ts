import type maplibregl from "maplibre-gl";
import { computed, effect } from "@preact/signals";
import { frame } from "../simClient";
import { buildingItems } from "./buildingLayer";
import type { ModelItem, ModelLayerOptions } from "./modelLayer";
import { roadItems } from "./roadLayer";

// Main-chunk side of the three.js model layer (modelLayer.ts): what it draws is the buildings (buildingLayer.ts) and the
// built roads (roadLayer.ts). The layer, and three.js with it, loads with the first item.
const items = computed<ModelItem[]>(() => [...buildingItems.value, ...roadItems.value]);

export function attachModels(map: maplibregl.Map, opts: { light?: ModelLayerOptions["light"]; debug?: boolean } = {}): void {
  if (opts.debug) {
    // every model kind side by side instead of the town (modelLayer.ts attachModelDebug)
    void import("./modelLayer").then((m) => m.attachModelDebug(map, { frame, light: opts.light }));
    return;
  }
  let loading = false;
  const stopWatch = effect(() => {
    if (loading || !items.value.length) return;
    loading = true;
    void import("./modelLayer").then((m) => m.attachModelLayer(map, { items, frame, light: opts.light }));
    queueMicrotask(() => stopWatch());
  });
}
