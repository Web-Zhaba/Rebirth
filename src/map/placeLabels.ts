import type * as maplibregl from "maplibre-gl";
import { computed, effect, signal } from "@preact/signals";
import { city } from "../simClient";
import { PLACE_LABELS_LAYER } from "./style";

// Old place names on the map. Without a choice of the player's they help find a spot before founding and stay
// off afterwards, so the town grows on an empty Earth; the player's choice is kept in localStorage.
const STORE_KEY = "rebirth.placeLabels";

function readPref(): boolean | null {
  try {
    const v = localStorage.getItem(STORE_KEY);
    return v === null ? null : v === "1";
  } catch {
    return null;
  }
}

const pref = signal<boolean | null>(readPref());
export const placeLabelsOn = computed(() => pref.value ?? city.value === null);

export function togglePlaceLabels(): void {
  const next = !placeLabelsOn.value;
  pref.value = next;
  try {
    localStorage.setItem(STORE_KEY, next ? "1" : "0");
  } catch {
    /* ignore */
  }
}

export function attachPlaceLabels(map: maplibregl.Map): void {
  let lastVisibility: string | null = null;

  const update = () => {
    if (!map.getLayer(PLACE_LABELS_LAYER)) return;
    const want = placeLabelsOn.value ? "visible" : "none";
    // Предотвращаем холостую инвалидацию раскладки карты
    if (want !== lastVisibility) {
      lastVisibility = want;
      map.setLayoutProperty(PLACE_LABELS_LAYER, "visibility", want);
    }
  };

  const setup = () => {
    effect(update);
    map.on("styledata", update);
  };

  if (map.isStyleLoaded()) setup();
  else map.once("load", setup);
}