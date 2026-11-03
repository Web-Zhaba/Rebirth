import type { CameraControl } from "../../engine/camera/cameraControl";
import type { Engine } from "../../engine/engine";
import { L } from "../../i18n";

// The map's own controls on the engine, in the place and look of the old navigation control: zoom in and out about
// the target, and a compass that turns with the map and turns it back to north. Plus the credits, folded behind an
// «i» on a narrow screen like the old compact attribution.

const ZOOM_STEP = 2; // distance factor per press: one zoom level
const EASE_MS = 300;

const PLUS = `<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 4v12M4 10h12" stroke="currentColor" stroke-width="2"/></svg>`;
const MINUS = `<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 10h12" stroke="currentColor" stroke-width="2"/></svg>`;
const NEEDLE = `<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 2l4 8h-8z" fill="#c8553d"/><path d="M10 18l-4-8h8z" fill="currentColor"/></svg>`;

export function attachControls(engine: Engine, camera: CameraControl, container: HTMLElement): void {
  const group = document.createElement("div");
  group.className = "engine-nav";
  const button = (label: string, icon: string, act: () => void) => {
    const b = document.createElement("button");
    b.type = "button";
    b.title = label;
    b.setAttribute("aria-label", label);
    b.innerHTML = icon;
    b.addEventListener("click", act);
    group.append(b);
    return b;
  };
  button(L("Приблизить", "Zoom in"), PLUS, () => camera.flyTo({ distance: engine.state.distance / ZOOM_STEP }, { duration: EASE_MS }));
  button(L("Отдалить", "Zoom out"), MINUS, () => camera.flyTo({ distance: engine.state.distance * ZOOM_STEP }, { duration: EASE_MS }));
  const compass = button(L("Повернуть на север", "Face north"), NEEDLE, () => camera.flyTo({ heading: 0 }, { duration: EASE_MS }));
  const needle = compass.firstElementChild as SVGElement;
  let shown = NaN;
  engine.onBeforeFrame(() => {
    const h = engine.state.heading;
    if (h === shown) return;
    shown = h;
    needle.style.transform = `rotate(${-h}deg)`;
  });
  container.append(group);
}

// Credits for the data on the map. Open on a wide screen; on a phone folded behind the «i».
export function credits(): HTMLElement {
  const el = document.createElement("details");
  el.className = "engine-attrib";
  el.open = !matchMedia("(max-width: 640px)").matches;
  el.innerHTML =
    `<summary aria-label="${L("Источники данных карты", "Map data sources")}">i</summary>` +
    `<span>${L("Рельеф", "Terrain")}: <a href="https://registry.opendata.aws/terrain-tiles/" target="_blank" rel="noopener">Mapzen Terrarium, AWS Open Data</a> | ` +
    `<a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a> ` +
    `<a href="https://www.openmaptiles.org/" target="_blank" rel="noopener">&copy; OpenMapTiles</a> ` +
    `<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">&copy; ${L("участники OpenStreetMap", "OpenStreetMap contributors")}</a></span>`;
  return el;
}
