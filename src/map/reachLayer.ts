import type * as maplibregl from "maplibre-gl";
import { effect } from "@preact/signals";
import { reachSegments } from "../sim/coverage";
import { lotFront } from "../sim/people";
import { isService, SERVICES } from "../sim/services";
import { frame, state } from "../simClient";
import { selectedBuilding } from "./buildingLayer";
import { PALETTE } from "../ui/palette";
import { relationRadius } from "./coveragePreviewModel";
import { manualOverlay, overlay, placeReach, tool } from "./tools";

const SRC = "service-reach";

// The road edges a service reaches: for the building being placed (preview from its candidate lot) or,
// with no tool active, for the selected finished service. Same bounded Dijkstra as the sim's coverage.
export function attachReachLayer(map: maplibregl.Map): void {
  const setup = () => {
    map.addSource(SRC, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    map.addLayer({ id: "service-reach-casing", type: "line", source: SRC, layout: { "line-cap": "round" }, paint: { "line-color": PALETTE.paperRaised, "line-width": 8, "line-opacity": 1 } });
    map.addLayer({ id: "service-reach", type: "line", source: SRC, layout: { "line-cap": "round" }, paint: { "line-color": ["get", "color"], "line-width": 5, "line-opacity": 0.9 } });

    let selectedServiceOverlay: string | null = null;
    effect(() => {
      const st = state.value;
      const f = frame.value;
      const preview = placeReach.value;
      const sel = selectedBuilding.value;
      const active = tool.value;
      let target: { x: number; y: number; range: number; color: string } | null = preview;
      let radiusTarget: { x: number; y: number; radius: number; color: string } | null = null;
      let selectedService: string | null = null;
      if (!target && !active && sel !== null && st) {
        const b = st.buildings[sel];
        if (b && b.state === "active" && isService(b.template)) {
          const [x, y] = lotFront(b);
          target = { x, y, range: SERVICES[b.template].reach, color: SERVICES[b.template].color };
          selectedService = b.template;
        } else if (b && b.state === "active") {
          const radius = relationRadius(b.template, b.radius);
          if (radius !== null) radiusTarget = { x: b.lot.cx, y: b.lot.cy, radius, color: PALETTE.info };
        }
      }
      if (selectedService) {
        selectedServiceOverlay = selectedService;
        overlay.value = selectedService as typeof overlay.value;
      } else if (selectedServiceOverlay) {
        if (!active && overlay.peek() === selectedServiceOverlay) overlay.value = manualOverlay.peek();
        selectedServiceOverlay = null;
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
      if (radiusTarget && f) {
        const pts: [number, number][] = [];
        for (let i = 0; i <= 64; i++) {
          const a = (i / 64) * Math.PI * 2;
          pts.push(f.toLngLat(radiusTarget.x + Math.cos(a) * radiusTarget.radius, radiusTarget.y + Math.sin(a) * radiusTarget.radius));
        }
        features.push({
          type: "Feature",
          properties: { color: radiusTarget.color },
          geometry: { type: "LineString", coordinates: pts },
        });
      }
      (map.getSource(SRC) as maplibregl.GeoJSONSource).setData({ type: "FeatureCollection", features });
    });
  };
  if (map.isStyleLoaded()) setup();
  else map.once("load", setup);
}
