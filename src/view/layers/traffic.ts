import { computed, type ReadonlySignal } from "@preact/signals";
import type { Feature, FeatureCollection } from "geojson";
import { frame, lifeTraffic, roads } from "../../simClient";
import { overlay } from "../../map/tools";
import { trafficDataActive } from "../../map/trafficModel";

// Traffic overlay data for every renderer: built road edges with `n`, commuters per day (counted in the worker). Empty
// while the overlay is off; dependency tracking is dynamic, so then only `overlay` is watched.

const EMPTY: FeatureCollection = { type: "FeatureCollection", features: [] };

export const roadTraffic: ReadonlySignal<FeatureCollection> = computed(() => {
  if (!trafficDataActive(overlay.value)) return EMPTY;
  const f = frame.value;
  const g = roads.value;
  const traffic = lifeTraffic.value;
  if (!f || !g) return EMPTY;
  const features: Feature[] = [];
  for (const e of Object.values(g.edges)) {
    const n = traffic[e.id];
    if (!n || e.done < e.labor) continue;
    const a = g.nodes[e.a];
    const b = g.nodes[e.b];
    features.push({ type: "Feature", properties: { n }, geometry: { type: "LineString", coordinates: [f.toLngLat(a.x, a.y), f.toLngLat(b.x, b.y)] } });
  }
  return { type: "FeatureCollection", features };
});
