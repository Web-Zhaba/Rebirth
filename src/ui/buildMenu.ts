import { FIELD, FOOD_RATE } from "../sim/fields";
import { workLength } from "../sim/levers";
import { DIG } from "../sim/excavation";
import { CLEARING } from "../sim/clearing";
import { PLACE_MIN } from "../sim/growth";
import { BUILDINGS, STORES, type Materials, type StoreGroup, type StoreRoom } from "../sim/buildings";
import { ADMIN } from "../sim/governance";
import { ROAD_KINDS } from "../sim/roads";
import { SERVICES, isService } from "../sim/services";
import { isPlaceTool, placeTemplate, placeVariant, roadKindOf, roadMaterial, SITE_RADIUS, type MaterialTool, type Tool } from "../map/tools";
import type { RoadKind } from "../sim/types";
import type { IconName } from "./icons";
import { decimal, L } from "../i18n";

export type CategoryId = "roads" | "zones" | "food" | "farm" | "services" | "past";

export interface Category {
  id: CategoryId;
  label: string;
  tools: Tool[]; // up to 8, picked by Q W E R T Y U I
}

export const CATEGORIES: Category[] = [
  { id: "roads", label: L("Дороги", "Roads"), tools: ["path", "dirt", "footbridge", "bridge", "bulldoze", "restore"] },
  { id: "zones", label: L("Зоны", "Zones"), tools: ["res", "craft", "trade", "field", "clearing", "clear"] },
  { id: "food", label: L("Еда", "Food"), tools: ["gumno", "garden", "hunter", "fisher", "forager", "orchard", "apiary"] },
  { id: "farm", label: L("Ресурсы", "Resources"), tools: ["woodcutter", "sawpit", "quarry", "barn", "cellar"] },
  { id: "services", label: L("Службы", "Services"), tools: ["well", "market", "chapel", "school", "healer", "townhall"] },
  { id: "past", label: L("Прошлое", "Past"), tools: ["dig", "restored"] },
];

// Physical key codes (layout independent: Q is the key left of W also on a Russian layout).
export const ITEM_KEYS = ["KeyQ", "KeyW", "KeyE", "KeyR", "KeyT", "KeyY", "KeyU", "KeyI"] as const;
export const ITEM_KEY_LABEL = ["Q", "W", "E", "R", "T", "Y", "U", "I"] as const;
export const CATEGORY_KEYS = ["F1", "F2", "F3", "F4", "F5", "F6"] as const;
export const DEMOLISH_KEY = "KeyB";

export const categoryOf = (t: Tool): Category => CATEGORIES.find((c) => c.tools.includes(t))!;

export const TOOL_ICON: Record<Tool, IconName> = {
  path: "path",
  dirt: "dirt",
  footbridge: "footbridge",
  bridge: "bridge",
  bulldoze: "bulldoze",
  restore: "street",
  res: "res",
  craft: "craft",
  trade: "trade",
  field: "field",
  clearing: "clearing",
  clear: "eraser",
  gumno: "gumno",
  woodcutter: "woodcutter",
  sawpit: "sawpit",
  quarry: "quarry",
  fisher: "fisher",
  garden: "garden",
  hunter: "hunter",
  forager: "forager",
  orchard: "orchard",
  apiary: "apiary",
  cellar: "cellar",
  barn: "barn",
  well: "well",
  market: "market",
  chapel: "chapel",
  school: "school",
  healer: "healer",
  townhall: "townhall",
  dig: "dig",
  restored: "monument",
};

const TOOL_LABEL: Partial<Record<Tool, string>> = {
  path: L("Тропа", "Path"),
  dirt: L("Дорога", "Road"),
  footbridge: L("Канатный мостик", "Rope footbridge"),
  bridge: L("Мост", "Bridge"),
  bulldoze: L("Снос", "Demolish"),
  restore: L("Старые улицы", "Old streets"),
  res: L("Жильё", "Housing"),
  craft: L("Ремесло", "Crafts"),
  trade: L("Торговля", "Trade"),
  field: L("Поле", "Field"),
  clearing: L("Вырубка", "Clearing"),
  clear: L("Снять зону", "Clear zone"),
  barn: L("Склад", "Storehouse"),
  townhall: L("Управа", "Administration"),
};

export const toolLabel = (t: Tool): string => TOOL_LABEL[t] ?? BUILDINGS[t].name;

const PURPOSE: Record<Tool, string> = {
  path: L("Дешёвая тропа: по ней ходят пешком, ставить дома можно рядом", "A cheap path: people walk on it; houses can go beside it"),
  dirt: L("Грунтовая дорога: шире и ровнее тропы, по ней возят грузы", "Dirt road: wider and smoother than a path, carts haul goods on it"),
  footbridge: L("Подвесной мостик над водой: только для пешеходов, узкий и лёгкий", "A rope footbridge over water: pedestrians only, narrow and light"),
  bridge: L("Широкий мост на сваях над водой: по нему проедут грузы", "A wide bridge on piles over water: carts can cross it"),
  bulldoze: L("Снести участок дороги вместе с планами вдоль него", "Demolish a road section along with the plans beside it"),
  restore: L("Проложить заново раскопанную улицу целиком: старая тропа станет тропой, улица — дорогой", "Rebuild an excavated street whole: an old path becomes a path, a street becomes a road"),
  res: L("Размечает участки под жильё: сюда придут новые семьи", "Zones plots for housing: new families will come here"),
  craft: L("Размечает участки под мастерские: ткацкая (одежда), гончарня (посуда), столярня (утварь), кузница (инструменты)", "Zones plots for workshops: weaving (clothing), pottery (dishes), carpentry (furnishings), smithy (tools)"),
  trade: L("Размечает участки под магазины и таверну", "Zones plots for shops and a tavern"),
  field: L("Поле: контур для зерна, его обрабатывают фермеры", "Field: an outline for grain, worked by farmers"),
  clearing: L("Вырубка леса: брёвна на склад, на месте леса будет луг", "Forest clearing: logs to the store, meadow where the forest was"),
  clear: L("Снимает разметку зоны, поле или вырубку, которую ещё не взялись делать", "Removes zoning, a field, or a clearing nobody has started on yet"),
  gumno: L("Ферма: даёт работу на полях рядом и хранит урожай", "Farm: provides work on the nearby fields and stores the harvest"),
  woodcutter: L("Валит лес вокруг и приносит брёвна на склад", "Fells the forest around and brings logs to the store"),
  sawpit: L("Пилит брёвна в доски", "Saws logs into planks"),
  quarry: L("Добывает камень", "Quarries stone"),
  fisher: L("Ловит рыбу, еда без полей", "Catches fish: food without fields"),
  garden: L("Огород у дома: овощи летом и осенью, зимой не даёт ничего", "A garden by the house: vegetables in summer and autumn, nothing in winter"),
  hunter: L("Охотник приносит дичь, зимой и осенью больше всего", "The hunter brings game, most of all in winter and autumn"),
  forager: L("Ягоды, грибы и орехи: летом и осенью, весной немного, зимой и под снегом ничего", "Berries, mushrooms and nuts: summer and autumn, a little in spring, nothing in winter or under snow"),
  orchard: L("Фруктовый сад: плодоносит через год после посадки, осенью; заморозки в цвету и засуха снижают урожай", "Fruit orchard: bears fruit in autumn from a year after planting; frost at blossom and drought cut the yield"),
  apiary: L("Пасека: мёд летом и осенью, пчёлы летают только в тёплую сухую тихую погоду", "Apiary: honey in summer and autumn; bees fly only in warm, dry, calm weather"),
  barn: L("Склад: амбар для еды, склад леса, склад камня или товарный склад. Производства возят выработку на ближайший склад с местом, стройки и дома берут из ближайшего: чем ближе склад, тем меньше времени уходит на подвоз", "Storehouse: a barn for food, a timber yard, a stone yard or a warehouse. Producers cart their output to the nearest store with room, sites and homes fetch from the nearest one: the closer the store, the less time the carting takes"),
  cellar: L("Погреб: хранит запасы лучше склада, меньше портится в жару и сырость", "Cellar: keeps stores better than a storehouse, less spoils in heat and damp"),
  well: L("Вода рядом с домами: настроение и здоровье", "Water near the houses: mood and health"),
  market: L("Раздаёт товары по домам и радует людей", "Hands out goods to the houses and pleases people"),
  chapel: L("Место для общей жизни: настроение людей", "A place for community life: people’s mood"),
  school: L("Учит детей грамоте, грамотные работают лучше", "Teaches children to read; literate people work better"),
  healer: L("Лечит: меньше смертей, настроение выше", "Heals: fewer deaths, higher mood"),
  townhall: L(`Управление поселением: без управ работа замедляется, когда жителей больше ${ADMIN.elders}. Ратуша (одна на город) справляется ещё с ${ADMIN.room.townhall} жителями, каждая районная управа — с ${ADMIN.room.office}, пока в них работают писари`, `Running the settlement: without offices work slows once there are more than ${ADMIN.elders} residents. A town hall (one per town) manages ${ADMIN.room.townhall} more, each district office ${ADMIN.room.office}, while clerks work in them`),
  dig: L("Раскоп на месте старых построек: находки для тетради, камень от фундаментов", "A dig on the site of old buildings: finds for the notebook, stone from foundations"),
  restored: L("Сохранить старую постройку памятником на её фундаменте: без жителей и работы, рядом людям лучше и земля дороже", "Keep an old building as a monument on its foundation: no residents or jobs; people nearby feel better and land is worth more"),
};

const SITE: Partial<Record<Tool, string>> = {
  path: L("Между двумя точками на суше, уклон не круче 25 %", "Between two points on land, slope up to 25%"),
  dirt: L("Между двумя точками на суше, уклон не круче 12 %", "Between two points on land, slope up to 12%"),
  footbridge: L("Через воду (пролёт до 25 м) или по суше, уклон не круче 30 %", "Across water (span up to 25 m) or on land, slope up to 30%"),
  bridge: L("Через воду (пролёт до 30 м) или по суше, уклон не круче 10 %", "Across water (span up to 30 m) or on land, slope up to 10%"),
  woodcutter: L(`В лесу: от ${Math.round(PLACE_MIN.forest * 100)} % леса в ${SITE_RADIUS.woodcutter} м вокруг`, `In forest: at least ${Math.round(PLACE_MIN.forest * 100)}% forest within ${SITE_RADIUS.woodcutter} m`),
  fisher: L(`У воды: от ${Math.round(PLACE_MIN.water * 100)} % воды в ${SITE_RADIUS.fisher} м вокруг`, `By water: at least ${Math.round(PLACE_MIN.water * 100)}% water within ${SITE_RADIUS.fisher} m`),
  forager: L(`В лесу: от ${Math.round(PLACE_MIN.foragerForest * 100)} % леса в ${SITE_RADIUS.forager} м вокруг`, `In forest: at least ${Math.round(PLACE_MIN.foragerForest * 100)}% forest within ${SITE_RADIUS.forager} m`),
  quarry: L("Не на воде и не на болоте; камень добывается на любой суше", "Not on water or marsh; stone can be quarried on any land"),
  orchard: L("Не на воде и не на болоте", "Not on water or marsh"),
  apiary: L("Не на воде и не на болоте", "Not on water or marsh"),
  clearing: L(`Контур до ${CLEARING.maxArea / 10000} га, не дальше ${CLEARING.reach} м от построенной дороги`, `An outline up to ${CLEARING.maxArea / 10000} ha, within ${CLEARING.reach} m of a built road`),
  field: L("Замкнутый контур на суше, не через дорогу и не поверх другого поля", "A closed outline on land, not across a road or over another field"),
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
  if (isService(t)) reach = L(`Охват ${SERVICES[t].reach} м по дорогам`, `Reach ${SERVICES[t].reach} m by road`);
  else if (t === "gumno") reach = L(`Поля до ${FIELD.radius} м от фермы`, `Fields within ${FIELD.radius} m of the farm`);
  else if (t === "woodcutter" || t === "fisher" || t === "forager") reach = L(`Радиус ${SITE_RADIUS[t]} м`, `Radius ${SITE_RADIUS[t]} m`);
  else if (b && STORES[b.id]) reach = L(`Вмещает: ${roomText(STORES[b.id])}`, `Holds: ${roomText(STORES[b.id])}`);
  else if (t === "dig") reach = L(`Вскрывает ${DIG.startRadius} м, потом растёт до ${DIG.maxRadius} м и снимается сам`, `Opens ${DIG.startRadius} m, then grows to ${DIG.maxRadius} m and removes itself`);
  else if (t === "garden" || t === "hunter" || t === "orchard" || t === "apiary") {
    // The best season with every job filled, a full working day.
    const rate = FOOD_RATE[t];
    reach = L(`Даёт до ${Math.round(Math.max(...rate.season) * rate.kgHour * BUILDINGS[t].jobs * workLength())} кг еды в день`, `Yields up to ${Math.round(Math.max(...rate.season) * rate.kgHour * BUILDINGS[t].jobs * workLength())} kg of food a day`);
  }
  return {
    tool: t,
    label: toolLabel(t),
    purpose: (kind && KIND_PURPOSE[kind]) || PURPOSE[t],
    labor: road ? L(`${perMetre(road.labor)} чел.-ч на метр`, `${perMetre(road.labor)} person-h per metre`) : b ? `${num(b.labor)} ${L("чел.-ч", "person-h")}` : null,
    materials: b ? materialList(b.materials) : road?.stone ? [{ icon: "stone", text: L(`${perMetre(road.stone)} т на метр`, `${perMetre(road.stone)} t per metre`) }] : [],
    jobs: b && b.jobs > 0 ? b.jobs : null,
    site: (kind && KIND_SITE[kind]) || (SITE[t] ?? (b ? L("У построенной дороги, на свободных участках", "By a built road, on free plots") : L("На карте", "On the map"))),
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
