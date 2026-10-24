import type maplibregl from "maplibre-gl";
import { effect } from "@preact/signals";
import { frame, lifeTraffic, roads } from "../simClient";
import { overlay, TRAFFIC_STOPS } from "./tools";

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
      map.setLayoutProperty(LAYER, "visibility", overlay.value === "traffic" ? "visible" : "none");
    });
    effect(() => {
      const f = frame.value;
      const g = roads.value;
      const traffic = lifeTraffic.value;
      if (!f || !g) return;
      const features: GeoJSON.Feature[] = [];
      for (const e of Object.values(g.edges)) {
        const n = traffic[e.id];
        if (!n || e.done < e.labor) continue;
        const a = g.nodes[e.a];
        const b = g.nodes[e.b];
        features.push({
          type: "Feature",
          properties: { n },
          geometry: { type: "LineString", coordinates: [f.toLngLat(a.x, a.y), f.toLngLat(b.x, b.y)] },
        });
      }
      (map.getSource(SRC) as maplibregl.GeoJSONSource).setData({ type: "FeatureCollection", features });
    });
  };
  if (map.isStyleLoaded()) setup();
  else map.once("load", setup);
}
