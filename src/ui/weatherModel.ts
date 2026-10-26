import type { WeatherState } from "../sim/weather";
import type { IconName } from "./icons";

// Pure helpers behind the weather chip of the top bar: the condition word, the icon and the tooltip lines.

export type Condition = "clear" | "partly" | "overcast" | "rain" | "downpour" | "snow" | "blizzard" | "hurricane";

export const CONDITION_WORD: Record<Condition, string> = {
  clear: "ясно",
  partly: "переменная облачность",
  overcast: "пасмурно",
  rain: "дождь",
  downpour: "ливень",
  snow: "снег",
  blizzard: "метель",
  hurricane: "ураган",
};

export const CONDITION_ICON: Record<Condition, IconName> = {
  clear: "weatherClear",
  partly: "weatherPartly",
  overcast: "weatherOvercast",
  rain: "weatherRain",
  downpour: "weatherDownpour",
  snow: "weatherSnow",
  blizzard: "weatherBlizzard",
  hurricane: "weatherHurricane",
};

export const HURRICANE_WIND = 20; // m/s
export const BLIZZARD_WIND = 12; // m/s
export const DOWNPOUR_MM = 3; // mm/h
export const RAIN_MIN_MM = 0.1; // below this the sky counts as dry
export const OVERCAST_FROM = 0.65;
export const PARTLY_FROM = 0.3;

export function condition(w: { cloud: number; precip: number; snow: boolean; wind: number }): Condition {
  if (w.wind > HURRICANE_WIND) return "hurricane";
  if (w.precip >= RAIN_MIN_MM) {
    if (w.snow) return w.wind > BLIZZARD_WIND ? "blizzard" : "snow";
    return w.precip > DOWNPOUR_MM ? "downpour" : "rain";
  }
  if (w.cloud >= OVERCAST_FROM) return "overcast";
  if (w.cloud >= PARTLY_FROM) return "partly";
  return "clear";
}

const dec = (v: number, digits = 1) => (Math.round(v * 10 ** digits) / 10 ** digits).toString().replace(".", ",");

// Rounded degrees with a true minus sign; no "−0".
export function tempText(t: number): string {
  const r = Math.round(t);
  return `${r < 0 ? "−" : ""}${Math.abs(r)}°C`;
}

// Crop estimate as a percentage of a normal year: only from spring to the end of autumn (season 0..2, as in calendar()),
// winter has nothing to forecast.
export function cropText(crop: number, season: number): string | null {
  if (season > 2 || !Number.isFinite(crop)) return null;
  return `урожай ~${Math.round(crop * 100)} %`;
}

export interface WeatherChip {
  cond: Condition;
  icon: IconName;
  temp: string;
  word: string;
  rows: { label: string; value: string }[];
  notes: string[]; // ground and water states, crop estimate
}

// Everything the chip shows; null while there is no site (calm default), so the chip is hidden.
export function weatherChip(ws: WeatherState | null | undefined, season: number): WeatherChip | null {
  if (!ws || !ws.site) return null;
  const w = ws.now;
  const cond = condition(w);
  const rows = [
    { label: "Ветер", value: `${dec(w.wind, 0)} м/с` },
    { label: "Осадки", value: w.precip >= RAIN_MIN_MM ? `${dec(w.precip)} мм/ч` : "нет" },
    { label: "Влажность почвы", value: `${Math.round(ws.soil * 100)} %` },
  ];
  const cm = Math.round(ws.snowpack * 100);
  if (cm >= 1) rows.push({ label: "Снега", value: `${cm} см` });
  const notes: string[] = [];
  if (ws.frozen >= 0.5) notes.push("Земля промёрзла");
  if (ws.ice >= 0.5) notes.push("Вода покрыта льдом");
  const crop = cropText(ws.crop, season);
  if (crop) notes.push(crop);
  return { cond, icon: CONDITION_ICON[cond], temp: tempText(w.temp), word: CONDITION_WORD[cond], rows, notes };
}
