import { createCameraControl } from "../../engine/camera/controller";
import { Engine } from "../../engine/engine";
import { WebGpuUnavailable } from "../../engine/gpu/device";
import type { CameraControl } from "../../engine/camera/cameraControl";
import type { ReadonlySignal } from "@preact/signals";
import { defaultLight, SUN_INTENSITY } from "../../engine/engine";
import { sunDirection } from "../../sim/weather";
import type { View } from "../view";
import type { WeatherState } from "../../sim/weather";
import { attachToolContext } from "./context";
import { attachGameLabels } from "./gameLabels";
import { attachGameLayers } from "./gameLayers";
import { attachFields } from "./fields";
import { attachForest } from "./forest";
import { attachLife, type LifeOptions } from "./life";
import { attachModels } from "./models";
import { attachPlaceLabels } from "./placeLabels";
import { attachStatsHud } from "./statsHud";
import { attachSmoke } from "./smoke";
import { attachWater } from "./water";
import { attachWeather } from "./weather";
import type { CloudSite } from "../../map/clouds/settings";
import { attachControls, credits } from "./controls";
import { createEngineView } from "./view";
import { mppAtZoom, zoomAtMpp } from "../view";

export interface EngineMountOptions {
  container: string; // element id
  // The sun of the game clock (the map's clock: another season's while the admin panel previews one). Before a town
  // exists there is no climate phase and the engine keeps its fixed mid-morning sun.
  light?: { clock: ReadonlySignal<number>; phase: ReadonlySignal<number | null>; lng: ReadonlySignal<number> };
  weather?: ReadonlySignal<WeatherState | null>; // the town's weather: snow, wet ground, ice, rain, smoke
  cloudSite?: ReadonlySignal<CloudSite | null>; // the weather site the clouds are drawn for (seed and phase)
  debug3dModels?: boolean;
  life?: LifeOptions; // walkers, carts and the evening glows
}

export interface EngineMount {
  view: View;
  engine: Engine;
  camera: CameraControl;
}

// Builds the engine in a full-size canvas inside the container and returns the View the game talks to. Rejects when
// WebGPU is not available (WebGpuUnavailable); the canvas is removed again then.
export async function mountEngineView(o: EngineMountOptions): Promise<EngineMount> {
  const container = document.getElementById(o.container)!;
  if (getComputedStyle(container).position === "static") container.style.position = "relative";
  const canvas = document.createElement("canvas");
  canvas.style.cssText = "position:absolute;inset:0;width:100%;height:100%;display:block;outline:none";
  container.prepend(canvas);
  let engine: Engine;
  try {
    engine = await Engine.create(canvas);
  } catch (e) {
    canvas.remove();
    throw e;
  }
  const light = o.light;
  if (light)
    engine.light = (s) => {
      const phase = light.phase.peek();
      if (phase === null) return defaultLight(s);
      // sim/weather's sun vector is in ECEF axes (x to 0°E 0°N, y to 90°E, z north) with noon over Greenwich. The game
      // clock is the town's own time (night and day follow sim/clock.ts daylight by its hour), so the sun is turned to
      // stand over the town's meridian at the clock's noon.
      const [x, y, z] = sunDirection(light.clock.peek(), phase);
      const a = (light.lng.peek() * Math.PI) / 180;
      return { sun: [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a), z], intensity: SUN_INTENSITY };
    };
  const camera = createCameraControl(engine);
  const view = createEngineView(engine, camera, container);
  if (import.meta.env.DEV) keepCameraInHash(engine, view, camera);
  const town = attachModels(engine, { light: o.light, debug: o.debug3dModels });
  if (o.life) attachLife(engine, view, town, o.life);
  attachGameLayers(engine);
  attachToolContext(engine);
  const weather = o.light && o.cloudSite ? attachWeather(engine, { clock: o.light.clock, site: o.cloudSite, weather: o.weather }) : null;
  attachFields(engine, { clock: o.light?.clock });
  attachWater(engine, { clock: o.light?.clock, weather: o.weather, rain: weather?.rain });
  const forest = attachForest(engine, { clock: o.light?.clock, weather: o.weather, snow: weather?.snowOnTrees });
  attachSmoke(engine, { clock: o.light?.clock, weather: o.weather });
  attachPlaceLabels(engine, container);
  attachGameLabels(engine, container);
  attachControls(engine, camera, container);
  container.append(credits());
  attachStatsHud(engine, container, forest);
  engine.start();
  return { view, engine, camera };
}

// DEV: the camera in the URL hash (#zoom/lat/lng/heading/pitch, the old map's format), so a reload keeps the view.
function keepCameraInHash(engine: Engine, view: View, camera: CameraControl): void {
  const [zoom, lat, lng, heading, pitch] = location.hash.slice(1).split("/").map(Number);
  if ([zoom, lat, lng].every(Number.isFinite)) view.jumpTo({ center: [lng, lat], mpp: mppAtZoom(zoom), heading: heading || 0, pitch: pitch || 0 });
  camera.on("moveend", () => {
    const s = engine.state;
    const zoomNow = zoomAtMpp(engine.metersPerPixel());
    history.replaceState(history.state, "", `#${zoomNow.toFixed(2)}/${s.lat.toFixed(5)}/${s.lng.toFixed(5)}/${s.heading.toFixed(1)}/${s.pitch.toFixed(0)}`);
  });
}

// The engine's view, or null when it cannot start: then a screen in place of the game says why (the game needs WebGPU,
// docs/PLAN-engine.md 3.1) and the error goes to the log.
export async function tryMountEngineView(o: EngineMountOptions): Promise<EngineMount | null> {
  try {
    return await mountEngineView(o);
  } catch (e) {
    console.error("[engine] cannot start:", e);
    const box = document.createElement("div");
    box.setAttribute("role", "alert");
    box.className = "engine-unsupported";
    const title = document.createElement("h1");
    const text = document.createElement("p");
    if (e instanceof WebGpuUnavailable) {
      title.textContent = "Браузер не поддерживает WebGPU";
      text.textContent = "Карта игры рисуется через WebGPU. Откройте игру в свежем Chrome, Edge или Safari.";
    } else {
      title.textContent = "Не удалось запустить карту";
      text.textContent = "Видеокарта не смогла запустить карту игры. Обновите браузер или драйвер видеокарты и перезагрузите страницу.";
    }
    box.append(title, text);
    document.body.append(box);
    return null;
  }
}
