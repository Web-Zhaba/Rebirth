import { CREW, FOCUS_CREWS, remainingLabor } from "../sim/buildings";
import type { Building, BuildingQuery, Clearing, Stock } from "../sim/types";
import { clearingLogs } from "../sim/clearing";
import type { IconName } from "./icons";
import { UI } from "../buildings/ui";
import { byGood } from "../sim/goods";
import type { BuildingUi } from "../buildings/uiKit";
import { decimal, L } from "../i18n";

// Pure helpers behind the inspector: the status chip, icons and clearing numbers.

export type ChipTone = "ok" | "warn" | "bad" | "build";
export interface Chip {
  label: string;
  tone: ChipTone;
}

// Which workplace has no workers, no input, and so on, from the data the worker returns.
export function buildingStatus(b: Building, info: BuildingQuery | null, shortfall: boolean): Chip {
  if (b.state === "planned" && b.awaitsRoad) return { label: L("ждёт дорогу", "awaiting the road"), tone: "warn" };
  if (b.state === "planned") return shortfall ? { label: L("ждёт материалов", "awaiting materials"), tone: "warn" } : { label: L("в очереди", "queued"), tone: "build" };
  if (b.state === "building") return { label: L("строится", "under construction"), tone: "build" };
  if (b.upgrade) return { label: L("перестраивается", "rebuilding"), tone: "build" };
  if (info?.kind === "workplace") {
    if (info.production?.missing) return { label: L("нет сырья", "no input"), tone: "bad" };
    if (info.capacity > 0 && info.workers.length === 0) return { label: L("нет работников", "no workers"), tone: "bad" };
    if (info.service && !info.service.working) return { label: L("нет работников", "no workers"), tone: "bad" };
  }
  if (info?.kind === "house" && info.households.length === 0) return { label: L("пустует", "empty"), tone: "warn" };
  if (info?.kind === "house") return { label: L("заселён", "occupied"), tone: "ok" };
  if (b.template === "restored") return { label: L("памятник", "monument"), tone: "ok" };
  return { label: b.template === "dig" ? L("раскоп готов", "dig finished") : L("работает", "working"), tone: "ok" };
}

// Icon of a building template (src/buildings/<id>/ui.ts): houses, workshops and shops share their class's icon.
export const templateIcon = (template: string): IconName => (UI as Record<string, BuildingUi | undefined>)[template]?.icon ?? "res";

// What a workplace makes, in the nominative, with the icon of the good.
const GOOD_ICON: Record<keyof Stock, IconName> = { food: "food", logs: "log", planks: "planks", stone: "stone", clothes: "shirt", dishes: "wares", furniture: "chair", tools: "toolbox" };
export const OUTPUT: Record<keyof Stock, { name: string; unit: string; icon: IconName }> = byGood((g, k) => ({ name: g.name, unit: g.unit, icon: GOOD_ICON[k] }));

// Hands one site can use at once: its crew (`crew`, siteCrew of a building, CREW of a clearing), two crews in a толока.
export const siteHands = (artel: number, toloka: boolean, crew = CREW): number => Math.min(artel, toloka ? crew * FOCUS_CREWS : crew);

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
export const areaText = (m2: number): string => `${decimal((m2 / 10000).toFixed(m2 < 10000 ? 2 : 1))} ${L("га", "ha")}`;
