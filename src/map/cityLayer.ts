import type * as maplibregl from "maplibre-gl";
import { effect } from "@preact/signals";
import { PALETTE } from "../ui/palette";
import { campArea, cityPoint } from "../view/layers/city";
import { UNDER_BUILDINGS } from "./roadLayer";

const SRC = "city";
const CAMP_SRC = "camp";

// Warm circle at the founding point, and the camp area roads must start from.
export function attachCityMarker(map: maplibregl.Map): void {
  const apply = () => {
    const data = cityPoint.value;
    const camp = campArea.value;
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
