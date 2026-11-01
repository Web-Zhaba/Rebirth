import type * as maplibregl from "maplibre-gl";
import { effect } from "@preact/signals";
import { PALETTE } from "../ui/palette";
import { serviceReach } from "../view/layers/reach";

const SRC = "service-reach";

// The road edges a service reaches (view/layers/reach.ts), as wide coloured lines over a paper casing.
export function attachReachLayer(map: maplibregl.Map): void {
  const setup = () => {
    map.addSource(SRC, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    map.addLayer({ id: "service-reach-casing", type: "line", source: SRC, layout: { "line-cap": "round" }, paint: { "line-color": PALETTE.paperRaised, "line-width": 8, "line-opacity": 1 } });
    map.addLayer({ id: "service-reach", type: "line", source: SRC, layout: { "line-cap": "round" }, paint: { "line-color": ["get", "color"], "line-width": 5, "line-opacity": 0.9 } });
    effect(() => void (map.getSource(SRC) as maplibregl.GeoJSONSource).setData(serviceReach.value));
  };
  if (map.isStyleLoaded()) setup();
  else map.once("load", setup);
}
