import { render, h } from "preact";
import { computed, effect } from "@preact/signals";
import { attachArticles } from "./map/articles";
import { attachExcavation } from "./map/excavation";
import { attachPlaceTool } from "./map/placeTool";
import { attachStrokeTool } from "./map/strokeTool";
import { attachRevealTool } from "./map/revealTool";
import { attachRoadTool } from "./map/roadTool";
import { attachLandTool } from "./map/landTool";
import { previewClock, previewWeather } from "./map/seasonPreview";
import * as simClient from "./simClient";
import { city, frame, state, gameClock, gameMinPerSec, lifeLights, lifeRests, lifeTrips, load, loaded, setSpeed, speed } from "./simClient";
import type { Speed } from "./sim/clock";
import { platform } from "./platform";
import { soundPaused } from "./ui/sound";
import { tryMountEngineView } from "./view/engine/mount";
import type { View } from "./view/view";
import { TOWN_START_MPP } from "./view/scale";
import { attachArticleMarkers } from "./view/layers/articleMarkers";
import { attachBadges } from "./view/layers/badges";
import { attachBuildingPick } from "./view/layers/buildings";
import { attachServiceReach } from "./view/layers/reach";
import { attachSitePick } from "./view/layers/ruins";
import { attachClearingPick } from "./view/layers/land";
import { App } from "./ui/App";
import { followResidentById } from "./ui/follow";
import { lang } from "./i18n";
import { LANDMARK_LABELS } from "./ui/semanticModel";

document.documentElement.lang = lang;
document.getElementById("map")!.setAttribute("aria-label", LANDMARK_LABELS.map);
document.getElementById("ui")!.setAttribute("aria-label", LANDMARK_LABELS.interface);

// In dev the URL hash keeps the camera across reloads; it wins over the saved city.
// Read it before creating the map, which writes its own hash on construction.
const hasHash = import.meta.env.DEV && location.hash.length > 1;
// The portal's own pauses (its ads and overlays) stop the clock and the sound, then give back the speed the player had.
let speedBeforePause: Speed | null = null;
platform.listen({
  pause() {
    if (speedBeforePause === null) {
      speedBeforePause = speed.peek();
      setSpeed(0);
    }
    soundPaused.value = true;
  },
  resume() {
    if (speedBeforePause !== null) {
      setSpeed(speedBeforePause);
      speedBeforePause = null;
    }
    soundPaused.value = false;
  },
});
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
// The map: the own WebGPU engine (src/view/engine). Without WebGPU it shows why instead, and the game does not start.
const engineMount = await tryMountEngineView({
  container: "map",
  light: { ...sunLight, lng: computed(() => city.value?.lng ?? 0) },
  weather: weatherNow,
  cloudSite,
  debug3dModels: import.meta.env.DEV && localStorage.getItem("debug3dModels") === "1",
  life: { trips: lifeTrips, rests: lifeRests, lights: lifeLights, gameMinutes: gameClock, gameMinPerSec, frame, onWalker: followResidentById },
});
if (engineMount) start(engineMount.view);
// Without the engine the page explains why; the portal still has to drop its loader to show that.
else platform.ready();

function start(view: View): void {
  // Picking what is on the map: clearings and old buildings first, so a building under the same click wins.
  attachClearingPick(view);
  attachSitePick(view);
  attachBuildingPick(view);
  attachBadges(view); // HTML badges above the buildings that need a look
  attachArticleMarkers(view); // the notebook's Wikipedia entries where they belong
  attachServiceReach(); // what a service reaches, and its coverage overlay while one is selected
  attachRoadTool(view);
  attachLandTool(view);
  attachPlaceTool(view);
  attachStrokeTool(view);
  if (import.meta.env.DEV) attachRevealTool(view); // admin-only; production has no admin panel
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
  effect(() => {
    if (loaded.value) platform.ready();
  });
  // The clock running is what the portal counts as play: a paused town (by the player or the portal) is not.
  const playing = computed(() => loaded.value && speed.value > 0);
  effect(() => platform.gameplay(playing.value));

  // Handles for poking at the map and the sim from devtools during development. Use these instead of importing
  // simClient again: a second module instance would start a second worker writing the same save.
  if (import.meta.env.DEV) {
    Object.assign(window, { simClient, __engine: engineMount });
  }
}
