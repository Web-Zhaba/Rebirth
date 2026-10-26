import { MONUMENT } from "./heritage";
import type { Building } from "./types";

// Restored buildings kept as monuments: houses within reach feel better and sit on dearer land (PLAN-research.ru.md section 7).

export const isMonument = (b: Building): boolean => b.restoreMode === "monument" && b.state === "active";

export const finishedMonuments = (buildings: Record<number, Building>): Building[] => Object.values(buildings).filter(isMonument);

// How many of the monuments stand within reach of a point.
export function monumentsNear(monuments: readonly Building[], x: number, y: number): number {
  let n = 0;
  for (const m of monuments) if (Math.hypot(m.lot.cx - x, m.lot.cy - y) <= MONUMENT.radius) n++;
  return n;
}

export const monumentMood = (count: number): number => (count > 0 ? MONUMENT.mood : 0);
export const monumentLand = (count: number): number => Math.min(MONUMENT.landCap, MONUMENT.land * count);
