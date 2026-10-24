import type maplibregl from "maplibre-gl";
import type { Feature, Polygon } from "geojson";
import { cellToBoundary } from "h3-js";

const SRC = "city-cell";
const HUE = "#e0a050";

function cellFeature(cell: string): Feature<Polygon> {
  const ring = cellToBoundary(cell, true);
  ring.push(ring[0]);
  return { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [ring] } };
}

// Draws (or updates) the city centre cell; safe to call before or after style load.
export function drawCityCell(map: maplibregl.Map, cell: string): void {
  const apply = () => {
    const data = cellFeature(cell);
    const src = map.getSource(SRC) as maplibregl.GeoJSONSource | undefined;
    if (src) {
      src.setData(data);
      return;
    }
    map.addSource(SRC, { type: "geojson", data });
    map.addLayer({ id: `${SRC}-fill`, type: "fill", source: SRC, paint: { "fill-color": HUE, "fill-opacity": 0.35 } });
    map.addLayer({ id: `${SRC}-line`, type: "line", source: SRC, paint: { "line-color": HUE, "line-width": 2 } });
  };
  // isStyleLoaded() is also false while tiles stream in after "load" has already
  // fired, so wait for "idle", which always comes once style and tiles are ready.
  if (map.isStyleLoaded()) apply();
  else map.once("idle", apply);
}
