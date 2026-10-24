import type maplibregl from "maplibre-gl";
import { effect } from "@preact/signals";
import { city } from "../simClient";

const SRC = "city";

// Warm circle at the founding point.
export function attachCityMarker(map: maplibregl.Map): void {
  const apply = () => {
    const c = city.value;
    const data: GeoJSON.FeatureCollection = {
      type: "FeatureCollection",
      features: c ? [{ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [c.lng, c.lat] } }] : [],
    };
    const src = map.getSource(SRC) as maplibregl.GeoJSONSource | undefined;
    if (src) {
      src.setData(data);
      return;
    }
    map.addSource(SRC, { type: "geojson", data });
    map.addLayer({
      id: "city-marker",
      type: "circle",
      source: SRC,
      paint: {
        "circle-radius": 7,
        "circle-color": "#e0a050",
        "circle-stroke-color": "#ffffff",
        "circle-stroke-width": 2,
      },
    });
  };
  const run = () => effect(apply);
  if (map.isStyleLoaded()) run();
  else map.once("load", run);
}
