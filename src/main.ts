import "./style.css";
import { render, h } from "preact";
import { createMap } from "./map/mapView";
import { loadSave } from "./game/save";
import { city } from "./game/state";
import { drawCityCell } from "./map/cityLayer";
import { App } from "./ui/App";

const save = loadSave();
// In dev the URL hash keeps the camera across reloads; it wins over the saved city.
const hasHash = import.meta.env.DEV && location.hash.length > 1;
const map = createMap("map");

if (save) {
  city.value = save.city;
  if (!hasHash) map.jumpTo({ center: [save.city.lng, save.city.lat], zoom: 14.5 });
  drawCityCell(map, save.city.cell);
}

render(h(App, { map }), document.getElementById("ui")!);

// Handle for poking at the map from devtools during development.
if (import.meta.env.DEV) Object.assign(window, { map });
