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
  group: JobGroup | null; // job group of a workplace (houses: null); a new template must declare one
}

// Job groups: the player sets a hiring priority for each (PLAN-ui.md glossary). Construction is a key of its own,
// but it has no buildings: its priority sets the builders' floor.
export const JOB_GROUPS = ["food", "materials", "crafts", "trade", "services"] as const;
export type JobGroup = (typeof JOB_GROUPS)[number];
export type JobKey = JobGroup | "build";
export const JOB_KEYS: readonly JobKey[] = [...JOB_GROUPS, "build"];
export const JOB_NAMES: Record<JobKey, string> = { food: "Еда", materials: "Материалы", crafts: "Ремёсла", trade: "Торговля", services: "Услуги", build: "Стройка" };

// 0 none, 1 low, 2 normal (default), 3 high.
export type Priority = 0 | 1 | 2 | 3;
export const PRIORITY_NAMES: readonly string[] = ["Нет", "Низкий", "Обычный", "Высокий"];
export const isPriority = (v: unknown): v is Priority => typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 3;
export const isJobKey = (v: unknown): v is JobKey => typeof v === "string" && (JOB_KEYS as readonly string[]).includes(v);

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
  group: JobGroup | null,
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
  group,
});

// Labor is paced for play, not history: a village raised houses together (толока), and an
// izba should take about one game day of the founding party's work. Materials are m3 / m3 / t
// (logs, planks, stone); the labor of placed buildings is not in the design table, chosen here.
export const BUILDINGS: Record<string, BuildingTemplate> = {
  izba: T("izba", "Дом", "res", 2, 3, 6, 7, 5, 26, 5, [15, 1.5, 1], null),
  izba5: T("izba5", "Большой дом", "res", 2, 4, 7, 9, 6, 40, 7, [22, 2, 1.5], null),
  smithy: T("smithy", "Кузница", "craft", 2, 2, 6, 5, 4, 90, 3, [10, 1, 5], "crafts"),
  carpentry: T("carpentry", "Столярная мастерская", "craft", 2, 3, 8, 6, 5, 110, 4, [22, 3, 2], "crafts"),
  pottery: T("pottery", "Гончарня", "craft", 2, 2, 6, 5, 4, 75, 3, [10, 1, 4], "crafts"),
  shop: T("shop", "Магазин", "trade", 1, 2, 6, 6, 5, 60, 2, [14, 2, 1], "trade"),
  tavern: T("tavern", "Таверна", "trade", 3, 3, 12, 10, 7, 220, 5, [90, 10, 8], "trade"),
  gumno: T("gumno", "Ферма", "placed", 1, 2, 8, 10, 6, 50, 0, [16, 2, 2], "food"),
  woodcutter: T("woodcutter", "Лесозаготовка", "placed", 1, 1, 4, 4, 3, 24, 2, [6, 0.5, 0], "materials"),
  sawpit: T("sawpit", "Лесопилка", "placed", 1, 1, 6, 4, 3, 30, 2, [5, 1, 0], "materials"),
  quarry: T("quarry", "Карьер", "placed", 1, 2, 8, 8, 3, 70, 3, [4, 0.5, 0], "materials"),
  fisher: T("fisher", "Рыболовный причал", "placed", 1, 1, 4, 4, 3, 40, 2, [6, 1, 0], "food"),
  barn: T("barn", "Склад", "placed", 1, 1, 6, 6, 6, 100, 0, [20, 6, 2], "services"),
  // Services (PLAN.md section 9); labor and materials chosen here, like the placed buildings above.
  well: T("well", "Колодец", "placed", 1, 1, 2, 2, 2, 30, 0, [2, 0.5, 3], "services"),
  market: T("market", "Рынок", "placed", 2, 2, 12, 12, 4, 160, 4, [30, 6, 2], "trade"),
  chapel: T("chapel", "Храм", "placed", 1, 2, 6, 8, 8, 180, 1, [35, 4, 6], "services"),
  school: T("school", "Школа", "placed", 1, 2, 8, 10, 5, 150, 2, [40, 5, 3], "services"),
  healer: T("healer", "Лечебница", "placed", 1, 1, 6, 6, 4, 80, 1, [14, 2, 1], "services"),
  // Food without fields (fields.ts FOOD_RATE): a kitchen garden by the houses, a hunter's hut.
  garden: T("garden", "Огород", "placed", 1, 1, 3, 3, 1, 20, 3, [2, 0.5, 0], "food"),
  hunter: T("hunter", "Охотничий пост", "placed", 1, 1, 4, 4, 3, 30, 2, [4, 1, 0], "food"),
  // Alternative food (fields.ts FOOD_RATE): picking in the forest, fruit trees, bees; and a cellar that keeps the stock.
  forager: T("forager", "Сбор в лесу", "placed", 1, 1, 4, 4, 2, 24, 3, [2, 0.5, 0], "food"),
  orchard: T("orchard", "Сад", "placed", 1, 2, 8, 10, 3, 60, 2, [4, 0.5, 0], "food"),
  apiary: T("apiary", "Пасека", "placed", 1, 1, 4, 4, 2, 30, 1, [3, 1, 0], "food"),
  cellar: T("cellar", "Погреб", "placed", 1, 1, 5, 5, 2, 70, 0, [10, 3, 4], "services"),
  // Excavation (PLAN.md section 12).
  dig: T("dig", "Раскоп", "placed", 1, 1, 6, 6, 1, 30, 3, [2, 0.5, 0], "services"),
  // A restored old building kept as a monument (sim/restore.ts): no jobs, no residents; its size, cost and shape come from the foundation.
  restored: T("restored", "Памятник", "placed", 1, 1, 8, 8, 8, 100, 0, [10, 2, 3], null),
};

// Materials of a building: its own (a restored old building is priced by its area) or its template's.
export const materialsOf = (b: Pick<Building, "template" | "materials">): Materials | undefined => b.materials ?? BUILDINGS[b.template]?.materials;

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
export const CELLAR_CAP = 10_000; // kg per finished cellar; it keeps food better than a barn (weatherEffects spoilage)
export const FOUNDING_STOCK: Stock = { food: 3000, logs: 100, planks: 12, stone: 12, wares: 20 };

export function foodCapacity(buildings: Record<number, Building>): number {
  let cap = FOOD_CAMP_CAP;
  for (const b of Object.values(buildings)) if (b.state === "active") cap += storageOf(b.template);
  return cap;
}

// Kg of food a finished building of the template holds on top of the camp.
export const storageOf = (template: string): number => (template === "barn" ? BARN_CAP : template === "cellar" ? CELLAR_CAP : 0);

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

// Splits `personHours` between the open sites: buildings (workplaces first, then houses, each by id) and clearings, the clearings first or last (`first`).
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
  // Workplaces before houses (each in id order): a workshop or farm planned after a queue of houses is not left to the end.
  for (const homes of [false, true])
    for (const key of Object.keys(buildings)) {
      const b = buildings[Number(key)];
      const rem = remainingLabor(b);
      if (rem > EPS && (b.zone === "res") === homes) sites.push([Number(key), rem]);
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
