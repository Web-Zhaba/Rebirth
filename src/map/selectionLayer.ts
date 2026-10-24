import type maplibregl from "maplibre-gl";
import type { FeatureCollection } from "geojson";
import { effect } from "@preact/signals";
import { cellToBoundary, latLngToCell } from "h3-js";
import { selectCell } from "../actions";
import { city, selected } from "../game/state";

const SRC = "cell-selected";
const MIN_ZOOM = 12;
const EMPTY: FeatureCollection = { type: "FeatureCollection", features: [] };

function data(cell: string | null): FeatureCollection {
  if (!cell) return EMPTY;
  const ring = cellToBoundary(cell, true);
  ring.push(ring[0]);
  return { type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [ring] } }] };
}

// Click selects the cell under the cursor once a city exists; click again or Esc clears.
export function attachSelection(map: maplibregl.Map): void {
  let ready = false;
  const render = () => {
    const cell = selected.value;
    if (ready) (map.getSource(SRC) as maplibregl.GeoJSONSource | undefined)?.setData(data(cell));
  };
  const init = () => {
    const before = map.getLayer("cell-hover-line") ? "cell-hover-line" : undefined;
    map.addSource(SRC, { type: "geojson", data: EMPTY });
    map.addLayer({ id: `${SRC}-line`, type: "line", source: SRC, paint: { "line-color": "#ff9a3c", "line-width": 4 } }, before);
    ready = true;
    render();
  };
  if (map.isStyleLoaded()) init();
  else map.once("idle", init);
  effect(render);

  map.on("click", (e) => {
    if (!city.value || map.getZoom() < MIN_ZOOM) return;
    const { lat, lng } = e.lngLat.wrap();
    const cell = latLngToCell(lat, lng, 9);
    selectCell(cell === selected.value ? null : cell);
  });
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && selected.value) selectCell(null);
  });
}
