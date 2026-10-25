import type { Building, Clearing, Stock, ZoneType } from "./types";

export interface Materials {
  logs: number; // m3
  planks: number; // m3
  stone: number; // t
}

export interface BuildingTemplate {
  id: string;
  name: string;
  zone: ZoneType | "placed"; // "placed": put down by the player
  w: number; // lot width in cells, along the road
  d: number; // lot depth in cells
  along: number; // footprint size along the road, m
  deep: number; // footprint size across, m
  height: number; // m
  labor: number; // person-hours
  residents: number; // capacity of a house
  jobs: number; // capacity of a workplace (a gumno's depends on its fields, see fields.ts)
  materials: Materials;
}

const T = (
  id: string,
  name: string,
  zone: ZoneType | "placed",
  w: number,
  d: number,
  along: number,
  deep: number,
  height: number,
  labor: number,
  capacity: number,
  materials: [number, number, number],
): BuildingTemplate => ({
  id,
  name,
  zone,
  w,
  d,
  along,
  deep,
  height,
  labor,
  residents: zone === "res" ? capacity : 0,
  jobs: zone === "res" ? 0 : capacity,
  materials: { logs: materials[0], planks: materials[1], stone: materials[2] },
});

// Labor is paced for play, not history: a village raised houses together (толока), and an
// izba should take about one game day of the founding party's work. Materials are m3 / m3 / t
// (logs, planks, stone); the labor of placed buildings is not in the design table, chosen here.
export const BUILDINGS: Record<string, BuildingTemplate> = {
  izba: T("izba", "Дом", "res", 2, 3, 6, 7, 5, 100, 5, [25, 2, 2]),
  izba5: T("izba5", "Большой дом", "res", 2, 4, 7, 9, 6, 150, 7, [40, 4, 3]),
  smithy: T("smithy", "Кузница", "craft", 2, 2, 6, 5, 4, 90, 3, [10, 1, 5]),
  carpentry: T("carpentry", "Столярная мастерская", "craft", 2, 3, 8, 6, 5, 110, 4, [22, 3, 2]),
  pottery: T("pottery", "Гончарня", "craft", 2, 2, 6, 5, 4, 75, 3, [10, 1, 4]),
  shop: T("shop", "Магазин", "trade", 1, 2, 6, 6, 5, 60, 2, [14, 2, 1]),
  tavern: T("tavern", "Таверна", "trade", 3, 3, 12, 10, 7, 220, 5, [90, 10, 8]),
  gumno: T("gumno", "Ферма", "placed", 1, 2, 8, 10, 6, 120, 0, [30, 4, 3]),
  woodcutter: T("woodcutter", "Лесозаготовка", "placed", 1, 1, 4, 4, 3, 40, 2, [6, 0.5, 0]),
  sawpit: T("sawpit", "Лесопилка", "placed", 1, 1, 6, 4, 3, 50, 2, [5, 1, 0]),
  quarry: T("quarry", "Карьер", "placed", 1, 2, 8, 8, 3, 70, 3, [4, 0.5, 0]),
  fisher: T("fisher", "Рыболовный причал", "placed", 1, 1, 4, 4, 3, 40, 2, [6, 1, 0]),
  barn: T("barn", "Склад", "placed", 1, 1, 6, 6, 6, 100, 0, [20, 6, 2]),
  // Services (PLAN.md section 9); labor and materials chosen here, like the placed buildings above.
  well: T("well", "Колодец", "placed", 1, 1, 2, 2, 2, 30, 0, [2, 0.5, 3]),
  market: T("market", "Рынок", "placed", 2, 2, 12, 12, 4, 160, 4, [30, 6, 2]),
  chapel: T("chapel", "Храм", "placed", 1, 2, 6, 8, 8, 180, 1, [35, 4, 6]),
  school: T("school", "Школа", "placed", 1, 2, 8, 10, 5, 150, 2, [40, 5, 3]),
  healer: T("healer", "Лечебница", "placed", 1, 1, 6, 6, 4, 80, 1, [14, 2, 1]),
  // Excavation (PLAN.md section 12).
  dig: T("dig", "Раскоп", "placed", 1, 1, 6, 6, 1, 30, 3, [2, 0.5, 0]),
};

// Rebuilding an izba into level 2 (PLAN.md section 9): taken like construction, the family stays.
export const UPGRADE = { template: "izba", labor: 60, materials: { logs: 10, planks: 2, stone: 0 } as Materials, residents: 2, height: 1.5 };

// People a house holds: the template's capacity, plus the upgrade's.
export const houseCapacity = (b: Pick<Building, "template" | "level">): number =>
  (BUILDINGS[b.template]?.residents ?? 0) + (b.level >= 2 ? UPGRADE.residents : 0);

// Templates of one zone type, in table order.
export const templatesOf = (zone: ZoneType | "placed"): BuildingTemplate[] => Object.values(BUILDINGS).filter((t) => t.zone === zone);

export const FRONT_SETBACK = 2; // m between the lot front and the footprint

// ---------- storage ----------

export const FOOD_CAMP_CAP = 3000; // kg, at the camp
export const BARN_CAP = 30_000; // kg per finished barn
export const FOUNDING_STOCK: Stock = { food: 3000, logs: 60, planks: 8, stone: 6, wares: 20 };

export function foodCapacity(buildings: Record<number, Building>): number {
  let cap = FOOD_CAMP_CAP;
  for (const b of Object.values(buildings)) if (b.template === "barn" && b.state === "active") cap += BARN_CAP;
  return cap;
}

// ---------- construction labor ----------

export const CREW = 6; // hands a construction site can use at once

const EPS = 1e-9;

// Person-hours still to spend on a site: a building under construction, or a finished house being upgraded.
export function remainingLabor(b: Building): number {
  if (b.state !== "active") return Math.max(0, b.labor - b.done);
  return b.upgrade ? Math.max(0, b.upgrade.labor - b.upgrade.done) : 0;
}

// Person-hours still to spend on a clearing.
export const remainingClearing = (c: Clearing): number => Math.max(0, c.labor - c.done);

// Clearings come before buildings while the stock cannot pay the logs of an izba: felling then gives logs faster
// than making them by hand on the sites. With logs in stock they come after, so they never delay the first houses.
export const clearingsFirst = (stock: Stock): boolean => stock.logs < BUILDINGS.izba.materials.logs;

// Splits `personHours` between the open sites: buildings by id and clearings, the clearings first or last (`first`).
// Each takes at most one crew's work (`crewHours`), in that order; what is left goes to the same sites in the same
// order while they still have work, so labor is never wasted.
// Player levers that reorder the work: `priority` goes to the very front of both rounds; `focus` (толока) takes all the
// hands it can use, without the crew limit, before anyone else. Keys: building id, or -id of a clearing.
export interface SiteLever {
  priority?: number | null;
  focus?: number | null;
}

function allocate(buildings: Record<number, Building>, clearings: readonly Clearing[], personHours: number, crewHours: number, first: boolean, lever?: SiteLever) {
  const sites: [number, number][] = []; // key (building id, or -id of a clearing), remaining
  const fell = clearings.filter((c) => remainingClearing(c) > EPS).map((c): [number, number] => [-c.id, remainingClearing(c)]);
  if (first) sites.push(...fell);
  for (const key of Object.keys(buildings)) {
    const rem = remainingLabor(buildings[Number(key)]);
    if (rem > EPS) sites.push([Number(key), rem]);
  }
  if (!first) sites.push(...fell);
  const pi = lever?.priority != null ? sites.findIndex(([id]) => id === lever.priority) : -1;
  if (pi > 0) sites.unshift(...sites.splice(pi, 1));
  const out = new Map<number, number>();
  let left = personHours;
  const fi = lever?.focus != null ? sites.findIndex(([id]) => id === lever.focus) : -1;
  if (fi >= 0) {
    const take = Math.min(left, sites[fi][1]);
    if (take > EPS) {
      out.set(sites[fi][0], take);
      left -= take;
    }
    sites.splice(fi, 1);
  }
  for (const [id, rem] of sites) {
    const take = Math.min(left, crewHours, rem);
    if (take <= EPS) break;
    out.set(id, take);
    left -= take;
  }
  for (const [id, rem] of sites) {
    if (left <= EPS) break;
    const take = Math.min(left, rem - (out.get(id) ?? 0));
    if (take <= EPS) continue;
    out.set(id, (out.get(id) ?? 0) + take);
    left -= take;
  }
  return out;
}

// Building id -> person-hours it receives.
export function allocateLabor(buildings: Record<number, Building>, personHours: number, crewHours: number, clearings: readonly Clearing[] = [], first = false, lever?: SiteLever): Map<number, number> {
  const out = new Map<number, number>();
  for (const [key, h] of allocate(buildings, clearings, personHours, crewHours, first, lever)) if (key > 0) out.set(key, h);
  return out;
}

// Clearing id -> person-hours it receives from the same allocation.
export function allocateClearings(buildings: Record<number, Building>, clearings: readonly Clearing[], personHours: number, crewHours: number, first = false, lever?: SiteLever): Map<number, number> {
  const out = new Map<number, number>();
  for (const [key, h] of allocate(buildings, clearings, personHours, crewHours, first, lever)) if (key < 0) out.set(-key, h);
  return out;
}
