import { MONUMENT } from "./heritage";
import type { Building } from "./types";

// Old buildings kept as monuments: houses within reach feel better and sit on dearer land (PLAN-research.ru.md section 7).

// A monument: the purpose, or a unique old building restored as it was (a landmark), which works as one besides.
export const isMonument = (b: Building): boolean => (b.template === "restored" || !!b.landmark) && b.state === "active";

export const finishedMonuments = (buildings: Record<number, Building>): Building[] => Object.values(buildings).filter(isMonument);

// How many of the monuments stand within reach of a point.
export function monumentsNear(monuments: readonly Building[], x: number, y: number): number {
  let n = 0;
  for (const m of monuments) if (Math.hypot(m.lot.cx - x, m.lot.cy - y) <= MONUMENT.radius) n++;
  return n;
}

// The mood of the best monument within reach of a point: monuments do not add up (docs/PLAN-restoration.md section 4); a
// landmark is worth more than a plain monument.
export function monumentMoodAt(monuments: readonly Building[], x: number, y: number): number {
  let best = 0;
  for (const m of monuments) if (Math.hypot(m.lot.cx - x, m.lot.cy - y) <= MONUMENT.radius) best = Math.max(best, m.landmark ? MONUMENT.landmarkMood : MONUMENT.mood);
  return best;
}
export const monumentLand = (count: number, typical = 0): number => Math.min(MONUMENT.landCap, MONUMENT.land * count + TYPICAL_LOCAL.land * typical);

// A typical old building brought back as it was (a shop, a pharmacy...) gives the houses next to it a small, local
// bonus (docs/PLAN-restoration.md section 3): dearer land within a short reach, under the monuments' cap.
export const TYPICAL_LOCAL = { radius: 100, land: 2 };
export const typicalRestored = (buildings: Record<number, Building>): Building[] =>
  Object.values(buildings).filter((b) => b.asItWas && !b.landmark && b.template !== "restored" && b.state === "active");
export function typicalNear(list: readonly Building[], x: number, y: number): number {
  let n = 0;
  for (const b of list) if (Math.hypot(b.lot.cx - x, b.lot.cy - y) <= TYPICAL_LOCAL.radius) n++;
  return n;
}
