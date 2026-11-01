import type * as maplibregl from "maplibre-gl";
import { effect } from "@preact/signals";
import { PALETTE } from "../ui/palette";
import { buildingShapes } from "../view/layers/buildings";

const SRC = "buildings";
const OUTLINE_MAX_PITCH = 10; // degrees

// Buildings: finished ones and building sites are three.js models (modelLayer.ts via models.ts, fed by `buildingItems`
// of view/layers/buildings.ts), planned ones a dashed outline; footprint outlines near a top-down view.
export function attachBuildingLayer(map: maplibregl.Map): void {
  const setup = () => {
    map.addSource(SRC, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    map.addLayer({
      id: "buildings-planned-fill",
      type: "fill",
      source: SRC,
      filter: ["==", ["get", "state"], "planned"],
      paint: { "fill-color": PALETTE.paperRaised, "fill-opacity": 0.4 },
    });
    map.addLayer({
      id: "buildings-planned",
      type: "line",
      source: SRC,
      filter: ["==", ["get", "state"], "planned"],
      paint: { "line-color": PALETTE.ink2, "line-width": 1.5, "line-dasharray": [2, 1.5] },
    });
    // Footprint outlines show only close to a top-down view: at a tilt they would be drawn over the walls.
    map.addLayer({
      id: "buildings-outline",
      type: "line",
      source: SRC,
      filter: ["in", ["get", "state"], ["literal", ["active", "building"]]],
      paint: {
        "line-color": ["case", ["get", "up"], PALETTE.warn, PALETTE.ink],
        "line-width": ["case", ["get", "up"], 3, 1],
        "line-opacity": ["case", ["get", "up"], 1, 0.55],
      },
    });
    const outlineByTilt = () => map.setLayoutProperty("buildings-outline", "visibility", map.getPitch() < OUTLINE_MAX_PITCH ? "visible" : "none");
    map.on("pitch", outlineByTilt);
    outlineByTilt();

    effect(() => void (map.getSource(SRC) as maplibregl.GeoJSONSource).setData(buildingShapes.value));
  };

  if (map.isStyleLoaded()) setup();
  else map.once("load", setup);
}
