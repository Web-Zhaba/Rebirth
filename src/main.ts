import "./style.css";
import { render, h } from "preact";
import { computed, effect } from "@preact/signals";
import { attachArticles } from "./map/articles";
import { attachExcavation } from "./map/excavation";
import { attachPlaceTool } from "./map/placeTool";
import { attachRevealTool } from "./map/revealTool";
import { attachRoadTool } from "./map/roadTool";
import { attachZoneTool } from "./map/zoneTool";
import { attachToolRepeat } from "./map/tools";
import { previewClock, previewWeather } from "./map/seasonPreview";
import * as simClient from "./simClient";
import { city, frame, state, gameClock, gameMinPerSec, lifeLights, lifeTrips, load } from "./simClient";
import { mountMapLibreView, installDevHandles } from "./view/maplibre/mount";
import { TOWN_START_MPP } from "./view/scale";
import { App } from "./ui/App";
import { followResidentById } from "./ui/follow";

// In dev the URL hash keeps the camera across reloads; it wins over the saved city.
// Read it before creating the map, which writes its own hash on construction.
const hasHash = import.meta.env.DEV && location.hash.length > 1;
attachExcavation();
attachArticles();
// The map's clock and weather: the game's, or another season's while the admin panel previews one (seasonPreview.ts).
const mapClock = previewClock(gameClock);
const sunLight = { clock: mapClock, phase: computed(() => state.value?.weather?.site?.phase ?? null) };
const cloudSite = computed(() => {
  const w = state.value?.weather?.site;
  return w ? { seed: w.seed, phase: w.phase } : null;
});
const weatherNow = previewWeather(computed(() => state.value?.weather ?? null));
const view = mountMapLibreView({
  container: "map",
  frame,
  gameClock,
  mapClock,
  sunLight,
  weather: weatherNow,
  cloudSite,
  life: { trips: lifeTrips, lights: lifeLights, gameMinPerSec, onWalker: followResidentById },
  debug3dModels: import.meta.env.DEV && localStorage.getItem("debug3dModels") === "1",
});
attachRoadTool(view);
attachZoneTool(view);
attachPlaceTool(view);
attachRevealTool(view);
attachToolRepeat(view);
let centred = false;
effect(() => {
  const c = city.value;
  if (c && !centred) {
    centred = true;
    if (!hasHash) view.jumpTo({ center: [c.lng, c.lat], mpp: TOWN_START_MPP });
  }
});

render(h(App, { view }), document.getElementById("ui")!);
load();

// Handles for poking at the map and the sim from devtools during development. Use these instead of importing
// simClient again: a second module instance would start a second worker writing the same save.
if (import.meta.env.DEV) {
  Object.assign(window, { simClient });
  installDevHandles(view);
}
