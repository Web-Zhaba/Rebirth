import type * as maplibregl from "maplibre-gl";
import { effect } from "@preact/signals";
import { ORIGIN_RADIUS } from "../sim/roads";
import { PALETTE } from "../ui/palette";
import { city, frame, roads } from "../simClient";
import { UNDER_BUILDINGS } from "./roadLayer";

const SRC = "city";
const CAMP_SRC = "camp";
const CAMP_STEPS = 48;

// Warm circle at the founding point, and the camp area roads must start from.
export function attachCityMarker(map: maplibregl.Map): void {
  const apply = () => {
    const c = city.value;
    const f = frame.value;
    const g = roads.value;
    const data: GeoJSON.FeatureCollection = {
      type: "FeatureCollection",
      features: c ? [{ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [c.lng, c.lat] } }] : [],
    };
    // The camp area is only a guide until the first road is built; after that it is hidden for good.
    const anyBuilt = g !== null && Object.values(g.edges).some((e) => e.done >= e.labor);
    const ring: [number, number][] = [];
    if (f && !anyBuilt) {
      for (let i = 0; i <= CAMP_STEPS; i++) {
        const a = (i / CAMP_STEPS) * 2 * Math.PI;
        ring.push(f.toLngLat(ORIGIN_RADIUS * Math.cos(a), ORIGIN_RADIUS * Math.sin(a)));
      }
    }
    const camp: GeoJSON.FeatureCollection = {
      type: "FeatureCollection",
      features: ring.length ? [{ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [ring] } }] : [],
    };
    const src = map.getSource(SRC) as maplibregl.GeoJSONSource | undefined;
    if (src) {
      src.setData(data);
      (map.getSource(CAMP_SRC) as maplibregl.GeoJSONSource).setData(camp);
      return;
    }
    map.addSource(CAMP_SRC, { type: "geojson", data: camp });
    const beneath = ["roads-casing", ...UNDER_BUILDINGS].find((id) => map.getLayer(id)); // under the roads when they exist
    map.addLayer(
      { id: "camp-fill", type: "fill", source: CAMP_SRC, minzoom: 14, paint: { "fill-color": PALETTE.warn, "fill-opacity": 0.12 } },
      beneath,
    );
    map.addLayer(
      {
        id: "camp-line",
        type: "line",
        source: CAMP_SRC,
        minzoom: 14,
        paint: { "line-color": PALETTE.warn, "line-width": 1.5, "line-dasharray": [3, 2] },
      },
      beneath,
    );
    map.addSource(SRC, { type: "geojson", data });
    map.addLayer({
      id: "city-marker",
      type: "circle",
      source: SRC,
      paint: {
        "circle-radius": 7,
        "circle-color": PALETTE.warn,
        "circle-stroke-color": PALETTE.paperRaised,
        "circle-stroke-width": 2,
      },
    });
  };
  const run = () => effect(apply);
  if (map.isStyleLoaded()) run();
  else map.once("load", run);
}
