import type * as maplibregl from "maplibre-gl";
import { effect } from "@preact/signals";
import { roadTraffic } from "../view/layers/traffic";
import { overlay, TRAFFIC_STOPS } from "./tools";
import { trafficDataActive } from "./trafficModel";

const SRC = "road-traffic";
const LAYER = "road-traffic-line";

// Traffic overlay: built road edges coloured and widened by commuters per day (counted in the worker).
export function attachTrafficLayer(map: maplibregl.Map): void {
  const setup = () => {
    map.addSource(SRC, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    const ramp = (pick: "color" | "width") => TRAFFIC_STOPS.flatMap((s) => [s.n, s[pick]]);
    map.addLayer({
      id: LAYER,
      type: "line",
      source: SRC,
      layout: { "line-cap": "round", "line-join": "round", visibility: "none" },
      paint: {
        "line-color": ["interpolate", ["linear"], ["get", "n"], ...ramp("color")] as never,
        "line-width": ["interpolate", ["linear"], ["get", "n"], ...ramp("width")] as never,
        "line-opacity": 0.9,
      },
    });
    effect(() => {
      map.setLayoutProperty(LAYER, "visibility", trafficDataActive(overlay.value) ? "visible" : "none");
    });
    effect(() => void (map.getSource(SRC) as maplibregl.GeoJSONSource).setData(roadTraffic.value));
  };
  if (map.isStyleLoaded()) setup();
  else map.once("load", setup);
}
