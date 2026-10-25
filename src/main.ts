import "./style.css";
import { render, h } from "preact";
import { effect } from "@preact/signals";
import { createMap } from "./map/mapView";
import { attachArticles } from "./map/articles";
import { attachBuildingLayer } from "./map/buildingLayer";
import { attachCityMarker } from "./map/cityLayer";
import { attachExcavation, oldWorld } from "./map/excavation";
import { attachPlaceTool } from "./map/placeTool";
import { attachReachLayer } from "./map/reachLayer";
import { attachRoadLayer } from "./map/roadLayer";
import { attachRuinsLayer } from "./map/ruinsLayer";
import { attachRoadTool } from "./map/roadTool";
import { attachLifeLayer } from "./map/lifeLayer";
import { attachTrafficLayer } from "./map/trafficLayer";
import { attachZoneLayer } from "./map/zoneLayer";
import { attachZoneTool } from "./map/zoneTool";
import { city, frame, gameClock, gameMinPerSec, lifeLights, lifeTrips, load } from "./simClient";
import { App } from "./ui/App";

// In dev the URL hash keeps the camera across reloads; it wins over the saved city.
// Read it before creating the map, which writes its own hash on construction.
const hasHash = import.meta.env.DEV && location.hash.length > 1;
const map = createMap("map");
attachZoneLayer(map); // zones beneath everything else we add
attachRuinsLayer(map, oldWorld, frame); // old foundations and streets, beneath the roads
attachExcavation();
attachArticles();
attachRoadLayer(map); // before the city marker so roads draw beneath it
attachBuildingLayer(map);
attachTrafficLayer(map);
attachLifeLayer(map, { trips: lifeTrips, gameMinutes: gameClock, lights: lifeLights, frame, gameMinPerSec });
attachReachLayer(map);
attachCityMarker(map);
attachRoadTool(map);
attachZoneTool(map);
attachPlaceTool(map);
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
