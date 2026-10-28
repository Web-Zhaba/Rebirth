import type * as maplibregl from "maplibre-gl";
import { effect } from "@preact/signals";
import { frame } from "../simClient";
import type { ModelLayerOptions } from "./modelLayer";

const LANDSCAPE_FROM_ZOOM = 10.5;

export function attachLandscape(
  map: maplibregl.Map,
  opts: { light?: ModelLayerOptions["light"] },
): void {
  let started = false;

  const baseLayers = [
    "landcover",
    "forest-edge",
    "hillshade",
    "shore",
    "water",
    "waterway",
  ];

  const syncBaseVisibility = () => {
    const customWorld = map.getZoom() >= LANDSCAPE_FROM_ZOOM;

    const visibility = customWorld ? "none" : "visible";

    for (const id of baseLayers) {
      if (!map.getLayer(id)) continue;
      if (map.getLayoutProperty(id, "visibility") === visibility) continue;
      map.setLayoutProperty(id, "visibility", visibility);
    }
  };

  const check = () => {
    syncBaseVisibility();

    if (started || !frame.peek() || map.getZoom() < LANDSCAPE_FROM_ZOOM) return;

    started = true;

    void import("./landscapeLayer").then((m) =>
      m.attachLandscapeLayer(map, {
        frame,
        light: opts.light,
      }),
    );
  };

  map.on("zoom", syncBaseVisibility);
  map.on("zoomend", check);
  map.on("styledata", syncBaseVisibility);

  effect(() => {
    void frame.value;
    check();
  });

  syncBaseVisibility();
}
