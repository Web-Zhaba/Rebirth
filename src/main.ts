import "./style.css";
import { render, h } from "preact";
import { computed, effect } from "@preact/signals";
import { createMap } from "./map/mapView";
import { attachContextLayer } from "./map/contextLayer";
import { attachTrackpadGestures } from "./map/trackpadGestures";
import { attachArticles } from "./map/articles";
import { attachArticleMarkers } from "./map/articleMarkerLayer";
import { attachBadgeLayer } from "./map/badgeLayer";
import { attachBuildingLayer } from "./map/buildingLayer";
import { attachForest } from "./map/forest";
import { attachWater } from "./map/water";
import { attachFields3d } from "./map/fields3d";
import { attachSmoke } from "./map/smoke";
import { attachModels } from "./map/models";
import { attachCityMarker } from "./map/cityLayer";
import { attachExcavation, oldWorld } from "./map/excavation";
import { attachPlaceLabels } from "./map/placeLabels";
import { attachPlaceTool } from "./map/placeTool";
import { attachRevealTool } from "./map/revealTool";
import { attachReachLayer } from "./map/reachLayer";
import { attachRelief } from "./map/relief";
import { attachRoadLayer } from "./map/roadLayer";
import { attachRuinsLayer, ruinsShown } from "./map/ruinsLayer";
import { attachRoadTool } from "./map/roadTool";
import { attachLifeLayer } from "./map/lifeLayer";
import { attachClouds } from "./map/clouds/attach";
import { attachNightTint } from "./map/nightLayer";
import { attachPrecipitation } from "./map/precipLayer";
import { attachTrafficLayer } from "./map/trafficLayer";
import { attachWeatherLayer } from "./map/weatherLayer";
import { attachZoneLayer } from "./map/zoneLayer";
import { attachZoneTool } from "./map/zoneTool";
import { attachToolRepeat } from "./map/tools";
import { previewClock, previewWeather } from "./map/seasonPreview";
import * as simClient from "./simClient";
import { city, frame, state, gameClock, gameMinPerSec, lifeLights, lifeTrips, load } from "./simClient";
import { App } from "./ui/App";

// In dev the URL hash keeps the camera across reloads; it wins over the saved city.
// Read it before creating the map, which writes its own hash on construction.
const hasHash = import.meta.env.DEV && location.hash.length > 1;
const map = createMap("map");
attachTrackpadGestures(map);
attachPlaceLabels(map);
attachContextLayer(map);
attachZoneLayer(map); // zones beneath everything else we add
attachRuinsLayer(map, oldWorld, frame); // old foundations and streets, beneath the roads
attachExcavation();
attachArticles();
attachArticleMarkers(map);
attachRoadLayer(map); // before the city marker so roads draw beneath it
attachBuildingLayer(map);
// Buildings and built roads as three.js models (loaded with the first one); localStorage debug3dModels = "1" shows every model kind instead.
// The map's clock and weather: the game's, or another season's while the admin panel previews one (seasonPreview.ts).
const mapClock = previewClock(gameClock);
const sunLight = { clock: mapClock, phase: computed(() => state.value?.weather?.site?.phase ?? null) };
attachBadgeLayer(map); // HTML badges above the buildings
attachTrafficLayer(map);
attachLifeLayer(map, { trips: lifeTrips, gameMinutes: gameClock, lights: lifeLights, frame, gameMinPerSec });
attachNightTint(map, gameClock); // dusk tint of the map itself; sits just under the lights
attachRelief(map, gameClock); // 3D terrain (a setting) and the sky over it
attachReachLayer(map);
attachCityMarker(map);
const cloudSite = computed(() => {
  const w = state.value?.weather?.site;
  return w ? { seed: w.seed, phase: w.phase } : null;
});
const weatherNow = previewWeather(computed(() => state.value?.weather ?? null));
attachModels(map, { light: sunLight, weather: weatherNow, debug: import.meta.env.DEV && localStorage.getItem("debug3dModels") === "1" });
// 3D trees in the forest around the town, close up, with bushes, reeds, boulders and the overgrown old foundations
attachForest(map, { light: sunLight, weather: weatherNow, ruins: computed(() => (ruinsShown.value ? (oldWorld.value?.foundations ?? null) : null)) });
attachWater(map, { light: sunLight, weather: weatherNow }); // 3D water, close up
attachFields3d(map, { light: sunLight, weather: weatherNow }); // ploughland and crops on the farm fields, close up
attachSmoke(map, { light: sunLight, weather: weatherNow }); // smoke from the chimneys of lived-in houses and working shops, close up
// Clouds above everything on the map, visible only on the far globe views; their ground shadows at every zoom, just
// under the night tint (so the lights stay bright).
attachClouds(map, {
  clock: gameClock,
  site: cloudSite,
  extraLayers: [{ beforeId: "night-tint", load: async () => (await import("./map/clouds/cloudShadows")).createShadowLayer(map, { clock: gameClock, site: cloudSite }) }],
});
attachWeatherLayer(map, { weather: weatherNow, clock: mapClock });
attachPrecipitation(map, { weather: weatherNow });
attachRoadTool(map);
attachZoneTool(map);
attachPlaceTool(map);
attachRevealTool(map);
attachToolRepeat(map);
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

// Handles for poking at the map and the sim from devtools during development. Use these instead of importing
// simClient again: a second module instance would start a second worker writing the same save.
if (import.meta.env.DEV) Object.assign(window, { map, simClient });
