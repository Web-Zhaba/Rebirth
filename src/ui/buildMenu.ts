import { CLEARING } from "../sim/clearing";
import { BUILDINGS, type Materials, type StoreGroup, type StoreRoom } from "../sim/buildings";
import { ADMIN } from "../sim/governance";
import { ROAD_KINDS } from "../sim/roads";
import { SERVICES, isService } from "../sim/services";
import { isPlaceTool, placeTemplate, placeVariant, roadKindOf, roadMaterial, type MaterialTool, type Tool } from "../map/tools";
import type { RoadKind } from "../sim/types";
import type { IconName } from "./icons";
import { BUILDING_TOOLS, UI } from "../buildings/ui";
import type { BuildingUi } from "../buildings/uiKit";
import { decimal, L } from "../i18n";

export type CategoryId = "roads" | "town" | "food" | "farm" | "services" | "past";

export interface Category {
  id: CategoryId;
  label: string;
  tools: Tool[]; // up to 8, picked by Q W E R T Y U I
}

export const CATEGORIES: Category[] = [
  { id: "roads", label: L("Дороги", "Roads"), tools: ["path", "dirt", "footbridge", "bridge", "bulldoze", "restore"] },
  { id: "town", label: L("Город", "Town"), tools: ["house", "workshop", "tavern", "barn", "cellar"] },
  { id: "food", label: L("Еда", "Food"), tools: ["field", "gumno", "garden", "hunter", "fisher", "forager", "orchard", "apiary"] },
  { id: "farm", label: L("Ресурсы", "Resources"), tools: ["clearing", "woodcutter", "sawpit", "quarry", "market"] },
  { id: "services", label: L("Службы", "Services"), tools: ["well", "shop", "chapel", "school", "healer", "townhall"] },
  { id: "past", label: L("Прошлое", "Past"), tools: ["dig", "restored", "museum"] },
];

// Physical key codes (layout independent: Q is the key left of W also on a Russian layout).
export const ITEM_KEYS = ["KeyQ", "KeyW", "KeyE", "KeyR", "KeyT", "KeyY", "KeyU", "KeyI"] as const;
export const ITEM_KEY_LABEL = ["Q", "W", "E", "R", "T", "Y", "U", "I"] as const;
export const CATEGORY_KEYS = ["F1", "F2", "F3", "F4", "F5", "F6"] as const;
export const DEMOLISH_KEY = "KeyB";

export const categoryOf = (t: Tool): Category => CATEGORIES.find((c) => c.tools.includes(t))!;

const OWN_ICON: Partial<Record<Tool, IconName>> = {
  path: "path",
  dirt: "dirt",
  footbridge: "footbridge",
  bridge: "bridge",
  bulldoze: "bulldoze",
  restore: "street",
  house: "res",
  workshop: "craft",
  field: "field",
  clearing: "clearing",
  barn: "barn",
  townhall: "townhall",
};

// Icons of the road, land and group tools; a building's tool has its own (src/buildings/<id>/ui.ts).
export const TOOL_ICON = { ...OWN_ICON, ...Object.fromEntries(BUILDING_TOOLS.map((id) => [id, UI[id].tool!.icon])) } as Record<Tool, IconName>;

const TOOL_LABEL: Partial<Record<Tool, string>> = {
  path: L("Тропа", "Path"),
  dirt: L("Дорога", "Road"),
  footbridge: L("Канатный мостик", "Rope footbridge"),
  bridge: L("Мост", "Bridge"),
  bulldoze: L("Снос", "Demolish"),
  restore: L("Старые улицы", "Old streets"),
  house: L("Дом", "House"),
  workshop: L("Мастерская", "Workshop"),
  field: L("Поле", "Field"),
  clearing: L("Вырубка", "Clearing"),
  barn: L("Склад", "Storehouse"),
  townhall: L("Управа", "Administration"),
};

export const toolLabel = (t: Tool): string => TOOL_LABEL[t] ?? BUILDINGS[t].name;

const PURPOSE: Partial<Record<Tool, string>> = {
  path: L("Дешёвая тропа: по ней ходят пешком, ставить дома можно рядом", "A cheap path: people walk on it; houses can go beside it"),
  dirt: L("Грунтовая дорога: шире и ровнее тропы, по ней возят грузы", "Dirt road: wider and smoother than a path, carts haul goods on it"),
  footbridge: L("Подвесной мостик над водой: только для пешеходов, узкий и лёгкий", "A rope footbridge over water: pedestrians only, narrow and light"),
  bridge: L("Широкий мост на сваях над водой: по нему проедут грузы", "A wide bridge on piles over water: carts can cross it"),
  bulldoze: L("Снести участок дороги вместе с планами вдоль него", "Demolish a road section along with the plans beside it"),
  restore: L("Проложить заново раскопанную улицу целиком: старая тропа станет тропой, улица — дорогой", "Rebuild an excavated street whole: an old path becomes a path, a street becomes a road"),
  house: L("Дома вдоль дороги: протяните вдоль улицы — встанет ряд. Старые фундаменты занимаются первыми", "Houses along a road: drag along a street for a row. Old foundations are taken first"),
  workshop: L("Мастерские вдоль дороги: ткацкая (одежда), гончарня (посуда), столярная (утварь), кузница (инструменты)", "Workshops along a road: weaving (clothing), pottery (dishes), carpentry (furnishings), smithy (tools)"),
  field: L("Поле: контур для зерна, его обрабатывают фермеры", "Field: an outline for grain, worked by farmers"),
  clearing: L("Вырубка леса: брёвна на склад, на месте леса будет луг", "Forest clearing: logs to the store, meadow where the forest was"),
  barn: L("Склад: амбар для еды, склад леса, склад камня или товарный склад. Производства возят выработку на ближайший склад с местом, стройки и дома берут из ближайшего: чем ближе склад, тем меньше времени уходит на подвоз", "Storehouse: a barn for food, a timber yard, a stone yard or a warehouse. Producers cart their output to the nearest store with room, sites and homes fetch from the nearest one: the closer the store, the less time the carting takes"),
  townhall: L(`Управление поселением: без управ работа замедляется, когда жителей больше ${ADMIN.elders}. Ратуша (одна на город) справляется ещё с ${BUILDINGS.townhall.manages} жителями, каждая районная управа — с ${BUILDINGS.office.manages}, пока в них работают писари`, `Running the settlement: without offices work slows once there are more than ${ADMIN.elders} residents. A town hall (one per town) manages ${BUILDINGS.townhall.manages} more, each district office ${BUILDINGS.office.manages}, while clerks work in them`),
};

const SITE: Partial<Record<Tool, string>> = {
  path: L("Между двумя точками на суше, уклон не круче 25 %", "Between two points on land, slope up to 25%"),
  dirt: L("Между двумя точками на суше, уклон не круче 12 %", "Between two points on land, slope up to 12%"),
  footbridge: L("Через воду (пролёт до 25 м) или по суше, уклон не круче 30 %", "Across water (span up to 25 m) or on land, slope up to 30%"),
  bridge: L("Через воду (пролёт до 30 м) или по суше, уклон не круче 10 %", "Across water (span up to 30 m) or on land, slope up to 10%"),
  clearing: L(`Контур до ${CLEARING.maxArea / 10000} га, не дальше ${CLEARING.reach} м от построенной дороги`, `An outline up to ${CLEARING.maxArea / 10000} ha, within ${CLEARING.reach} m of a built road`),
  field: L("Замкнутый контур на суше, не через дорогу и не поверх другого поля", "A closed outline on land, not across a road or over another field"),
  house: L("Вдоль построенной дороги; старые фундаменты у неё — первыми, нераскопанные сначала раскопают", "Along a built road; old foundations by it go first, outlines are dug first"),
  workshop: L("Вдоль построенной дороги; старые фундаменты у неё — первыми", "Along a built road; old foundations by it go first"),
};

// Hover text of the stone materials, which replace the tool text while chosen.
const KIND_PURPOSE: Partial<Record<RoadKind, string>> = {
  stone: L("Каменная дорога: прочная, берёт крутой уклон; камень берут со склада, когда начинают работу", "Stone road: durable, handles steep slopes; stone is taken from the store when work starts"),
  stonebridge: L("Каменный мост на опорах: самый длинный пролёт, камень берут со склада, когда начинают работу", "A stone bridge on piers: the longest span; stone is taken from the store when work starts"),
};
const KIND_SITE: Partial<Record<RoadKind, string>> = {
  stone: L("Между двумя точками на суше, уклон не круче 20 %", "Between two points on land, slope up to 20%"),
  stonebridge: L("Через воду (пролёт до 60 м) или по суше, уклон не круче 12 %", "Across water (span up to 60 m) or on land, slope up to 12%"),
};

export interface ToolInfo {
  tool: Tool;
  label: string;
  purpose: string;
  labor: string | null; // "100 чел.-ч", or per metre for roads
  materials: { icon: IconName; text: string }[];
  jobs: number | null;
  site: string;
  reach: string | null;
}

const MAT_ICON: { key: keyof Materials; icon: IconName; unit: string }[] = [
  { key: "logs", icon: "log", unit: L("м³", "m³") },
  { key: "planks", icon: "planks", unit: L("м³", "m³") },
  { key: "stone", icon: "stone", unit: L("т", "t") },
];

export const num = (n: number): string => decimal(String(Math.round(n * 10) / 10));
// Road costs per metre are small (a path takes 0.04 person-hours a metre): they keep hundredths.
const perMetre = (n: number): string => decimal(String(Math.round(n * 100) / 100));

export function materialList(m: Materials): { icon: IconName; text: string }[] {
  return MAT_ICON.filter((x) => m[x.key] > 0).map((x) => ({ icon: x.icon, text: `${num(m[x.key])} ${x.unit}` }));
}

// The room of a store per group of goods, as "лес 400 м³ · камень 300 т".
const GROUP_ROOM: Record<StoreGroup, [string, string, number]> = {
  food: [L("еда", "food"), L("т", "t"), 1000],
  wood: [L("лес", "timber"), L("м³", "m³"), 1],
  stone: [L("камень", "stone"), L("т", "t"), 1],
  goods: [L("товары", "goods"), L("шт", "pcs"), 1],
};
export const storeGroupName = (g: StoreGroup): string => GROUP_ROOM[g][0];
export const storeAmount = (g: StoreGroup, n: number): string => `${num(n / GROUP_ROOM[g][2])} ${GROUP_ROOM[g][1]}`;
export const roomText = (room: StoreRoom): string =>
  (Object.keys(room) as StoreGroup[])
    .filter((g) => (room[g] ?? 0) > 0)
    .map((g) => `${GROUP_ROOM[g][0]} ${storeAmount(g, room[g]!)}`)
    .join(" · ");

// Everything the hover card shows, taken from the sim tables.
// A road or bridge tool shows the material chosen for it.
// A tool with kinds (the storehouse, the administration) shows the kind chosen for it.
export function toolInfo(t: Tool, material: Record<MaterialTool, RoadKind> = roadMaterial.value, chosen = placeVariant.value): ToolInfo {
  const b = BUILDINGS[isPlaceTool(t) ? placeTemplate(t, chosen) : t];
  const kind = roadKindOf(t, material);
  const road = kind ? ROAD_KINDS[kind] : null;
  let reach: string | null = null;
  const own = (UI as Record<string, BuildingUi | undefined>)[t]?.tool;
  if (isService(t)) reach = L(`Охват ${SERVICES[t].reach} м по дорогам`, `Reach ${SERVICES[t].reach} m by road`);
  else if (own?.reach) reach = own.reach();
  else if (b?.store) reach = L(`Вмещает: ${roomText(b.store)}`, `Holds: ${roomText(b.store)}`);
  return {
    tool: t,
    label: toolLabel(t),
    purpose: (kind && KIND_PURPOSE[kind]) || (own?.purpose ?? PURPOSE[t] ?? ""),
    labor: road ? L(`${perMetre(road.labor)} чел.-ч на метр`, `${perMetre(road.labor)} person-h per metre`) : b ? `${num(b.labor)} ${L("чел.-ч", "person-h")}` : null,
    materials: b ? materialList(b.materials) : road?.stone ? [{ icon: "stone", text: L(`${perMetre(road.stone)} т на метр`, `${perMetre(road.stone)} t per metre`) }] : [],
    jobs: b && b.jobs > 0 ? b.jobs : null,
    site: (kind && KIND_SITE[kind]) || (own?.site ?? SITE[t] ?? (b ? L("У построенной дороги, на свободных участках", "By a built road, on free plots") : L("На карте", "On the map"))),
    reach,
  };
}

// Which tool a key code selects, given the active category; null for keys the bar does not use.
export function toolForKey(code: string, category: CategoryId): Tool | null {
  if (code === DEMOLISH_KEY) return "bulldoze";
  const i = ITEM_KEYS.indexOf(code as (typeof ITEM_KEYS)[number]);
  if (i < 0) return null;
  return CATEGORIES.find((c) => c.id === category)?.tools[i] ?? null;
}
