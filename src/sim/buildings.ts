import type { Building, Stock, ZoneType } from "./types";

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
  izba: T("izba", "Изба", "res", 2, 3, 6, 7, 5, 100, 5, [25, 2, 2]),
  izba5: T("izba5", "Пятистенок", "res", 2, 4, 7, 9, 6, 150, 7, [40, 4, 3]),
  smithy: T("smithy", "Кузница", "craft", 2, 2, 6, 5, 4, 90, 3, [10, 1, 5]),
  carpentry: T("carpentry", "Столярная мастерская", "craft", 2, 3, 8, 6, 5, 110, 4, [22, 3, 2]),
  pottery: T("pottery", "Гончарня", "craft", 2, 2, 6, 5, 4, 75, 3, [10, 1, 4]),
  shop: T("shop", "Лавка", "trade", 1, 2, 6, 6, 5, 60, 2, [14, 2, 1]),
  tavern: T("tavern", "Постоялый двор", "trade", 3, 3, 12, 10, 7, 220, 5, [90, 10, 8]),
  gumno: T("gumno", "Гумно", "placed", 1, 2, 8, 10, 6, 120, 0, [30, 4, 3]),
  woodcutter: T("woodcutter", "Лесоруб", "placed", 1, 1, 4, 4, 3, 40, 2, [6, 0.5, 0]),
  sawpit: T("sawpit", "Пильня", "placed", 1, 1, 6, 4, 3, 50, 2, [5, 1, 0]),
  quarry: T("quarry", "Каменоломня", "placed", 1, 2, 8, 8, 3, 70, 3, [4, 0.5, 0]),
  fisher: T("fisher", "Рыбак", "placed", 1, 1, 4, 4, 3, 40, 2, [6, 1, 0]),
  barn: T("barn", "Амбар", "placed", 1, 1, 6, 6, 6, 100, 0, [20, 6, 2]),
};

// Templates of one zone type, in table order.
export const templatesOf = (zone: ZoneType | "placed"): BuildingTemplate[] => Object.values(BUILDINGS).filter((t) => t.zone === zone);

export const FRONT_SETBACK = 2; // m between the lot front and the footprint

// ---------- storage ----------

export const FOOD_CAMP_CAP = 3000; // kg, at the camp
export const BARN_CAP = 30_000; // kg per finished barn
export const FOUNDING_STOCK: Stock = { food: 1750, logs: 0, planks: 0, stone: 0, wares: 20 };

export function foodCapacity(buildings: Record<number, Building>): number {
  let cap = FOOD_CAMP_CAP;
  for (const b of Object.values(buildings)) if (b.template === "barn" && b.state === "active") cap += BARN_CAP;
  return cap;
}
