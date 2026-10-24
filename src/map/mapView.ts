import maplibregl from "maplibre-gl";
import { rewildedStyle } from "./style";

export function createMap(container: string): maplibregl.Map {
  const map = new maplibregl.Map({
    container,
    style: rewildedStyle(),
    center: [30.3141, 59.9386], // Saint Petersburg, used when the URL has no hash
    zoom: 13,
    hash: true,
    attributionControl: false,
  });
  map.addControl(new maplibregl.NavigationControl(), "top-right");
  map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-right");
  return map;
}
