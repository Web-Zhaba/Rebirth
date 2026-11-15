import type { WeatherState } from "./weather";

// The plain signs of the weather that work depends on: rain, a storm, heat, snow, ice, wet or dry soil, and the field
// work they leave. A leaf module: the buildings' rules (src/buildings/*/rules.ts) read it for their own weather without
// an import cycle; sim/weatherEffects.ts adds the rest (fuel, spoilage, mood) on top.

export const SIGNS = {
  rainLight: 0.2, // mm/h, above this it rains
  rainHeavy: 1, // mm/h
  storm: 13, // m/s
  hot: 33, // °C
  waterlogged: 0.95, // soil moisture
  drought: 0.25, // soil moisture
  deepSnow: 0.3, // m of snow that stops quarries and slows logging
  groundSnow: 0.05, // m of snow that stops the plough
  iceAbove: 0.5, // share of ice cover from which the water counts as frozen
};

export const rainy = (w: WeatherState) => !w.now.snow && w.now.precip > SIGNS.rainLight;
export const heavy = (w: WeatherState) => !w.now.snow && w.now.precip > SIGNS.rainHeavy;
export const stormy = (w: WeatherState) => w.now.wind > SIGNS.storm;

const FIELD_WORK = { heavy: 0.2, light: 0.6, storm: 0.7, hot: 0.8, mud: 0.5 };

// Share of the field work done (farm hours): 0 on frozen or snowy ground.
export function fieldWork(w: WeatherState): number {
  if (!w.site) return 1;
  const F = FIELD_WORK;
  if (w.snowpack > SIGNS.groundSnow || w.frozen > 0.5) return 0;
  let f = 1;
  if (heavy(w)) f *= F.heavy;
  else if (rainy(w)) f *= F.light;
  if (stormy(w)) f *= F.storm;
  if (w.now.temp > SIGNS.hot) f *= F.hot;
  if (w.soil > SIGNS.waterlogged) f *= F.mud;
  return f;
}
