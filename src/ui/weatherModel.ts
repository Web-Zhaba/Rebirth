import type { EconomyStats } from "../sim/types";
import type { WeatherState } from "../sim/weather";
import { buildFactor, EFFECTS, fieldWork, foodNeedFactor, workFactor } from "../sim/weatherEffects";
import type { IconName } from "./icons";

// Pure helpers behind the weather chip of the top bar: the condition word, the icon, the tooltip lines and what the
// weather costs the town today. The factor functions come from the simulation, so the words always match the numbers.

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
  effects: EffectLine[]; // what the weather costs the town today
  impact: EffectTone | null; // set when the chip should warn before the tooltip is opened
}

// Everything the chip shows; null while there is no site (calm default), so the chip is hidden.
export function weatherChip(ws: WeatherState | null | undefined, season: number, eco?: EconomyStats | null): WeatherChip | null {
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
  return {
    cond,
    icon: CONDITION_ICON[cond],
    temp: tempText(w.temp),
    word: CONDITION_WORD[cond],
    rows,
    notes,
    effects: effectLines(ws, eco),
    impact: weatherImpact(ws, eco),
  };
}

// ---- What the weather costs today ----

export type EffectTone = "bad" | "warn" | "ok";

export interface EffectLine {
  key: string;
  label: string;
  value: string;
  tone: EffectTone;
}

const pctText = (v: number) => `${Math.round(v * 100)} %`;
const toneOf = (factor: number): EffectTone => (factor >= 0.85 ? "ok" : factor >= 0.5 ? "warn" : "bad");
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// The strongest condition that is holding the town back right now, in one phrase; null on a mild clear day.
// Order matters: a frozen field is the reason even if it is also snowing.
export function weatherReason(ws: WeatherState | null | undefined): string | null {
  if (!ws || !ws.site) return null;
  const w = ws.now;
  if (ws.snowpack > EFFECTS.groundSnow) return "снег на земле";
  if (ws.frozen > 0.5) return "земля промёрзла";
  if (ws.ice > EFFECTS.fisher.iceAbove) return "вода подо льдом";
  if (w.wind > EFFECTS.storm) return "буря";
  if (w.precip >= RAIN_MIN_MM) {
    if (w.snow) return "снегопад";
    return w.precip > EFFECTS.rainHeavy ? "ливень" : "дождь";
  }
  if (ws.soil > EFFECTS.waterlogged) return "распутица";
  if (ws.soil < EFFECTS.drought) return "засуха";
  if (w.temp > EFFECTS.hot) return "жара";
  if (w.temp < EFFECTS.build.coldBelow) return "мороз";
  if (w.temp > 0 && w.temp < 4) return "оттепель";
  return null;
}

// The effect lines of the chip tooltip: the two big factors always, the rest only when they bite.
export function effectLines(ws: WeatherState | null | undefined, eco?: EconomyStats | null): EffectLine[] {
  if (!ws || !ws.site) return [];
  const fw = fieldWork(ws);
  const bf = buildFactor(ws);
  const out: EffectLine[] = [
    { key: "field", label: "Полевые работы", value: pctText(fw), tone: toneOf(fw) },
    { key: "build", label: "Стройка", value: pctText(bf), tone: toneOf(bf) },
  ];
  const food = foodNeedFactor(ws);
  if (food > 1.005) out.push({ key: "food", label: "Расход еды", value: `+${Math.round((food - 1) * 100)} %`, tone: food > 1.15 ? "warn" : "ok" });
  if (eco && eco.firewood > 0.001) out.push({ key: "wood", label: "Дрова", value: `${dec(eco.firewood)} м³ в день`, tone: "ok" });
  if (eco && eco.unheated.people > 0) out.push({ key: "cold", label: "Без дров", value: `${eco.unheated.people} чел.`, tone: "bad" });
  return out;
}

// The tone of the chip itself. Field work is 0 all winter by design, so it only counts while a field window is open.
export function weatherImpact(ws: WeatherState | null | undefined, eco?: EconomyStats | null): EffectTone | null {
  if (!ws || !ws.site) return null;
  if (eco && eco.unheated.people > 0) return "bad";
  const bf = buildFactor(ws);
  if (bf <= 0.4) return "bad";
  if (bf <= 0.7) return "warn";
  if (eco?.fields.window) {
    const fw = fieldWork(ws);
    if (fw <= 0.35) return "bad";
    if (fw <= 0.7) return "warn";
  }
  return null;
}

// One line for the warnings strip: only when the weather really cuts the work or leaves someone without fuel.
export function weatherWarning(ws: WeatherState | null | undefined, eco?: EconomyStats | null): string | null {
  if (!ws || !ws.site) return null;
  if (eco && eco.unheated.people > 0) return `Нет дров: мёрзнут ${eco.unheated.people} чел.`;
  const fw = fieldWork(ws);
  const bf = buildFactor(ws);
  const parts: string[] = [];
  if (eco?.fields.window && fw <= 0.7) parts.push(`полевые работы ${Math.round(fw * 100)} %`);
  if (bf <= 0.7) parts.push(`стройка ${Math.round(bf * 100)} %`);
  if (parts.length === 0) return null;
  const reason = weatherReason(ws);
  return `${reason ? `${cap(reason)}: ` : ""}${parts.join(", ")}`;
}

// A workplace slowed by the weather today, in the words of its panel; null when nothing holds it back.
export function workFactorText(template: string, ws: WeatherState | null | undefined): { pct: number; reason: string | null } | null {
  if (!ws || !ws.site) return null;
  const f = workFactor(template, ws);
  if (f >= 0.995) return null;
  return { pct: Math.round(f * 100), reason: weatherReason(ws) };
}

// A site under construction slowed by the weather today; null when nothing holds it back.
export function buildFactorText(ws: WeatherState | null | undefined): { pct: number; reason: string | null } | null {
  if (!ws || !ws.site) return null;
  const f = buildFactor(ws);
  if (f >= 0.995) return null;
  return { pct: Math.round(f * 100), reason: weatherReason(ws) };
}
