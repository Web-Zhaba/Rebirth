import { smoothstep } from "../../map/clouds/cloudQuality";
import type { WeatherState } from "../../sim/weather";
import { TOWN_FAR_M, TOWN_NEAR_M } from "../../engine/sky/weather";

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
export interface TownWeather {
  snowpack: number; // m
  ice: number;
  precip: number; // mm/h
  snowing: boolean;
  wind: number; // m/s
  soil: number;
}

export function townWeather(w: WeatherState | null | undefined, o: WeatherOverride): TownWeather | null {
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

const LAPSE = 0.0065; // °C per m

// Share of the town's own weather at a distance (m) from its origin (sky/weather.wgsl groundWeather mirrors it).
export const townShare = (dist: number): number => 1 - smoothstep(TOWN_NEAR_M, TOWN_FAR_M, dist);

// A texel of the weather cube (map/clouds/weatherCube.ts): cover, precipitation share of precipMax, sea-level
// climate mean temperature (°C) of the season.
export interface CubeWeather {
  cover: number;
  precip: number; // 0..1
  temp: number;
}

// Weather on the ground away from the town, from the cube alone: snow 0..1 where the season's mean at this height is
// below freezing (the snow cover follows the climate, not a snowpack), wet ground under rain, ice on water in the
// cold. precipMax turns the share back into mm/h.
export function climateGround(c: CubeWeather, altM: number, precipMax: number): { snow: number; wet: number; ice: number; precip: number; snowing: boolean } {
  const t = c.temp - LAPSE * altM;
  const falling = smoothstep(0.03, 0.4, c.precip);
  return {
    snow: 1 - smoothstep(-6, 1, t),
    wet: falling * smoothstep(0, 2, t),
    ice: 1 - smoothstep(-10, -2, t),
    precip: c.precip * precipMax,
    snowing: t < 0.5,
  };
}
