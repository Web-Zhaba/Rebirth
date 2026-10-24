import type maplibregl from "maplibre-gl";
import { effect, signal } from "@preact/signals";
import type { ZoneCell, ZoneType } from "../sim/types";
import { cellCorners } from "../sim/zones";
import { occupiedKeys } from "../sim/growth";
import { buildingSet, frame, state, zones } from "../simClient";
import type { Frame } from "../world/frame";
import { isBrushTool, MIN_ZONE_ZOOM, tool, ZONE_COLORS } from "./tools";

// Optimistic paint while a drag is in progress or a command is in flight: key -> zone.
export const paintPreview = signal<Map<string, "none" | ZoneType> | null>(null);
// Cells under the brush.
export const hoverKeys = signal<string[]>([]);
// Field being drawn: placed vertices plus the moving one, in local meters.
export const fieldDraft = signal<{ pts: [number, number][]; ok: boolean } | null>(null);

const empty = (): GeoJSON.FeatureCollection => ({ type: "FeatureCollection", features: [] });

const FILL_COLOR = ["match", ["get", "zone"], "res", ZONE_COLORS.res, "craft", ZONE_COLORS.craft, ZONE_COLORS.trade];

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

const polygon = (ring: [number, number][], props: GeoJSON.GeoJsonProperties = {}): GeoJSON.Feature => ({
  type: "Feature",
  properties: props,
  geometry: { type: "Polygon", coordinates: [ring] },
});

const closed = (pts: [number, number][], f: Frame): [number, number][] => {
  const ring = pts.map(([x, y]) => f.toLngLat(x, y));
  return [...ring, ring[0]];
};

// Zone cells and fields. Added at load, so every later layer (roads, markers) draws above them.
export function attachZoneLayer(map: maplibregl.Map): void {
  const source = (id: string) => map.getSource(id) as maplibregl.GeoJSONSource | undefined;

  const setup = () => {
    for (const id of ["fields", "zone-cells", "zone-grid", "zone-hover", "field-draft", "field-draft-pts"]) {
      map.addSource(id, { type: "geojson", data: empty() });
    }
    map.addLayer({
      id: "fields-fill",
      type: "fill",
      source: "fields",
      paint: { "fill-color": "#d9c26a", "fill-opacity": 0.5 },
    });
    map.addLayer({
      id: "fields-line",
      type: "line",
      source: "fields",
      paint: { "line-color": "#8a7428", "line-width": 1.5 },
    });
    map.addLayer({
      id: "zones-fill",
      type: "fill",
      source: "zone-cells",
      minzoom: MIN_ZONE_ZOOM,
      paint: { "fill-color": FILL_COLOR as never, "fill-opacity": ["case", ["get", "occ"], 0.2, 0.45] as never },
    });
    map.addLayer({
      id: "zones-grid",
      type: "line",
      source: "zone-grid",
      minzoom: MIN_ZONE_ZOOM,
      paint: { "line-color": "#ffffff", "line-width": 0.8, "line-opacity": 0.6 },
    });
    map.addLayer({
      id: "zone-hover",
      type: "fill",
      source: "zone-hover",
      minzoom: MIN_ZONE_ZOOM,
      paint: { "fill-color": "#ffffff", "fill-opacity": 0.45, "fill-outline-color": "#ffffff" },
    });
    map.addLayer({
      id: "field-draft-fill",
      type: "fill",
      source: "field-draft",
      paint: { "fill-color": ["case", ["get", "ok"], "#d9c26a", "#d0342c"], "fill-opacity": 0.35 },
    });
    map.addLayer({
      id: "field-draft-line",
      type: "line",
      source: "field-draft",
      paint: { "line-color": ["case", ["get", "ok"], "#8a7428", "#d0342c"], "line-width": 2, "line-dasharray": [2, 1.5] },
    });
    map.addLayer({
      id: "field-draft-pts",
      type: "circle",
      source: "field-draft-pts",
      paint: { "circle-radius": 4, "circle-color": "#ffffff", "circle-stroke-color": "#8a7428", "circle-stroke-width": 2 },
    });

    // Zoned cells (with any in-flight paint applied).
    effect(() => {
      const z = zones.value;
      const f = frame.value;
      const preview = paintPreview.value;
      buildingSet.value; // re-run when lots change; lots are drawn fainter, as plots
      if (!z || !f) return;
      const occupied = occupiedKeys(z.cells, state.peek()?.buildings ?? {});
      const features: GeoJSON.Feature[] = [];
      for (const c of z.cells) {
        if (c.block) continue;
        const zone = preview?.get(c.key) ?? c.zone;
        if (zone !== "none") features.push(polygon(ringOf(c, f), { zone, occ: occupied.has(c.key) }));
      }
      source("zone-cells")?.setData({ type: "FeatureCollection", features });
      if (ringCache.size > z.cells.length * 3 + 1000) {
        const live = new Set(z.cells.map((c) => c.key));
        for (const k of ringCache.keys()) if (!live.has(k)) ringCache.delete(k);
      }
    });

    // Outlines of free, unzoned cells while a brush tool is active.
    effect(() => {
      const z = zones.value;
      const f = frame.value;
      const t = tool.value;
      const features: GeoJSON.Feature[] = [];
      if (z && f && t && isBrushTool(t)) {
        for (const c of z.cells) if (!c.block && c.zone === "none") features.push(polygon(ringOf(c, f), {}));
      }
      source("zone-grid")?.setData({ type: "FeatureCollection", features });
    });

    // Brush highlight.
    effect(() => {
      const z = zones.value;
      const f = frame.value;
      const keys = hoverKeys.value;
      const features: GeoJSON.Feature[] = [];
      if (z && f && keys.length > 0) {
        const want = new Set(keys);
        for (const c of z.cells) if (want.has(c.key)) features.push(polygon(ringOf(c, f), {}));
      }
      source("zone-hover")?.setData({ type: "FeatureCollection", features });
    });

    effect(() => {
      const z = zones.value;
      const f = frame.value;
      const features = z && f ? z.fields.map((fl) => polygon(closed(fl.pts, f), { id: fl.id })) : [];
      source("fields")?.setData({ type: "FeatureCollection", features });
    });

    effect(() => {
      const d = fieldDraft.value;
      const f = frame.value;
      const shape: GeoJSON.Feature[] = [];
      const pts: GeoJSON.Feature[] = [];
      if (d && f) {
        const lngLat = d.pts.map(([x, y]) => f.toLngLat(x, y));
        if (lngLat.length >= 3) shape.push(polygon([...lngLat, lngLat[0]], { ok: d.ok }));
        else if (lngLat.length === 2) {
          shape.push({ type: "Feature", properties: { ok: d.ok }, geometry: { type: "LineString", coordinates: lngLat } });
        }
        for (const p of lngLat) pts.push({ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: p } });
      }
      source("field-draft")?.setData({ type: "FeatureCollection", features: shape });
      source("field-draft-pts")?.setData({ type: "FeatureCollection", features: pts });
    });
  };

  if (map.isStyleLoaded()) setup();
  else map.once("load", setup);
}
