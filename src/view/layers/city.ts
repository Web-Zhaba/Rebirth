import { computed, type ReadonlySignal } from "@preact/signals";
import type { FeatureCollection } from "geojson";
import { ORIGIN_RADIUS } from "../../sim/roads";
import { city, frame, roads } from "../../simClient";

// The founding point and the camp area roads must start from, for every renderer.

const CAMP_STEPS = 48;
const EMPTY: FeatureCollection = { type: "FeatureCollection", features: [] };

export const cityPoint: ReadonlySignal<FeatureCollection> = computed(() => {
  const c = city.value;
  return c ? { type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [c.lng, c.lat] } }] } : EMPTY;
});

// The camp area is only a guide until the first road is built; after that it is hidden for good.
const anyRoadBuilt = computed(() => Object.values(roads.value?.edges ?? {}).some((e) => e.done >= e.labor));
export const campArea: ReadonlySignal<FeatureCollection> = computed(() => {
  const f = frame.value;
  if (!f || anyRoadBuilt.value) return EMPTY;
  const ring: [number, number][] = [];
  for (let i = 0; i <= CAMP_STEPS; i++) {
    const a = (i / CAMP_STEPS) * 2 * Math.PI;
    ring.push(f.toLngLat(ORIGIN_RADIUS * Math.cos(a), ORIGIN_RADIUS * Math.sin(a)));
  }
  return { type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [ring] } }] };
});
