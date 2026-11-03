import { computed, signal, type ReadonlySignal } from "@preact/signals";
import type { Feature, FeatureCollection, GeoJsonProperties } from "geojson";
import { isCleared } from "../../sim/clearing";
import { fieldCentroid } from "../../sim/fields";
import { occupiedKeys } from "../../sim/growth";
import type { ZoneCell, ZoneType } from "../../sim/types";
import { cellCorners, pointInPolygon } from "../../sim/zones";
import { buildingSet, frame, state, zones } from "../../simClient";
import type { Frame } from "../../world/frame";
import { selectedBuilding } from "./buildings";
import { isBrushTool, tool, zonesShown } from "../../map/tools";
import { cellsForKeys, indexCellsByKey } from "../../map/zoneCellIndex";
import type { View } from "../view";

// What the zone layer shows: zone cells, the brush grid and hover, fields, clearings and the field being drawn, as
// GeoJSON in lng/lat. The engine (view/engine/gameLayers.ts) only decides how it looks.

// Unfinished clearing shown in the inspector.
export const selectedClearing = signal<number | null>(null);
// Optimistic paint while a drag is in progress or a command is in flight: key -> zone.
export const paintPreview = signal<Map<string, "none" | ZoneType> | null>(null);
// Cells under the brush.
export const hoverKeys = signal<string[]>([]);
// Field being drawn: placed vertices plus the moving one, in local meters.
export const fieldDraft = signal<{ pts: [number, number][]; ok: boolean } | null>(null);

const collection = (features: Feature[]): FeatureCollection => ({ type: "FeatureCollection", features });
const EMPTY = collection([]);

// Cell rectangles converted to lng/lat once and reused (cells keep their geometry across regenerations).
const ringCache = new Map<string, { cx: number; cy: number; ring: [number, number][] }>();

function ringOf(c: ZoneCell, f: Frame): [number, number][] {
  const hit = ringCache.get(c.key);
  if (hit && hit.cx === c.cx && hit.cy === c.cy) return hit.ring;
  const corners = cellCorners(c).map(([x, y]) => f.toLngLat(x, y));
  const ring = [...corners, corners[0]];
  ringCache.set(c.key, { cx: c.cx, cy: c.cy, ring });
  return ring;
}

const polygon = (ring: [number, number][], props: GeoJsonProperties = {}): Feature => ({ type: "Feature", properties: props, geometry: { type: "Polygon", coordinates: [ring] } });

const closed = (pts: [number, number][], f: Frame): [number, number][] => {
  const ring = pts.map(([x, y]) => f.toLngLat(x, y));
  return [...ring, ring[0]];
};

// Zoned cells (with any in-flight paint applied); `occ` marks cells under a lot, drawn fainter, as plots.
export const zoneCells: ReadonlySignal<FeatureCollection> = computed(() => {
  const z = zones.value;
  const f = frame.value;
  const preview = paintPreview.value;
  const visible = zonesShown.value;
  buildingSet.value; // re-run when lots change
  if (!z || !f || !visible) return EMPTY;
  const features: Feature[] = [];
  const occupied = occupiedKeys(z.cells, state.peek()?.buildings ?? {});
  for (const c of z.cells) {
    if (c.block) continue;
    const zone = preview?.get(c.key) ?? c.zone;
    if (zone !== "none") features.push(polygon(ringOf(c, f), { zone, occ: occupied.has(c.key) }));
  }
  if (ringCache.size > z.cells.length * 3 + 1000) {
    const live = new Set(z.cells.map((c) => c.key));
    for (const k of ringCache.keys()) if (!live.has(k)) ringCache.delete(k);
  }
  return collection(features);
});

// Outlines of free, unzoned cells while a brush tool is active.
export const zoneGrid: ReadonlySignal<FeatureCollection> = computed(() => {
  const z = zones.value;
  const f = frame.value;
  const t = tool.value;
  if (!z || !f || !t || !isBrushTool(t)) return EMPTY;
  return collection(z.cells.filter((c) => !c.block && c.zone === "none").map((c) => polygon(ringOf(c, f), {})));
});

// Brush highlight. The cursor only needs a handful of cells; they are indexed once per zone snapshot instead of
// scanning the full grid on every mouse move.
let hoverIndexFor: unknown = null;
let hoverIndex = new Map<string, ZoneCell>();
export const zoneHover: ReadonlySignal<FeatureCollection> = computed(() => {
  const z = zones.value;
  const f = frame.value;
  const keys = hoverKeys.value;
  if (!z || !f || keys.length === 0) return EMPTY;
  if (hoverIndexFor !== z) {
    hoverIndexFor = z;
    hoverIndex = indexCellsByKey(z.cells);
  }
  return collection(cellsForKeys(hoverIndex, keys).map((c) => polygon(ringOf(c, f), {})));
});

export const fields: ReadonlySignal<FeatureCollection> = computed(() => {
  const z = zones.value;
  const f = frame.value;
  return z && f ? collection(z.fields.map((fl) => polygon(closed(fl.pts, f), { id: fl.id }))) : EMPTY;
});

// Clearings (`done`: cleared, drawn as meadow; otherwise an outline) and the percent labels of unfinished ones.
const clearingList = computed(() => state.value?.clearings ?? []);
export const clearings: ReadonlySignal<FeatureCollection> = computed(() => {
  const f = frame.value;
  const list = clearingList.value;
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
