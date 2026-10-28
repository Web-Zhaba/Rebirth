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

  const check = () => {
    if (started || !frame.peek() || map.getZoom() < LANDSCAPE_FROM_ZOOM) return;
    started = true;
    void import("./landscapeLayer").then((m) =>
      m.attachLandscapeLayer(map, {
        frame,
        light: opts.light,
      }),
    );
  };

  map.on("zoomend", check);
  effect(() => {
    void frame.value;
    check();
  });
}
