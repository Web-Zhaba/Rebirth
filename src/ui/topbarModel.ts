import { cutOffEdges } from "../sim/roads";
import type { EconomyStats, RoadGraph } from "../sim/types";

// Pure helpers behind the top bar: number formats, the day phase, daily deltas and warnings.

// Tons with one decimal, comma as the separator: 1600 -> "1,6", 33000 -> "33".
export const tons = (kg: number) => (Math.round(kg / 100) / 10).toString().replace(".", ",");
export const amount = (v: number) => (v >= 100 ? Math.round(v) : Math.round(v * 10) / 10).toString().replace(".", ",");
export const pad = (n: number) => String(n).padStart(2, "0");

export const LOW_FOOD_DAYS = 30;

export type DayPhase = "morning" | "day" | "evening" | "night";
export const PHASE_LABEL: Record<DayPhase, string> = { morning: "утро", day: "день", evening: "вечер", night: "ночь" };

// Night matches clock.ts isNight (22:00-05:00); morning to 11:00, day to 17:00, evening to 22:00.
export function dayPhase(hour: number): DayPhase {
  if (hour >= 22 || hour < 5) return "night";
  if (hour < 11) return "morning";
  if (hour < 17) return "day";
  return "evening";
}

// A per-day change as signed text: "+24/дн", "−3/дн" (true minus sign); null when it rounds to nothing.
export function perDay(v: number, unit = ""): string | null {
  const a = amount(Math.abs(v));
  if (a === "0") return null;
  return `${v > 0 ? "+" : "−"}${a}${unit ? ` ${unit}` : ""}/дн`;
}

export const deltaDir = (v: number): "up" | "down" | "" => (amount(Math.abs(v)) === "0" ? "" : v > 0 ? "up" : "down");

// Food, kg a day: yesterday's production and foraging minus what the town eats. The harvest lands in one day, so
// autumn spikes; that is what the sim reports.
export const foodNet = (eco: EconomyStats): number => eco.yesterday.food + eco.forage - eco.foodPerDay;

export interface Warning {
  id: string;
  text: string;
}

// Problems worth a line in the bar. Always text next to an icon, never colour alone.
export function warnings(args: { food: number; eco: EconomyStats; builders: number; queue: number; logs: number; building: number }): Warning[] {
  const { food, eco, builders, queue, logs, building } = args;
  const out: Warning[] = [];
  if (eco.foodPerDay > 0 && food < eco.foodPerDay) out.push({ id: "famine", text: "Голод: провизия закончилась" });
  else if (eco.foodPerDay > 0 && eco.foodDays < LOW_FOOD_DAYS) out.push({ id: "lowfood", text: `Провизии на ${Math.floor(eco.foodDays)} дн.` });
  else if (eco.foodPerDay > 0 && eco.outlook < 1) out.push({ id: "outlook", text: "Запасов на год не хватит" });
  if (queue > 0 && builders === 0) out.push({ id: "nohands", text: "Некому строить" });
  if (building > 0 && logs < 0.05) out.push({ id: "nologs", text: "Не хватает брёвен" });
  return out;
}

// Unfinished, reachable road edges: how many and the labor (person-hours) left on them.
export function roadQueue(g: RoadGraph | null | undefined): { cut: Set<number>; queue: number; remaining: number } {
  const cut = g ? cutOffEdges(g) : new Set<number>();
  let queue = 0;
  let remaining = 0;
  if (g) {
    for (const e of Object.values(g.edges)) {
      if (e.done < e.labor && !cut.has(e.id)) {
        queue++;
        remaining += e.labor - e.done;
      }
    }
  }
  return { cut, queue, remaining };
}
