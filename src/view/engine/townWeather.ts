import { smoothstep } from "../../map/clouds/cloudQuality";
import type { WeatherState } from "../../sim/weather";

// The town's weather as the engine draws it (view/engine/weather.ts): pure, so tests need no worker or GPU.

// DEV: parts of the town's weather forced for visual checks (window.engineWeather).
export interface WeatherOverride {
  snowpack?: number; // m
  ice?: number;
  precip?: number; // mm/h
  snowing?: boolean;
  wind?: number; // m/s
}

// The town's weather now, with the DEV override on top.
export function townWeather(w: WeatherState | null | undefined, o: WeatherOverride): { snowpack: number; ice: number; precip: number; snowing: boolean; wind: number; soil: number } | null {
  if (!w && !Object.keys(o).length) return null;
  return {
    snowpack: o.snowpack ?? w?.snowpack ?? 0,
    ice: o.ice ?? w?.ice ?? 0,
    precip: o.precip ?? w?.now.precip ?? 0,
    snowing: o.snowing ?? w?.now.snow ?? false,
    wind: o.wind ?? w?.now.wind ?? 2,
    soil: w?.soil ?? 0,
  };
}

// Wet ground: while rain falls, and a little after while the soil is soaked.
export function wetness(precip: number, snowing: boolean, soil: number): number {
  const rain = snowing ? 0 : smoothstep(0.05, 1.5, precip);
  return Math.max(rain, 0.5 * smoothstep(0.7, 1, soil));
}
