import { BUILDINGS, CREW, remainingLabor } from "../sim/buildings";
import type { Building, BuildingQuery, Clearing, Stock } from "../sim/types";
import { clearingLogs } from "../sim/clearing";
import type { IconName } from "./icons";

// Pure helpers behind the inspector: the status chip, icons and clearing numbers.

export type ChipTone = "ok" | "warn" | "bad" | "build";
export interface Chip {
  label: string;
  tone: ChipTone;
}

// Which workplace has no workers, no input, and so on, from the data the worker returns.
export function buildingStatus(b: Building, info: BuildingQuery | null, shortfall: boolean): Chip {
  if (b.state === "planned") return shortfall ? { label: "ждёт материалов", tone: "warn" } : { label: "в очереди", tone: "build" };
  if (b.state === "building") return { label: "строится", tone: "build" };
  if (b.upgrade) return { label: "перестраивается", tone: "build" };
  if (info?.kind === "workplace") {
    if (info.production?.missing) return { label: "нет сырья", tone: "bad" };
    if (info.capacity > 0 && info.workers.length === 0) return { label: "нет работников", tone: "bad" };
    if (info.service && !info.service.working) return { label: "нет работников", tone: "bad" };
  }
  if (info?.kind === "house" && info.households.length === 0) return { label: "пустует", tone: "warn" };
  if (info?.kind === "house") return { label: "заселён", tone: "ok" };
  return { label: b.template === "dig" ? "раскоп готов" : "работает", tone: "ok" };
}

const CRAFT = new Set(["smithy", "carpentry", "pottery"]);
const TRADE = new Set(["shop", "tavern"]);

// Icon of a building template: houses and zone buildings share their zone's icon, placed ones have their own.
export function templateIcon(template: string): IconName {
  if (BUILDINGS[template]?.zone === "res") return "res";
  if (CRAFT.has(template)) return "craft";
  if (TRADE.has(template)) return "trade";
  return template in BUILDINGS ? (template as IconName) : "res";
}

// What a workplace makes, in the nominative, with the icon of the good.
export const OUTPUT: Record<keyof Stock, { name: string; unit: string; icon: IconName }> = {
  food: { name: "провизия", unit: "кг", icon: "food" },
  logs: { name: "брёвна", unit: "м³", icon: "log" },
  planks: { name: "доски", unit: "м³", icon: "planks" },
  stone: { name: "камень", unit: "т", icon: "stone" },
  wares: { name: "утварь", unit: "шт", icon: "wares" },
};

// Hands one site can use at once (a толока lifts the limit).
export const siteHands = (artel: number, toloka: boolean): number => (toloka ? artel : Math.min(artel, CREW));

// Person-hours still to spend on a building, 0 when finished.
export const buildingRemaining = (b: Building): number => remainingLabor(b);

export interface ClearingView {
  share: number; // 0..1 of the labor done
  logsNow: number; // m3 felled so far
  logsAll: number; // m3 in total
  remaining: number; // person-hours
}

export function clearingView(c: Clearing): ClearingView {
  const share = c.labor > 0 ? Math.min(1, c.done / c.labor) : 1;
  const logsAll = clearingLogs(c.area, c.forest);
  return { share, logsNow: logsAll * share, logsAll, remaining: Math.max(0, c.labor - c.done) };
}

// Area as hectares with a comma: 12500 -> "1,3 га", 4000 -> "0,40 га".
export const areaText = (m2: number): string => `${(m2 / 10000).toFixed(m2 < 10000 ? 2 : 1).replace(".", ",")} га`;
