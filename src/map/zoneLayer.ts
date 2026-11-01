import type * as maplibregl from "maplibre-gl";
import { effect, type ReadonlySignal } from "@preact/signals";
import type { FeatureCollection } from "geojson";
import { PALETTE } from "../ui/palette";
import {
  clearingLabels,
  clearings,
  fieldDraftPoints,
  fieldDraftShape,
  fields,
  zoneCells,
  zoneGrid,
  zoneHover,
} from "../view/layers/zones";
import { addPatterns, PATTERNS } from "./patterns";
import { MEADOW_COLOR } from "./style";
import { ZONE_COLORS } from "./tools";

const MIN_ZONE_ZOOM = 15; // the layer's own visual stop; the brush gate is ZONE_MAX_MPP in tools.ts

const empty = (): GeoJSON.FeatureCollection => ({ type: "FeatureCollection", features: [] });

const FILL_COLOR = ["match", ["get", "zone"], "res", ZONE_COLORS.res, "craft", ZONE_COLORS.craft, ZONE_COLORS.trade];

// The data of each source (view/layers/zones.ts, shared with the engine); this file only styles it.
const SOURCES: [string, ReadonlySignal<FeatureCollection>][] = [
  ["clearings", clearings],
  ["clearing-labels", clearingLabels],
  ["fields", fields],
  ["zone-cells", zoneCells],
  ["zone-grid", zoneGrid],
  ["zone-hover", zoneHover],
  ["field-draft", fieldDraftShape],
  ["field-draft-pts", fieldDraftPoints],
];

// Zone cells and fields. Added at load, so every later layer (roads, markers) draws above them.
export function attachZoneLayer(map: maplibregl.Map): void {
  const source = (id: string) => map.getSource(id) as maplibregl.GeoJSONSource | undefined;

  const setup = () => {
    addPatterns(map);
    for (const id of ["clearings", "clearing-labels", "fields", "zone-cells", "zone-grid", "zone-hover", "field-draft", "field-draft-pts"]) {
      map.addSource(id, { type: "geojson", data: empty() });
    }
    // Cleared forest is plain meadow; a clearing in progress is an outline with its percent done.
    map.addLayer({
      id: "clearings-fill",
      type: "fill",
      source: "clearings",
      filter: ["get", "done"],
      paint: { "fill-color": MEADOW_COLOR, "fill-opacity": 1 },
    });
    map.addLayer({
      id: "clearings-line",
      type: "line",
      source: "clearings",
      filter: ["!", ["get", "done"]],
      paint: { "line-color": PALETTE.pencil, "line-width": 2, "line-dasharray": [2, 1.5] },
    });
    map.addLayer({
      id: "clearing-labels",
      type: "symbol",
      source: "clearing-labels",
      layout: { "text-field": ["get", "text"], "text-font": ["Noto Sans Regular"], "text-size": 12 },
      paint: { "text-color": PALETTE.ink, "text-halo-color": PALETTE.paperRaised, "text-halo-width": 1.5 },
    });
    map.addLayer({
      id: "fields-fill",
      type: "fill",
      source: "fields",
      paint: { "fill-color": PALETTE.warnFill, "fill-opacity": 0.7 },
    });
    map.addLayer({
      id: "fields-furrows",
      type: "fill",
      source: "fields",
      paint: { "fill-pattern": PATTERNS.field },
    });
    map.addLayer({
      id: "fields-line",
      type: "line",
      source: "fields",
      paint: { "line-color": PALETTE.warn, "line-width": 1.5 },
    });
    map.addLayer({
      id: "zones-fill",
      type: "fill",
      source: "zone-cells",
      minzoom: MIN_ZONE_ZOOM,
      paint: { "fill-color": FILL_COLOR as never, "fill-opacity": ["case", ["get", "occ"], 0.14, 0.34] as never },
    });
    map.addLayer({
      id: "zones-pattern",
      type: "fill",
      source: "zone-cells",
      minzoom: MIN_ZONE_ZOOM,
      paint: { "fill-pattern": ["match", ["get", "zone"], "res", PATTERNS.res, "craft", PATTERNS.craft, PATTERNS.trade] as never, "fill-opacity": ["case", ["get", "occ"], 0.5, 1] as never },
    });
    map.addLayer({
      id: "zones-grid",
      type: "line",
      source: "zone-grid",
      minzoom: MIN_ZONE_ZOOM,
      paint: { "line-color": PALETTE.ink, "line-width": 0.8, "line-opacity": 0.22 },
    });
    map.addLayer({
      id: "zone-hover",
      type: "fill",
      source: "zone-hover",
      minzoom: MIN_ZONE_ZOOM,
      paint: { "fill-color": PALETTE.paperRaised, "fill-opacity": 0.55, "fill-outline-color": PALETTE.ink },
    });
    map.addLayer({
      id: "field-draft-fill",
      type: "fill",
      source: "field-draft",
      paint: { "fill-color": ["case", ["get", "ok"], PALETTE.warnFill, PALETTE.badFill], "fill-opacity": 0.6 },
    });
    map.addLayer({
      id: "field-draft-line",
      type: "line",
      source: "field-draft",
      paint: { "line-color": ["case", ["get", "ok"], PALETTE.warn, PALETTE.bad], "line-width": 2, "line-dasharray": [2, 1.5] },
    });
    map.addLayer({
      id: "field-draft-pts",
      type: "circle",
      source: "field-draft-pts",
      paint: { "circle-radius": 4, "circle-color": PALETTE.paperRaised, "circle-stroke-color": PALETTE.ink, "circle-stroke-width": 2 },
    });

    for (const [id, data] of SOURCES) effect(() => void source(id)?.setData(data.value));
  };

  if (map.isStyleLoaded()) setup();
  else map.once("load", setup);
}
