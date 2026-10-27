import type maplibregl from "maplibre-gl";
import { effect, type ReadonlySignal } from "@preact/signals";
import { calendar, daylight } from "../sim/clock";
import { mixHex, PALETTE } from "../ui/palette";
import { keepUnder } from "./relief";

const SRC = "night";
const LAYER = "night-tint";
const NIGHT_MAX = 0.45; // opacity of the dusk color at full night
const WARM_MAX = 0.16; // opacity of the amber at dawn and dusk
// everything under the tint except the lights: the windows of the models (modelLayer.ts), then the glows, walkers, carts
const BEFORE = ["building-lamps", "life-lights-house"];

// Colour and opacity of the map tint at an hour of the day: dusk blue at night, amber while the light changes, none by day.
export function nightTint(hour: number): { color: string; opacity: number } {
  const d = daylight(hour);
  const night = 1 - d;
  const warm = d > 0 && d < 1 ? Math.max(0, 1 - Math.abs(d - 0.5) * 2) : 0; // peaks mid-transition
  return { color: mixHex(PALETTE.dusk, PALETTE.warn, warm), opacity: Math.max(night * NIGHT_MAX, warm * WARM_MAX) };
}

// Night as a map layer: a world-sized fill in the dusk color, kept just below the lights (so windows and the tavern
// glow stay bright) and above terrain, zones, roads and buildings. No translucent surface over the UI.
export function attachNightTint(map: maplibregl.Map, gameMinutes: ReadonlySignal<number>): () => void {
  let ready = false;
  let stop: (() => void) | null = null;

  // on every style change too: layers come later, and the relief setting reorders them (it does nothing in place)
  const place = () => ready && map.getLayer(LAYER) && keepUnder(map, LAYER, BEFORE.find((id) => map.getLayer(id)) ?? BEFORE[1]);

  const setup = () => {
    map.addSource(SRC, {
      type: "geojson",
      data: {
        type: "Feature",
        properties: {},
        geometry: { type: "Polygon", coordinates: [[[-180, -85], [180, -85], [180, 85], [-180, 85], [-180, -85]]] },
      },
    });
    map.addLayer({
      id: LAYER,
      type: "fill",
      source: SRC,
      paint: { "fill-color": PALETTE.dusk, "fill-opacity": 0, "fill-antialias": false },
    });
    ready = true;
    stop = effect(() => {
      const cal = calendar(gameMinutes.value);
      const t = nightTint(cal.hour + cal.minute / 60);
      map.setPaintProperty(LAYER, "fill-color", t.color);
      map.setPaintProperty(LAYER, "fill-opacity", t.opacity);
      place();
    });
    map.on("styledata", place);
  };

  if (map.isStyleLoaded()) setup();
  else map.once("load", setup);
  return () => {
    stop?.();
    map.off("styledata", place);
    if (ready && map.getLayer(LAYER)) map.removeLayer(LAYER);
  };
}
