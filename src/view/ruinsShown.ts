import { signal } from "@preact/signals";

// Whether the old city is drawn: a choice of the player's, kept in localStorage. The finds stay either way.
const SHOW_KEY = "rebirth.ruins";
function readShown(): boolean {
  try {
    return localStorage.getItem(SHOW_KEY) !== "0";
  } catch {
    return true;
  }
}

export const ruinsShown = signal(readShown());
export const ruinsAutoShown = signal(false);

export function toggleRuins(): void {
  ruinsShown.value = !ruinsShown.value;
  try {
    localStorage.setItem(SHOW_KEY, ruinsShown.value ? "1" : "0");
  } catch {
    /* ignore */
  }
}

