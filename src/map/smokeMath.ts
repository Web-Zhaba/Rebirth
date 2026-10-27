import { precipDensity } from "./weatherMath";

// Which chimneys smoke and how hard (PLAN-3d-world.ru.md stage 7). Pure maths, no three.js: smokeLayer.ts draws it.
//
// A chimney smokes when its building is finished and in use (the model layer's items carry `lamp` only for houses with
// a household and workplaces with a worker: src/sim/life.ts lights). A house burns wood with the cold (strong below
// COLD, none from WARM) and cooks in the morning and the evening whatever the weather; a tavern cooks more and keeps its
// fire in the evening; a workshop with a furnace smokes through the working day at any temperature. Rain dims it.

export type SmokeKind = "home" | "furnace" | "tavern";

export const COLD = 5; // °C: heating at full below
export const WARM = 18; // °C: no heating from here
const FURNACE = new Set(["smithy", "pottery", "bakery"]); // town templates with a furnace or kiln

const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));
const smooth = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

// What a chimney of the model layer's emitter list is: null when it does not smoke at all (empty, ruined, a road).
export function smokeKindOf(e: { kind: string; style: string; lamp?: string }): SmokeKind | null {
  if (!e.lamp || e.style === "road") return null;
  if (e.style === "town" && FURNACE.has(e.kind)) return e.lamp === "work" ? "furnace" : null;
  if (e.lamp === "tavern" || (e.style === "town" && e.kind === "tavern")) return "tavern";
  return "home";
}

// Share of a window of the day around `c`, half-width `w`, with soft edges.
const around = (hour: number, c: number, w: number) => 1 - smooth(w * 0.5, w, Math.abs(hour - c));

// Wood burnt against the cold: 1 at COLD and below, 0 from WARM.
export const heating = (temp: number): number => 1 - smooth(COLD, WARM, temp);
// Cooking: the morning meal (about 6-9) and the evening one (about 17-21).
export const cooking = (hour: number): number => 0.45 * Math.max(around(hour, 7.5, 1.5), around(hour, 19, 2));
// Fires are banked at night.
const banked = (hour: number): number => 1 - 0.45 * (hour >= 12 ? smooth(22, 23.5, hour) : 1 - smooth(4.5, 6, hour));

// 0..1: how strongly a chimney of this kind smokes at this outdoor temperature (°C), hour of the day (0..24) and rain (mm/h).
export function smokeStrength(kind: SmokeKind, temp: number, hour: number, precip = 0): number {
  const home = Math.min(1, heating(temp) * banked(hour) + cooking(hour));
  let s: number;
  if (kind === "furnace") s = Math.max(0.85 * smooth(6.5, 7.5, hour) * (1 - smooth(18.5, 19.5, hour)), 0.6 * home);
  else if (kind === "tavern") s = Math.min(1, home + 0.3 * cooking(hour) + 0.35 * smooth(16, 18, hour) * (1 - smooth(22.5, 24, hour)));
  else s = home;
  s *= 1 - 0.35 * precipDensity(precip);
  return s < 0.03 ? 0 : s;
}
