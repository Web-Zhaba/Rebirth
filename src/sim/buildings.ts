import type { Building, Clearing, Stock, ZoneType } from "./types";
import { L } from "../i18n";

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
  residents: number; // capacity of a house (all its families)
  homes: number; // families a house holds (0 for any other building)
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
export const JOB_NAMES: Record<JobKey, string> = { food: L("Еда", "Food"), materials: L("Материалы", "Materials"), crafts: L("Ремёсла", "Crafts"), trade: L("Торговля", "Trade"), services: L("Услуги", "Services"), build: L("Стройка", "Building") };

// 0 none, 1 low, 2 normal (default), 3 high.
export type Priority = 0 | 1 | 2 | 3;
export const PRIORITY_NAMES: readonly string[] = [L("Нет", "None"), L("Низкий", "Low"), L("Обычный", "Normal"), L("Высокий", "High")];
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
  homes = zone === "res" ? 1 : 0,
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
  homes,
  jobs: zone === "res" ? 0 : capacity,
  materials: { logs: materials[0], planks: materials[1], stone: materials[2] },
  group,
});

// Labor is paced for play, not history: a village raised houses together (толока), and an
// izba should take about one game day of the founding party's work. Materials are m3 / m3 / t
// (logs, planks, stone); the labor of placed buildings is not in the design table, chosen here.
export const BUILDINGS: Record<string, BuildingTemplate> = {
  // Sizes are real-world ones (a log house of 8 x 9 m, a workshop of 10 x 8 m) and a workplace employs a real crew, so a
  // town needs a few buildings of a kind, not dozens. A large house holds two families.
  izba: T("izba", L("Дом", "House"), "res", 2, 3, 8, 9, 5, 30, 6, [17, 1.5, 1], null),
  izba5: T("izba5", L("Большой дом", "Large house"), "res", 2, 4, 11, 13, 7, 70, 14, [40, 4, 3], null, 2),
  smithy: T("smithy", L("Кузница", "Smithy"), "craft", 2, 2, 10, 8, 5, 160, 6, [18, 2, 9], "crafts"),
  carpentry: T("carpentry", L("Столярная мастерская", "Carpentry workshop"), "craft", 2, 3, 12, 9, 6, 190, 8, [38, 5, 3], "crafts"),
  pottery: T("pottery", L("Гончарня", "Pottery"), "craft", 2, 2, 10, 8, 5, 130, 6, [18, 2, 7], "crafts"),
  weaver: T("weaver", L("Ткацкая мастерская", "Weaving workshop"), "craft", 2, 2, 10, 8, 5, 120, 6, [20, 3, 1], "crafts"),
  shop: T("shop", L("Магазин", "Shop"), "trade", 1, 2, 7, 8, 5, 100, 4, [24, 3, 2], "trade"),
  tavern: T("tavern", L("Таверна", "Tavern"), "trade", 3, 3, 16, 12, 8, 330, 8, [130, 15, 12], "trade"),
  gumno: T("gumno", L("Ферма", "Farm"), "placed", 2, 2, 12, 14, 7, 70, 0, [24, 3, 3], "food"),
  woodcutter: T("woodcutter", L("Лесозаготовка", "Woodcutter"), "placed", 1, 1, 7, 6, 3, 45, 5, [10, 1, 0], "materials"),
  sawpit: T("sawpit", L("Лесопилка", "Sawmill"), "placed", 1, 1, 7, 6, 4, 55, 4, [9, 2, 0], "materials"),
  quarry: T("quarry", L("Карьер", "Quarry"), "placed", 2, 2, 14, 14, 3, 120, 8, [7, 1, 0], "materials"),
  fisher: T("fisher", L("Рыболовный причал", "Fishing pier"), "placed", 1, 1, 6, 6, 3, 70, 4, [10, 2, 0], "food"),
  barn: T("barn", L("Амбар", "Barn"), "placed", 2, 2, 12, 10, 7, 160, 0, [32, 10, 3], "services"),
  // Services (PLAN.md section 9); labor and materials chosen here, like the placed buildings above.
  well: T("well", L("Колодец", "Well"), "placed", 1, 1, 2, 2, 2, 30, 0, [2, 0.5, 3], "services"),
  market: T("market", L("Рынок", "Market"), "placed", 2, 3, 15, 16, 5, 260, 8, [50, 10, 3], "trade"),
  chapel: T("chapel", L("Храм", "Temple"), "placed", 1, 2, 7, 12, 10, 180, 1, [35, 4, 6], "services"),
  school: T("school", L("Школа", "School"), "placed", 2, 2, 10, 12, 6, 150, 2, [40, 5, 3], "services"),
  healer: T("healer", L("Лечебница", "Infirmary"), "placed", 1, 2, 8, 8, 5, 80, 1, [14, 2, 1], "services"),
  // Food without fields (fields.ts FOOD_RATE): a kitchen garden by the houses, a hunter's hut.
  garden: T("garden", L("Огород", "Vegetable garden"), "placed", 2, 2, 10, 10, 1, 35, 6, [3, 1, 0], "food"),
  hunter: T("hunter", L("Охотничий пост", "Hunting post"), "placed", 1, 1, 6, 6, 3, 50, 4, [7, 2, 0], "food"),
  // Alternative food (fields.ts FOOD_RATE): picking in the forest, fruit trees, bees; and a cellar that keeps the stock.
  forager: T("forager", L("Сбор в лесу", "Forager"), "placed", 1, 1, 6, 6, 2, 40, 6, [3, 1, 0], "food"),
  orchard: T("orchard", L("Сад", "Orchard"), "placed", 2, 3, 15, 20, 3, 100, 4, [7, 1, 0], "food"),
  apiary: T("apiary", L("Пасека", "Apiary"), "placed", 1, 1, 7, 6, 2, 50, 3, [5, 2, 0], "food"),
  cellar: T("cellar", L("Погреб", "Cellar"), "placed", 1, 1, 6, 6, 2, 110, 0, [16, 5, 6], "services"),
  // Stores of the other goods (docs/PLAN-balance.md B4): variants of the storehouse tool.
  logyard: T("logyard", L("Склад леса", "Timber yard"), "placed", 2, 2, 12, 10, 4, 90, 0, [14, 2, 0], "services"),
  stoneyard: T("stoneyard", L("Склад камня", "Stone yard"), "placed", 2, 2, 12, 12, 2, 70, 0, [6, 1, 2], "services"),
  warehouse: T("warehouse", L("Товарный склад", "Warehouse"), "placed", 2, 2, 10, 10, 6, 140, 0, [26, 6, 3], "services"),
  // Administration (docs/PLAN-balance.md B7, sim/governance.ts): clerks who manage the town; kinds of one build-bar tool.
  townhall: T("townhall", L("Ратуша", "Town hall"), "placed", 2, 3, 14, 12, 9, 300, 4, [60, 12, 15], "services"),
  office: T("office", L("Районная управа", "District office"), "placed", 2, 2, 10, 10, 7, 160, 2, [30, 6, 6], "services"),
  // Excavation (PLAN.md section 12).
  dig: T("dig", L("Раскоп", "Dig"), "placed", 1, 1, 6, 6, 1, 30, 6, [2, 0.5, 0], "services"),
  // An old building kept as a monument, one of the purposes of an old foundation (docs/PLAN-restoration.md section 2): no
  // jobs, no residents; its shape, size and cost come from the foundation it stands on.
  restored: T("restored", L("Памятник", "Monument"), "placed", 1, 1, 8, 8, 8, 50, 0, [6, 1.5, 4], null),
};

// Materials of a building: its own (a restored old building is priced by its area) or its template's.
export const materialsOf = (b: Pick<Building, "template" | "materials">): Materials | undefined => b.materials ?? BUILDINGS[b.template]?.materials;

// Raising a house by one level (PLAN.md section 9, docs/PLAN-balance.md B2): taken like construction, the families stay.
// The cost of a level is this times the level the house has now; each level adds this much height.
export const UPGRADE = { labor: 60, materials: { logs: 10, planks: 2, stone: 0 } as Materials, height: 1.5 };

// ---------- buildings on old foundations (docs/PLAN-restoration.md section 2) ----------
// The foundation sets the building: its ring is the footprint and its old height the floors. `scale` is the ring's area
// against the template's own footprint; times the floors built (`level`) it is the floor area, which sets the capacity,
// the cost and the heating.

export const FLOOR = {
  height: 3.66, // m of one storey: the tile heights are levels x 3.66 (OpenMapTiles render_height), 5 m when unknown
  familyArea: 50, // m2 of floor area per family
  jobsCap: 3, // a workplace employs at most this many times its template's crew
};

// Floors of an old building of height `h` (m): one when the data has no height.
export const floorsOf = (h: number | undefined): number => (h !== undefined && h > 0 ? Math.max(1, Math.round(h / FLOOR.height)) : 1);

const onFoundation = (b: Pick<Building, "foundationId">): boolean => !!b.foundationId;
const footArea = (t: BuildingTemplate): number => t.along * t.deep;

// Floor area against the template's footprint: the ring's share times the floors built (1 for a regular building).
export const floorScale = (b: Pick<Building, "scale" | "level" | "foundationId">): number => (b.scale ?? 1) * (onFoundation(b) ? Math.max(1, b.level) : 1);

// Floor area in m2.
export const floorArea = (b: Pick<Building, "template" | "scale" | "level" | "foundationId">): number => {
  const t = BUILDINGS[b.template];
  return t ? footArea(t) * floorScale(b) : 0;
};

// Jobs (and clerks' room) of a workplace: they grow slower than its floor area, about with the square root, and stop at
// FLOOR.jobsCap times the template's, so one huge workshop does not take every free worker.
export const scaledJobs = (v: number, b: Pick<Building, "scale" | "level" | "foundationId">): number => {
  const k = floorScale(b);
  if (k === 1 || v <= 0) return v;
  return Math.max(1, Math.min(Math.round(v * Math.sqrt(k)), v * FLOOR.jobsCap));
};

// House levels (docs/PLAN-balance.md B2): a house holds as many families as its level. A new house starts at the
// families its template is built for (a house 1, a large house 2) and may be raised once more, by the upper floor of
// the rebuild. A house on an old foundation has no such levels: it holds a family per FLOOR.familyArea of the floors
// built, and its highest level is the floors of the old building.
export const startLevel = (template: string): number => Math.max(1, BUILDINGS[template]?.homes ?? 1);
export const maxLevel = (b: Pick<Building, "template" | "foundationId" | "floors">): number => {
  if (onFoundation(b)) return Math.max(1, b.floors ?? 1);
  return BUILDINGS[b.template]?.homes ? BUILDINGS[b.template].homes + 1 : 1;
};

// Families a house holds now, and the people each of them may grow to.
export const homesOf = (b: Pick<Building, "template" | "level" | "scale" | "foundationId">): number => {
  if (!BUILDINGS[b.template]?.homes) return 0;
  return onFoundation(b) ? Math.max(1, Math.round(floorArea(b) / FLOOR.familyArea)) : b.level;
};
export const familyCapacity = (b: Pick<Building, "template">): number => {
  const t = BUILDINGS[b.template];
  return t?.homes ? Math.floor(t.residents / t.homes) : 0;
};

// People a house holds: a family's room for each family.
export const houseCapacity = (b: Pick<Building, "template" | "level" | "scale" | "foundationId">): number => homesOf(b) * familyCapacity(b);

// A finished building that may be raised by a level: a house below its highest level, or a building on an old
// foundation below the floors of the old one; not being raised already. (Technology may still hold it back.)
export const upgradable = (b: Pick<Building, "template" | "zone" | "state" | "level" | "foundationId" | "floors" | "upgrade">): boolean =>
  (b.zone === "res" || onFoundation(b)) && b.state === "active" && !b.upgrade && b.level < maxLevel(b);

// The work and materials of raising a house from its level now to the next; on an old foundation, of one more floor
// (the cost of the building's ring once).
export const upgradeLabor = (b: Pick<Building, "template" | "level" | "scale" | "foundationId">): number => {
  const t = BUILDINGS[b.template];
  if (onFoundation(b) && t) return Math.max(1, Math.round(t.labor * (b.scale ?? 1)));
  return UPGRADE.labor * b.level;
};
export const upgradeMaterials = (b: Pick<Building, "template" | "level" | "scale" | "foundationId">): Materials => {
  const t = BUILDINGS[b.template];
  const r1 = (v: number) => Math.round(v * 10) / 10;
  if (onFoundation(b) && t) {
    const k = b.scale ?? 1;
    return { logs: r1(t.materials.logs * k), planks: r1(t.materials.planks * k), stone: r1(t.materials.stone * k) };
  }
  const k = b.level;
  return { logs: UPGRADE.materials.logs * k, planks: UPGRADE.materials.planks * k, stone: UPGRADE.materials.stone * k };
};

// Height a finished level adds.
export const levelHeight = (b: Pick<Building, "foundationId">): number => (onFoundation(b) ? FLOOR.height : UPGRADE.height);

// Templates of one zone type, in table order.
export const templatesOf = (zone: ZoneType | "placed"): BuildingTemplate[] => Object.values(BUILDINGS).filter((t) => t.zone === zone);

export const FRONT_SETBACK = 2; // m between the lot front and the footprint

// ---------- storage ----------

// Resources lie in stores (docs/PLAN-balance.md B4, sim/storage.ts): the camp at the founding point holds a little of
// everything, a barn or cellar food, a timber yard logs and planks, a stone yard stone, a warehouse the goods. Each store
// has a room per group of goods, in the units of the stock (kg, m3, t, pieces).
export type StoreGroup = "food" | "wood" | "stone" | "goods";
export const STORE_GROUPS: Record<StoreGroup, readonly (keyof Stock)[]> = { food: ["food"], wood: ["logs", "planks"], stone: ["stone"], goods: ["clothes", "dishes", "furniture", "tools"] };
export const groupOf = (g: keyof Stock): StoreGroup => (g === "food" ? "food" : g === "logs" || g === "planks" ? "wood" : g === "stone" ? "stone" : "goods");
export type StoreRoom = Partial<Record<StoreGroup, number>>;

export const FOOD_CAMP_CAP = 3000; // kg, at the camp
export const BARN_CAP = 60_000; // kg per finished barn
export const CELLAR_CAP = 20_000; // kg per finished cellar; it keeps food better than a barn (weatherEffects spoilage)
export const CAMP_STORE: Required<StoreRoom> = { food: FOOD_CAMP_CAP, wood: 200, stone: 60, goods: 150 };
export const STORES: Record<string, StoreRoom> = { barn: { food: BARN_CAP }, cellar: { food: CELLAR_CAP }, logyard: { wood: 400 }, stoneyard: { stone: 300 }, warehouse: { goods: 500 } };
export const FOUNDING_STOCK: Stock = { food: 3000, logs: 100, planks: 12, stone: 12, clothes: 12, dishes: 6, furniture: 2, tools: 10 };

// The room of a finished store (linear in the floor area on an old foundation); empty for any other building.
export function storeRoom(b: Pick<Building, "template" | "scale" | "level" | "foundationId">): StoreRoom {
  const r = STORES[b.template];
  if (!r) return {};
  const out: StoreRoom = {};
  const k = floorScale(b);
  for (const g of Object.keys(r) as StoreGroup[]) out[g] = r[g]! * k;
  return out;
}

// The room of a group in the whole town: the camp and every finished store.
export function capacityOf(buildings: Record<number, Building>, group: StoreGroup): number {
  let cap = CAMP_STORE[group];
  for (const b of Object.values(buildings)) if (b.state === "active") cap += storeRoom(b)[group] ?? 0;
  return cap;
}
export const foodCapacity = (buildings: Record<number, Building>): number => capacityOf(buildings, "food");

// Kg of food a finished building holds on top of the camp (scaled with its old foundation).
export const storageOf = (b: Pick<Building, "template" | "scale" | "level" | "foundationId">): number => storeRoom(b).food ?? 0;

// ---------- construction labor ----------

export const CREW = 6; // hands of one crew: what a forest clearing or an izba site can use at once

// Hands a building site can use at once: about one per 12 m2 of its footprint (an izba of 8 x 9 m takes a crew of 6, a
// well 2, a tavern 16), so a small site never swallows the whole artel.
export function siteCrew(b: Pick<Building, "template" | "scale">): number {
  const t = BUILDINGS[b.template];
  if (!t) return CREW;
  return Math.min(16, Math.max(2, Math.round((t.along * t.deep * (b.scale ?? 1)) / 12)));
}

// A толока puts this many crews of its site to work at once.
export const FOCUS_CREWS = 2;

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
// Each takes at most its own crew's work (`crewHours` is the work of one crew of CREW hands; a building site takes
// siteCrew of its hands, a clearing CREW), in that order. Hands no site can use stay idle: labor that does not fit is not spent.
// Player levers that reorder the work: `priority` goes to the very front; `focus` (толока) takes FOCUS_CREWS of its
// crews before anyone else. Keys: building id, or -id of a clearing.
export interface SiteLever {
  priority?: number | null;
  focus?: number | null;
}

function allocate(buildings: Record<number, Building>, clearings: readonly Clearing[], personHours: number, crewHours: number, first: boolean, lever?: SiteLever) {
  const sites: [number, number, number][] = []; // key (building id, or -id of a clearing), remaining, crew cap
  const fell = clearings.filter((c) => remainingClearing(c) > EPS).map((c): [number, number, number] => [-c.id, remainingClearing(c), crewHours]);
  if (first) sites.push(...fell);
  // Workplaces before houses (each in id order): a workshop or farm planned after a queue of houses is not left to the end.
  for (const homes of [false, true])
    for (const key of Object.keys(buildings)) {
      const b = buildings[Number(key)];
      const rem = remainingLabor(b);
      if (rem > EPS && (b.zone === "res") === homes) sites.push([Number(key), rem, (crewHours * siteCrew(b)) / CREW]);
    }
  if (!first) sites.push(...fell);
  const pi = lever?.priority != null ? sites.findIndex(([id]) => id === lever.priority) : -1;
  if (pi > 0) sites.unshift(...sites.splice(pi, 1));
  const fi = lever?.focus != null ? sites.findIndex(([id]) => id === lever.focus) : -1;
  if (fi >= 0) {
    const [focus] = sites.splice(fi, 1);
    sites.unshift([focus[0], focus[1], focus[2] * FOCUS_CREWS]);
  }
  const out = new Map<number, number>();
  let left = personHours;
  for (const [id, rem, cap] of sites) {
    if (left <= EPS) break;
    const take = Math.min(left, cap, rem);
    if (take <= EPS) continue;
    out.set(id, take);
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
