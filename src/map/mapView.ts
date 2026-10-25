import maplibregl from "maplibre-gl";
import { rewildedStyle } from "./style";

export function createMap(container: string): maplibregl.Map {
  const map = new maplibregl.Map({
    container,
    style: rewildedStyle(),
    center: [15, 50], // Europe, globe overview
    zoom: 1.8,
    hash: import.meta.env.DEV,
    attributionControl: false,
  });
  map.addControl(new maplibregl.NavigationControl(), "top-right");
  map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-right");
  // On a phone the credits start folded behind the «i» button: MapLibre opens them when it mounts a wide map.
  map.once("load", () => {
    if (matchMedia("(max-width: 640px)").matches) map.getContainer().querySelector(".maplibregl-ctrl-attrib")?.classList.remove("maplibregl-compact-show");
  });
  return map;
}
