import { effect, signal, type ReadonlySignal } from "@preact/signals";
import type { Feature, FeatureCollection } from "geojson";
import { reachSegments } from "../../sim/coverage";
import { lotFront } from "../../sim/people";
import { isService, SERVICES } from "../../sim/services";
import { frame, state } from "../../simClient";
import { PALETTE } from "../../ui/palette";
import { relationRadius } from "../../map/coveragePreviewModel";
import { manualOverlay, overlay, placeReach, tool } from "../../map/tools";
import { selectedBuilding } from "./buildings";

// The road edges a service reaches: for the building being placed (preview from its candidate lot) or, with no tool
// active, for the selected finished service (whose coverage overlay is then switched on). Same bounded Dijkstra as the
// sim's coverage. A selected building with a relation radius gets that circle instead. Lines carry their `color`.

const data = signal<FeatureCollection>({ type: "FeatureCollection", features: [] });
export const serviceReach: ReadonlySignal<FeatureCollection> = data;

export function attachServiceReach(): void {
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
    const features: Feature[] = [];
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
    data.value = { type: "FeatureCollection", features };
  });
}
