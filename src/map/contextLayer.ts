import type * as maplibregl from "maplibre-gl";
import { effect } from "@preact/signals";
import { PALETTE } from "../ui/palette";
import { contextLayerForTool } from "./contextModel";
import { ruinsAutoShown } from "./ruinsLayer";
import { tool } from "./tools";

const IDS = ["context-forest", "context-water", "context-quarry-wetland", "context-quarry-water"] as const;

export function attachContextLayer(map: maplibregl.Map): void {
  const setup = () => {
    if (map.getLayer("context-forest")) return;
    map.addLayer({
      id: "context-forest",
      type: "fill",
      source: "nature",
      "source-layer": "landcover",
      filter: ["==", ["get", "class"], "wood"],
      layout: { visibility: "none" },
      paint: { "fill-color": PALETTE.ok, "fill-opacity": 0.3 },
    });
    map.addLayer({
      id: "context-water",
      type: "fill",
      source: "nature",
      "source-layer": "water",
      layout: { visibility: "none" },
      paint: { "fill-color": PALETTE.info, "fill-opacity": 0.32 },
    });
    map.addLayer({
      id: "context-quarry-wetland",
      type: "fill",
      source: "nature",
      "source-layer": "landcover",
      filter: ["==", ["get", "class"], "wetland"],
      layout: { visibility: "none" },
      paint: { "fill-color": PALETTE.bad, "fill-opacity": 0.28 },
    });
    map.addLayer({
      id: "context-quarry-water",
      type: "fill",
      source: "nature",
      "source-layer": "water",
      layout: { visibility: "none" },
      paint: { "fill-color": PALETTE.bad, "fill-opacity": 0.28 },
    });

    effect(() => {
      const context = contextLayerForTool(tool.value);
      map.setLayoutProperty("context-forest", "visibility", context === "forest" ? "visible" : "none");
      map.setLayoutProperty("context-water", "visibility", context === "water" ? "visible" : "none");
      const quarry = context === "quarry" ? "visible" : "none";
      map.setLayoutProperty("context-quarry-wetland", "visibility", quarry);
      map.setLayoutProperty("context-quarry-water", "visibility", quarry);
      ruinsAutoShown.value = context === "ruins";
    });
  };
  if (map.isStyleLoaded()) setup();
  else map.once("load", setup);
}
