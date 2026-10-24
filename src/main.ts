import "./style.css";
import { render, h } from "preact";
import { effect } from "@preact/signals";
import { createMap } from "./map/mapView";
import { attachCityMarker } from "./map/cityLayer";
import { city, load } from "./simClient";
import { App } from "./ui/App";

// In dev the URL hash keeps the camera across reloads; it wins over the saved city.
// Read it before creating the map, which writes its own hash on construction.
const hasHash = import.meta.env.DEV && location.hash.length > 1;
const map = createMap("map");
attachCityMarker(map);
let centred = false;
effect(() => {
  const c = city.value;
  if (c && !centred) {
    centred = true;
    if (!hasHash) map.jumpTo({ center: [c.lng, c.lat], zoom: 14.5 });
  }
});

render(h(App, { map }), document.getElementById("ui")!);
load();

// Handle for poking at the map from devtools during development.
if (import.meta.env.DEV) Object.assign(window, { map });
