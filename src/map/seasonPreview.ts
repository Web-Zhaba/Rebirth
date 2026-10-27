import { computed, signal, type ReadonlySignal } from "@preact/signals";
import { calendar, DAYS_PER_SEASON } from "../sim/clock";
import type { WeatherState } from "../sim/weather";

// Admin panel: the map drawn as in another season (crowns, snow, ice, the sun's height), the game itself untouched —
// only what the map layers read goes through here.

export const SEASON_NAMES = ["Весна", "Лето", "Осень", "Зима"];
export const seasonPreview = signal<number | null>(null); // 0 spring .. 3 winter; null: the game's own

const SEASON_MIN = DAYS_PER_SEASON * 1440;

// The game clock moved forward into the previewed season: the same day of the season and hour.
export function seasonClock(gameMinutes: number, season: number | null): number {
  if (season === null) return gameMinutes;
  return gameMinutes + ((((season - calendar(gameMinutes).season) % 4) + 4) % 4) * SEASON_MIN;
}

// The weather on the ground of the previewed season: a deep snowpack and ice in winter, none in the others; the sky
// (clouds, rain, wind) stays as it is, rain turning to snow in winter.
export function seasonWeather(w: WeatherState | null, season: number | null): WeatherState | null {
  if (!w || season === null) return w;
  const winter = season === 3;
  return {
    ...w,
    snowpack: winter ? 0.4 : 0,
    ice: winter ? 1 : 0,
    frozen: winter ? 1 : 0,
    now: { ...w.now, temp: winter ? Math.min(w.now.temp, -6) : Math.max(w.now.temp, season === 1 ? 18 : 8), snow: winter && w.now.precip > 0 },
  };
}

export const previewClock = (clock: ReadonlySignal<number>): ReadonlySignal<number> => computed(() => seasonClock(clock.value, seasonPreview.value));
export const previewWeather = (w: ReadonlySignal<WeatherState | null>): ReadonlySignal<WeatherState | null> => computed(() => seasonWeather(w.value, seasonPreview.value));
