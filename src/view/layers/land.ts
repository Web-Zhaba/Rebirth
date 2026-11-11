import { computed, signal, type ReadonlySignal } from "@preact/signals";
import type { Feature, FeatureCollection, GeoJsonProperties } from "geojson";
import { isCleared } from "../../sim/clearing";
import { fieldCentroid } from "../../sim/fields";
import type { ClientState } from "../../sim/types";
import { pointInPolygon } from "../../sim/zones";
import { frame, state, zones } from "../../simClient";
import type { Frame } from "../../world/frame";
import { selectedBuilding } from "./buildings";
import { tool } from "../../map/tools";
import type { View } from "../view";

// The land the player works: fields, clearings and the field being drawn, as GeoJSON in lng/lat. The engine
// (view/engine/gameLayers.ts) only decides how it looks.

// Unfinished clearing shown in the inspector.
export const selectedClearing = signal<number | null>(null);
// Field being drawn: placed vertices plus the moving one, in local meters.
export const fieldDraft = signal<{ pts: [number, number][]; ok: boolean } | null>(null);

const collection = (features: Feature[]): FeatureCollection => ({ type: "FeatureCollection", features });
const EMPTY = collection([]);

const polygon = (ring: [number, number][], props: GeoJsonProperties = {}): Feature => ({ type: "Feature", properties: props, geometry: { type: "Polygon", coordinates: [ring] } });

const closed = (pts: [number, number][], f: Frame): [number, number][] => {
  const ring = pts.map(([x, y]) => f.toLngLat(x, y));
  return [...ring, ring[0]];
};

export const fields: ReadonlySignal<FeatureCollection> = computed(() => {
  const z = zones.value;
  const f = frame.value;
  return z && f ? collection(z.fields.map((fl) => polygon(closed(fl.pts, f), { id: fl.id }))) : EMPTY;
});

// Clearings (`done`: cleared, drawn as meadow; otherwise an outline) and the percent labels of unfinished ones.
const clearingList = computed(() => state.value?.clearings ?? []);
// The same list while no clearing appeared, went or was finished: cutting moves `done` every tick, the shapes stay.
let drawnClearings: ClientState["clearings"] = [];
let drawnSig = "";
const clearingShapes = computed(() => {
  const list = clearingList.value;
  const sig = list.map((c) => `${c.id}:${isCleared(c) ? 1 : 0}`).join();
  if (sig !== drawnSig) {
    drawnSig = sig;
    drawnClearings = list;
  }
  return drawnClearings;
});
export const clearings: ReadonlySignal<FeatureCollection> = computed(() => {
  const f = frame.value;
  const list = clearingShapes.value;
  return f && list.length ? collection(list.map((c) => polygon(closed(c.pts, f), { id: c.id, done: isCleared(c) }))) : EMPTY;
});
export const clearingLabels: ReadonlySignal<FeatureCollection> = computed(() => {
  const f = frame.value;
  if (!f) return EMPTY;
  const out: Feature[] = [];
  for (const c of clearingList.value) {
    if (isCleared(c)) continue;
    const [x, y] = fieldCentroid(c);
    out.push({ type: "Feature", properties: { text: `${Math.floor((c.done / c.labor) * 100)} %` }, geometry: { type: "Point", coordinates: f.toLngLat(x, y) } });
  }
  return collection(out);
});

export const fieldDraftShape: ReadonlySignal<FeatureCollection> = computed(() => {
  const d = fieldDraft.value;
  const f = frame.value;
  if (!d || !f) return EMPTY;
  const lngLat = d.pts.map(([x, y]) => f.toLngLat(x, y));
  if (lngLat.length >= 3) return collection([polygon([...lngLat, lngLat[0]], { ok: d.ok })]);
  if (lngLat.length === 2) return collection([{ type: "Feature", properties: { ok: d.ok }, geometry: { type: "LineString", coordinates: lngLat } }]);
  return EMPTY;
});
export const fieldDraftPoints: ReadonlySignal<FeatureCollection> = computed(() => {
  const d = fieldDraft.value;
  const f = frame.value;
  if (!d || !f) return EMPTY;
  return collection(d.pts.map(([x, y]) => ({ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: f.toLngLat(x, y) } })));
});

// Click selects an unfinished clearing while no tool is active (a building under the click wins, see buildings.ts).
export function attachClearingPick(view: View): void {
  view.on("click", (e) => {
    if (tool.value || e.original.defaultPrevented) return; // a resident took the click (view/engine/life.ts)
    const f = frame.peek();
    const [x, y] = f ? f.toLocal(e.lngLat[0], e.lngLat[1]) : [0, 0];
    const hit = f ? state.peek()?.clearings.find((c) => !isCleared(c) && pointInPolygon(x, y, c.pts)) : undefined;
    selectedClearing.value = hit?.id ?? null;
    if (hit) selectedBuilding.value = null;
  });
}
