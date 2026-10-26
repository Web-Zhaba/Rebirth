import "./style.css";
import { render, h } from "preact";
import { computed, effect } from "@preact/signals";
import type { RestoredItem } from "./map/restoredLayer";
import { createMap } from "./map/mapView";
import { attachArticles } from "./map/articles";
import { attachBadgeLayer } from "./map/badgeLayer";
import { attachBuildingLayer } from "./map/buildingLayer";
import { attachCityMarker } from "./map/cityLayer";
import { attachExcavation, oldWorld } from "./map/excavation";
import { attachPlaceLabels } from "./map/placeLabels";
import { attachPlaceTool } from "./map/placeTool";
import { attachRevealTool } from "./map/revealTool";
import { attachReachLayer } from "./map/reachLayer";
import { attachRoadLayer } from "./map/roadLayer";
import { attachRuinsLayer } from "./map/ruinsLayer";
import { attachRoadTool } from "./map/roadTool";
import { attachLifeLayer } from "./map/lifeLayer";
import { attachClouds } from "./map/clouds/attach";
import { attachNightTint } from "./map/nightLayer";
import { attachPrecipitation } from "./map/precipLayer";
import { attachTrafficLayer } from "./map/trafficLayer";
import { attachWeatherLayer } from "./map/weatherLayer";
import { attachZoneLayer } from "./map/zoneLayer";
import { attachZoneTool } from "./map/zoneTool";
import * as simClient from "./simClient";
import { city, frame, state, gameClock, gameMinPerSec, lifeLights, lifeTrips, load } from "./simClient";
import { App } from "./ui/App";

// In dev the URL hash keeps the camera across reloads; it wins over the saved city.
// Read it before creating the map, which writes its own hash on construction.
const hasHash = import.meta.env.DEV && location.hash.length > 1;
const map = createMap("map");
attachPlaceLabels(map);
attachZoneLayer(map); // zones beneath everything else we add
attachRuinsLayer(map, oldWorld, frame); // old foundations and streets, beneath the roads
attachExcavation();
attachArticles();
attachRoadLayer(map); // before the city marker so roads draw beneath it
attachBuildingLayer(map);
// Dev check of the restored-buildings layer (PLAN-research T1): finished buildings again as three.js models. localStorage debug3dRestored = "1".
const sunLight = { clock: gameClock, phase: computed(() => state.value?.weather?.site?.phase ?? null) };
const debug3d = import.meta.env.DEV && localStorage.getItem("debug3dRestored") === "1";
if (debug3d) void import("./map/restoredLayer").then((m) => m.attachRestoredDebug(map, { buildings: simClient.buildings, frame, light: sunLight }));
// Restored old buildings (typed foundations) as three.js models; the layer (and three.js) loads with the first one.
let lastRestored: RestoredItem[] = [];
const restoredSig = (l: RestoredItem[]): string => l.map((i) => `${i.id}|${i.kind}|${i.height}|${Math.floor(i.progress * 24)}|${i.progress >= 1}`).join(";");
const restoredItems = computed<RestoredItem[]>(() => {
  const st = state.value;
  const out: RestoredItem[] = [];
  if (!st) return lastRestored;
  for (const b of Object.values(st.buildings)) {
    if (!b.siteId) continue;
    const site = st.finds.foundations.find((f) => f.id === b.siteId);
    out.push({ id: b.id, ring: b.footprint, height: b.height, kind: site?.cls ?? "", progress: b.state === "active" ? 1 : b.labor > 0 ? Math.min(1, b.done / b.labor) : 0 });
  }
  // The same list while nothing visible changed, so the layer does not rebuild its meshes every tick.
  if (restoredSig(out) !== restoredSig(lastRestored)) lastRestored = out;
  return lastRestored;
});
if (!debug3d) {
  let loading = false;
  const stopWatch = effect(() => {
    if (loading || !restoredItems.value.length) return;
    loading = true;
    void import("./map/restoredLayer").then((m) => m.attachRestoredLayer(map, { items: restoredItems, frame, light: sunLight }));
    queueMicrotask(() => stopWatch());
  });
}
attachBadgeLayer(map); // HTML badges above the buildings
attachTrafficLayer(map);
attachLifeLayer(map, { trips: lifeTrips, gameMinutes: gameClock, lights: lifeLights, frame, gameMinPerSec });
attachNightTint(map, gameClock); // dusk tint of the map itself; sits just under the lights
attachReachLayer(map);
attachCityMarker(map);
const cloudSite = computed(() => {
  const w = state.value?.weather?.site;
  return w ? { seed: w.seed, phase: w.phase } : null;
});
const weatherNow = computed(() => state.value?.weather ?? null);
// Clouds above everything on the map, visible only on the far globe views; their ground shadows at every zoom, just
// under the night tint (so the lights stay bright).
attachClouds(map, {
  clock: gameClock,
  site: cloudSite,
  extraLayers: [{ beforeId: "night-tint", load: async () => (await import("./map/clouds/cloudShadows")).createShadowLayer(map, { clock: gameClock, site: cloudSite }) }],
});
attachWeatherLayer(map, { weather: weatherNow, clock: gameClock });
attachPrecipitation(map, { weather: weatherNow });
attachRoadTool(map);
attachZoneTool(map);
attachPlaceTool(map);
attachRevealTool(map);
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
