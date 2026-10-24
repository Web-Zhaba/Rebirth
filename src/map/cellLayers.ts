import type maplibregl from "maplibre-gl";
import type { ExpressionSpecification } from "maplibre-gl";
import type { Feature, FeatureCollection, Polygon } from "geojson";
import { cellToBoundary, gridDisk, latLngToCell } from "h3-js";
import { hovered } from "../game/state";
import { analyzeCell } from "../world/cells";
import type { Land } from "../world/landcover";

const HOVER_SRC = "cell-hover";
const OVERLAY_SRC = "cell-overlay";
const MIN_HOVER_ZOOM = 12;
const OVERLAY_RADIUS = 8;

const LAND_COLORS: Record<Land, string> = {
  forest: "#5f8f3e",
  meadow: "#d8c86a",
  water: "#3f86b8",
  wetland: "#6fa38e",
  sand: "#e0c27a",
  rock: "#8c8478",
  ice: "#e8f0f5",
};

const EMPTY: FeatureCollection<Polygon> = { type: "FeatureCollection", features: [] };

function cellFeature(cell: string, properties: Record<string, unknown> = {}): Feature<Polygon> {
  const ring = cellToBoundary(cell, true);
  ring.push(ring[0]);
  return { type: "Feature", properties, geometry: { type: "Polygon", coordinates: [ring] } };
}

let added = false;

function addLayers(map: maplibregl.Map): void {
  if (added) return;
  added = true;
  // The overlay goes under the buildings so they stay visible.
  const before = map.getLayer("buildings-fill") ? "buildings-fill" : undefined;
  map.addSource(OVERLAY_SRC, { type: "geojson", data: EMPTY });
  map.addLayer(
    {
      id: `${OVERLAY_SRC}-fill`,
      type: "fill",
      source: OVERLAY_SRC,
      paint: {
        "fill-color": ["match", ["get", "land"], ...Object.entries(LAND_COLORS).flat(), "#000000"] as unknown as ExpressionSpecification,
        "fill-opacity": 0.4,
      },
    },
    before,
  );
  map.addLayer(
    {
      id: `${OVERLAY_SRC}-line`,
      type: "line",
      source: OVERLAY_SRC,
      paint: {
        "line-color": ["case", ["get", "steep"], "#3b3126", "rgba(255,255,255,0.5)"],
        "line-width": ["case", ["get", "steep"], 2, 0.6],
      },
    },
    before,
  );
  map.addSource(HOVER_SRC, { type: "geojson", data: EMPTY });
  map.addLayer({ id: `${HOVER_SRC}-line`, type: "line", source: HOVER_SRC, paint: { "line-color": "#fffdf2", "line-width": 2 } });
}

// Runs fn once the layers exist; isStyleLoaded() is also false while tiles stream in
// after "load", so before the first run wait for "idle" like cityLayer does.
function withLayers(map: maplibregl.Map, fn: () => void): void {
  if (added) fn();
  else if (map.isStyleLoaded()) {
    addLayers(map);
    fn();
  } else {
    map.once("idle", () => {
      addLayers(map);
      fn();
    });
  }
}

function setData(map: maplibregl.Map, id: string, data: FeatureCollection<Polygon>): void {
  (map.getSource(id) as maplibregl.GeoJSONSource | undefined)?.setData(data);
}

function setHoverCell(map: maplibregl.Map, cell: string | null): void {
  withLayers(map, () => setData(map, HOVER_SRC, cell ? { type: "FeatureCollection", features: [cellFeature(cell)] } : EMPTY));
}

// Outlines the cell under the cursor (zoom >= 12) and publishes its info to the panel.
export function attachCellHover(map: maplibregl.Map): void {
  let current: string | null = null;
  const clear = () => {
    if (current === null) return;
    current = null;
    hovered.value = null;
    setHoverCell(map, null);
  };
  map.on("mousemove", (e) => {
    if (map.getZoom() < MIN_HOVER_ZOOM) return clear();
    const { lat, lng } = e.lngLat.wrap();
    const cell = latLngToCell(lat, lng, 9);
    if (cell === current) return;
    current = cell;
    hovered.value = { cell, status: "loading" };
    setHoverCell(map, cell);
    analyzeCell(cell).then(
      (info) => {
        if (current === cell) hovered.value = { cell, status: "ready", info };
      },
      () => {
        if (current === cell) hovered.value = { cell, status: "error" };
      },
    );
  });
  map.on("mouseout", clear);
  map.on("zoom", () => {
    if (map.getZoom() < MIN_HOVER_ZOOM) clear();
  });
}

let overlayGen = 0;

// Colors the cells around the centre by land type, filling in as each cell resolves.
export function showOverlay(map: maplibregl.Map, center: string): void {
  const gen = ++overlayGen;
  const features = new Map<string, Feature<Polygon>>();
  let timer = 0;
  const flush = () => {
    timer = 0;
    if (gen === overlayGen) setData(map, OVERLAY_SRC, { type: "FeatureCollection", features: [...features.values()] });
  };
  withLayers(map, () => {
    if (gen !== overlayGen) return;
    for (const cell of gridDisk(center, OVERLAY_RADIUS)) {
      analyzeCell(cell).then(
        (info) => {
          if (gen !== overlayGen) return;
          features.set(cell, cellFeature(cell, { land: info.land, steep: info.steep }));
          if (!timer) timer = window.setTimeout(flush, 150);
        },
        () => {}, // a failed cell just stays uncolored
      );
    }
  });
}

export function hideOverlay(map: maplibregl.Map): void {
  overlayGen++;
  withLayers(map, () => setData(map, OVERLAY_SRC, EMPTY));
}
