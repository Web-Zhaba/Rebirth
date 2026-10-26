import { signal } from "@preact/signals";
import type { ExpressionSpecification } from "maplibre-gl";

// Ids of the buildings the restored-buildings layer (restoredLayer.ts, three.js) draws itself. Lives in the main chunk, so
// buildingLayer.ts can import it without pulling in three.js; the layer publishes the set here.
//
//   const ex = restoredFilter(restoredIds.value);
//   map.setFilter(layer, ex ? ["all", base, ex] : base);   // buildingLayer: skip what three.js draws
export const restoredIds = signal<ReadonlySet<string | number>>(new Set());

// Map filter that keeps every feature whose `id` property is NOT in the set; null when the set is empty.
export function restoredFilter(ids: Iterable<string | number>, prop = "id"): ExpressionSpecification | null {
  const list = [...ids];
  return list.length ? ["!", ["in", ["get", prop], ["literal", list]]] : null;
}
