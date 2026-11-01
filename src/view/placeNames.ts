import { computed, signal } from "@preact/signals";
import { city } from "../simClient";

// Old place names on the map: whether they show. Without a choice of the player's they help find a spot before founding
// and stay off afterwards, so the town grows on an empty Earth; the player's choice is kept in localStorage. Every
// renderer draws them from this switch (src/map/placeLabels.ts for MapLibre, src/view/engine/placeLabels.ts).
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
