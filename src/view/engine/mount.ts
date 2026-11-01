import { createCameraControl } from "../../engine/camera/controller";
import { Engine } from "../../engine/engine";
import { WebGpuUnavailable } from "../../engine/gpu/device";
import type { CameraControl } from "../../engine/camera/cameraControl";
import type { ReadonlySignal } from "@preact/signals";
import { defaultLight, SUN_INTENSITY } from "../../engine/engine";
import { sunDirection } from "../../sim/weather";
import type { View } from "../view";
import { createEngineView } from "./view";

export interface EngineMountOptions {
  container: string; // element id
  // The sun of the game clock (the map's clock: another season's while the admin panel previews one). Before a town
  // exists there is no climate phase and the engine keeps its fixed mid-morning sun.
  light?: { clock: ReadonlySignal<number>; phase: ReadonlySignal<number | null> };
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
      // sim/weather's sun vector is already in ECEF axes: x to (0°E, 0°N), y to 90°E, z north.
      return phase === null ? defaultLight(s) : { sun: sunDirection(light.clock.peek(), phase), intensity: SUN_INTENSITY };
    };
  const camera = createCameraControl(engine);
  const view = createEngineView(engine, camera, container);
  container.append(credits());
  engine.start();
  return { view, engine, camera };
}

// Credits for the data the engine shows now (more as content kinds arrive), in the look of the compact attribution.
function credits(): HTMLElement {
  const el = document.createElement("div");
  el.className = "engine-attrib";
  el.innerHTML =
    `Рельеф: <a href="https://registry.opendata.aws/terrain-tiles/" target="_blank" rel="noopener">Mapzen Terrarium, AWS Open Data</a> | ` +
    `<a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a> ` +
    `<a href="https://www.openmaptiles.org/" target="_blank" rel="noopener">&copy; OpenMapTiles</a> ` +
    `<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">&copy; участники OpenStreetMap</a>`;
  return el;
}

// Which renderer to mount: `?engine=next` / `?engine=maplibre` is read once and remembered in localStorage.
export function wantsEngine(): boolean {
  let v: string | null = new URLSearchParams(location.search).get("engine");
  try {
    if (v === "next" || v === "maplibre") localStorage.setItem("engine", v);
    else v = localStorage.getItem("engine");
  } catch {
    // storage blocked: the URL alone decides
  }
  return v === "next";
}

// Engine view, or null (with a message for the player and a log line) when WebGPU is not there.
export async function tryMountEngineView(o: EngineMountOptions): Promise<EngineMount | null> {
  try {
    return await mountEngineView(o);
  } catch (e) {
    console.warn("[engine] falling back to MapLibre:", e);
    const msg = document.createElement("div");
    msg.setAttribute("role", "alert");
    msg.className = "engine-fallback";
    msg.textContent = (e instanceof WebGpuUnavailable ? "WebGPU недоступен в этом браузере" : "Не удалось запустить новый движок карты") + " — включена прежняя карта.";
    document.body.append(msg);
    setTimeout(() => msg.remove(), 8000);
    return null;
  }
}
