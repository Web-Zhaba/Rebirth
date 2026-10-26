import { signal } from "@preact/signals";

// The weather cover on the map (snow, ice, overcast haze, rain and snow particles) is its own layer, independent of
// the clouds toggle. No three.js here: the layer bar and the map layers both import it.
const KEY = "rebirth.weatherMap";

function read(): boolean {
  try {
    return localStorage.getItem(KEY) !== "0";
  } catch {
    return true;
  }
}

export const weatherMapOn = signal(read());

export function toggleWeatherMap(): void {
  weatherMapOn.value = !weatherMapOn.value;
  try {
    localStorage.setItem(KEY, weatherMapOn.value ? "1" : "0");
  } catch {
    /* no storage: the choice lives for the session */
  }
}