import type { ZoneType } from "./types";

export interface BuildingTemplate {
  id: string;
  name: string;
  zone: ZoneType;
  w: number; // lot width in cells, along the road
  d: number; // lot depth in cells
  along: number; // footprint size along the road, m
  deep: number; // footprint size across, m
  height: number; // m
  labor: number; // person-hours
  residents: number; // capacity of a house
  jobs: number; // capacity of a workplace
}

const T = (
  id: string,
  name: string,
  zone: ZoneType,
  w: number,
  d: number,
  along: number,
  deep: number,
  height: number,
  labor: number,
  capacity: number,
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
});

// Labor is paced for play, not history: a village raised houses together (толока), and an
// izba should take about one game day of the founding party's work.
export const BUILDINGS: Record<string, BuildingTemplate> = {
  izba: T("izba", "Изба", "res", 2, 3, 6, 7, 5, 100, 5),
  izba5: T("izba5", "Пятистенок", "res", 2, 4, 7, 9, 6, 150, 7),
  smithy: T("smithy", "Кузница", "craft", 2, 2, 6, 5, 4, 90, 3),
  carpentry: T("carpentry", "Столярная мастерская", "craft", 2, 3, 8, 6, 5, 110, 4),
  pottery: T("pottery", "Гончарня", "craft", 2, 2, 6, 5, 4, 75, 3),
  shop: T("shop", "Лавка", "trade", 1, 2, 6, 6, 5, 60, 2),
  tavern: T("tavern", "Постоялый двор", "trade", 3, 3, 12, 10, 7, 220, 5),
};

// Templates of one zone type, in table order.
export const templatesOf = (zone: ZoneType): BuildingTemplate[] => Object.values(BUILDINGS).filter((t) => t.zone === zone);

export const FRONT_SETBACK = 2; // m between the lot front and the footprint
