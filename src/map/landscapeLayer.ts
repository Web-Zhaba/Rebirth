import type * as maplibregl from "maplibre-gl";
import type { ReadonlySignal } from "@preact/signals";
import type { Frame as TownFrame } from "../world/frame";
import type { ModelLayerOptions } from "./modelLayer";

export const LANDSCAPE_LAYER_ID = "landscape-terrain";
export const LANDSCAPE_FROM_ZOOM = 10.5;

interface LandscapeOptions {
  frame: ReadonlySignal<TownFrame | null>;
  light?: ModelLayerOptions["light"];
}

export function createLandscapeLayer(
  _map: maplibregl.Map,
  _opts: LandscapeOptions,
): maplibregl.CustomLayerInterface {
  return {
    id: LANDSCAPE_LAYER_ID,
    type: "custom",
    renderingMode: "3d",
    render() {},
  };
}

export function attachLandscapeLayer(
  map: maplibregl.Map,
  opts: LandscapeOptions,
): () => void {
  const layer = createLandscapeLayer(map, opts);
  if (!map.getLayer(LANDSCAPE_LAYER_ID)) {
    const before = map.getLayer("place-labels") ? "place-labels" : undefined;
    map.addLayer(layer, before);
  }
  return () => {
    if (map.getLayer(LANDSCAPE_LAYER_ID)) map.removeLayer(LANDSCAPE_LAYER_ID);
  };
}
