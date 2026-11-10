import { computed, effect, signal, type ReadonlySignal } from "@preact/signals";
import type { Feature, FeatureCollection } from "geojson";
import { reachSegments } from "../../sim/coverage";
import { lotFront } from "../../sim/people";
import { isService, SERVICES } from "../../sim/services";
import { buildings, frame, roads } from "../../simClient";
import { PALETTE } from "../../ui/palette";
import { relationRadius } from "../../map/coveragePreviewModel";
import { manualOverlay, overlay, placeReach, tool } from "../../map/tools";
import { selectedBuilding } from "./buildings";

// The road edges a service reaches: for the building being placed (preview from its candidate lot) or, with no tool
// active, for the selected finished service (whose coverage overlay is then switched on). Same bounded Dijkstra as the
// sim's coverage. A selected building with a relation radius gets that circle instead. Lines carry their `color`.

const EMPTY: FeatureCollection = { type: "FeatureCollection", features: [] };
const data = signal<FeatureCollection>(EMPTY);
export const serviceReach: ReadonlySignal<FeatureCollection> = data;

// The selected building: the same object until it changes itself (work on other sites does not touch it).
const selected = computed(() => {
  const id = selectedBuilding.value;
  return id === null ? undefined : buildings.value?.[id];
});

export function attachServiceReach(): void {
  let selectedServiceOverlay: string | null = null;
  // Reads the selected building and the roads only when something is to be drawn from them: with nothing selected
  // and nothing being placed, a tick of the town does not run this at all.
  effect(() => {
    const f = frame.value;
    const preview = placeReach.value;
    const active = tool.value;
    let target: { x: number; y: number; range: number; color: string } | null = preview;
    let radiusTarget: { x: number; y: number; radius: number; color: string } | null = null;
    let selectedService: string | null = null;
    if (!target && !active) {
      const b = selected.value;
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
    const g = target && f ? roads.value : null;
    if (target && g && f) {
      for (const [a, b] of reachSegments(g, target.x, target.y, target.range)) {
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
    data.value = features.length ? { type: "FeatureCollection", features } : EMPTY;
  });
}
