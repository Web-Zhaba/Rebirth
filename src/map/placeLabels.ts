import type * as maplibregl from "maplibre-gl";
import { effect } from "@preact/signals";
import { placeLabelsOn } from "../view/placeNames";
import { PLACE_LABELS_LAYER } from "./style";

// MapLibre draws the names as a symbol layer of the style (style.ts); this only follows the switch.
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