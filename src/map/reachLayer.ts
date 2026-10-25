import type maplibregl from "maplibre-gl";
import { effect } from "@preact/signals";
import { reachSegments } from "../sim/coverage";
import { lotFront } from "../sim/people";
import { isService, SERVICES } from "../sim/services";
import { frame, state } from "../simClient";
import { selectedBuilding } from "./buildingLayer";
import { PALETTE } from "../ui/palette";
import { placeReach, tool } from "./tools";

const SRC = "service-reach";

// The road edges a service reaches: for the building being placed (preview from its candidate lot) or,
// with no tool active, for the selected finished service. Same bounded Dijkstra as the sim's coverage.
export function attachReachLayer(map: maplibregl.Map): void {
  const setup = () => {
    map.addSource(SRC, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    map.addLayer({ id: "service-reach-casing", type: "line", source: SRC, layout: { "line-cap": "round" }, paint: { "line-color": PALETTE.paperRaised, "line-width": 8, "line-opacity": 1 } });
    map.addLayer({ id: "service-reach", type: "line", source: SRC, layout: { "line-cap": "round" }, paint: { "line-color": ["get", "color"], "line-width": 5, "line-opacity": 0.9 } });

    effect(() => {
      const st = state.value;
      const f = frame.value;
      const preview = placeReach.value;
      const sel = selectedBuilding.value;
      const active = tool.value;
      let target: { x: number; y: number; range: number; color: string } | null = preview;
      if (!target && !active && sel !== null && st) {
        const b = st.buildings[sel];
        if (b && b.state === "active" && isService(b.template)) {
          const [x, y] = lotFront(b);
          target = { x, y, range: SERVICES[b.template].reach, color: SERVICES[b.template].color };
        }
      }
      const features: GeoJSON.Feature[] = [];
      if (target && st && f) {
        for (const [a, b] of reachSegments(st.roads, target.x, target.y, target.range)) {
          features.push({
            type: "Feature",
            properties: { color: target.color },
            geometry: { type: "LineString", coordinates: [f.toLngLat(a[0], a[1]), f.toLngLat(b[0], b[1])] },
          });
        }
      }
      (map.getSource(SRC) as maplibregl.GeoJSONSource).setData({ type: "FeatureCollection", features });
    });
  };
  if (map.isStyleLoaded()) setup();
  else map.once("load", setup);
}
