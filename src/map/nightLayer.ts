import type maplibregl from "maplibre-gl";
import { effect, type ReadonlySignal } from "@preact/signals";
import { calendar, daylight } from "../sim/clock";
import { mixHex, PALETTE } from "../ui/palette";

const SRC = "night";
const LAYER = "night-tint";
const NIGHT_MAX = 0.45; // opacity of the dusk color at full night
const WARM_MAX = 0.16; // opacity of the amber at dawn and dusk
const BEFORE = "life-lights-house"; // everything under the tint except the lights, walkers and carts

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

  const place = () => {
    const order = map.getLayersOrder();
    const lights = order.indexOf(BEFORE);
    const want = lights >= 0 ? lights - 1 : order.length - 1;
    if (order.indexOf(LAYER) !== want) map.moveLayer(LAYER, lights >= 0 ? BEFORE : undefined);
  };

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
  };

  if (map.isStyleLoaded()) setup();
  else map.once("load", setup);
  return () => {
    stop?.();
    if (ready && map.getLayer(LAYER)) map.removeLayer(LAYER);
  };
}
