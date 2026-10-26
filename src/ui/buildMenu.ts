import { FIELD, FOOD_RATE } from "../sim/fields";
import { workLength } from "../sim/levers";
import { DIG } from "../sim/excavation";
import { CLEARING } from "../sim/clearing";
import { PLACE_MIN } from "../sim/growth";
import { BUILDINGS, type Materials } from "../sim/buildings";
import { isRoadKind, ROAD_KINDS } from "../sim/roads";
import { SERVICES, isService } from "../sim/services";
import { SITE_RADIUS, type Tool } from "../map/tools";
import type { IconName } from "./icons";

export type CategoryId = "roads" | "zones" | "food" | "farm" | "services" | "past";

export interface Category {
  id: CategoryId;
  label: string;
  tools: Tool[]; // up to 6, picked by Q W E R T Y
}

export const CATEGORIES: Category[] = [
  { id: "roads", label: "Дороги", tools: ["path", "dirt", "footbridge", "bridge", "bulldoze", "restore"] },
  { id: "zones", label: "Зоны", tools: ["res", "craft", "trade", "field", "clearing", "clear"] },
  { id: "food", label: "Еда", tools: ["gumno", "garden", "hunter", "fisher", "forager", "orchard"] },
  { id: "farm", label: "Ресурсы", tools: ["woodcutter", "sawpit", "quarry", "barn", "cellar", "apiary"] },
  { id: "services", label: "Службы", tools: ["well", "market", "chapel", "school", "healer"] },
  { id: "past", label: "Прошлое", tools: ["dig"] },
];

// Physical key codes (layout independent: Q is the key left of W also on a Russian layout).
export const ITEM_KEYS = ["KeyQ", "KeyW", "KeyE", "KeyR", "KeyT", "KeyY"] as const;
export const ITEM_KEY_LABEL = ["Q", "W", "E", "R", "T", "Y"] as const;
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
  dig: "dig",
};

const TOOL_LABEL: Partial<Record<Tool, string>> = {
  path: "Тропа",
  dirt: "Дорога",
  footbridge: "Канатный мостик",
  bridge: "Свайный мост",
  bulldoze: "Снос",
  restore: "Старые улицы",
  res: "Жильё",
  craft: "Ремесло",
  trade: "Торговля",
  field: "Поле",
  clearing: "Вырубка",
  clear: "Снять зону",
};

export const toolLabel = (t: Tool): string => TOOL_LABEL[t] ?? BUILDINGS[t].name;

const PURPOSE: Record<Tool, string> = {
  path: "Дешёвая тропа: по ней ходят пешком, ставить дома можно рядом",
  dirt: "Грунтовая дорога: шире и ровнее тропы, по ней возят грузы",
  footbridge: "Подвесной мостик над водой: только для пешеходов, узкий и лёгкий",
  bridge: "Широкий мост на сваях над водой: по нему проедут грузы",
  bulldoze: "Снести участок дороги вместе с планами вдоль него",
  restore: "Проложить заново раскопанную улицу целиком: старая тропа станет тропой, улица — дорогой",
  res: "Размечает участки под жильё: сюда придут новые семьи",
  craft: "Размечает участки под мастерские: кузница, столярня, гончарня",
  trade: "Размечает участки под магазины и таверну",
  field: "Поле: контур для зерна, его обрабатывают фермеры",
  clearing: "Вырубка леса: брёвна на склад, на месте леса будет луг",
  clear: "Снимает разметку зоны, поле или вырубку, которую ещё не взялись делать",
  gumno: "Ферма: даёт работу на полях рядом и хранит урожай",
  woodcutter: "Валит лес вокруг и приносит брёвна на склад",
  sawpit: "Пилит брёвна в доски",
  quarry: "Добывает камень",
  fisher: "Ловит рыбу, еда без полей",
  garden: "Огород у дома: овощи летом и осенью, зимой не даёт ничего",
  hunter: "Охотник приносит дичь, зимой и осенью больше всего",
  forager: "Ягоды, грибы и орехи: летом и осенью, весной немного, зимой и под снегом ничего",
  orchard: "Фруктовый сад: плодоносит через год после посадки, осенью; заморозки в цвету и засуха снижают урожай",
  apiary: "Пасека: мёд летом и осенью, пчёлы летают только в тёплую сухую тихую погоду",
  barn: "Склад: добавляет места для запасов еды",
  cellar: "Погреб: хранит запасы лучше склада, меньше портится в жару и сырость",
  well: "Вода рядом с домами: настроение и здоровье",
  market: "Раздаёт товары по домам и радует людей",
  chapel: "Место для общей жизни: настроение людей",
  school: "Учит детей грамоте, грамотные работают лучше",
  healer: "Лечит: меньше смертей, настроение выше",
  dig: "Раскоп на месте старых построек: находки для тетради, камень от фундаментов",
};

const SITE: Partial<Record<Tool, string>> = {
  path: "Между двумя точками на суше, уклон не круче 25 %",
  dirt: "Между двумя точками на суше, уклон не круче 12 %",
  footbridge: "Через воду или по суше, уклон не круче 30 %",
  bridge: "Через воду или по суше, уклон не круче 10 %",
  woodcutter: `В лесу: от ${Math.round(PLACE_MIN.forest * 100)} % леса в ${SITE_RADIUS.woodcutter} м вокруг`,
  fisher: `У воды: от ${Math.round(PLACE_MIN.water * 100)} % воды в ${SITE_RADIUS.fisher} м вокруг`,
  forager: `В лесу: от ${Math.round(PLACE_MIN.foragerForest * 100)} % леса в ${SITE_RADIUS.forager} м вокруг`,
  quarry: "Не на воде и не на болоте; камень добывается на любой суше",
  orchard: "Не на воде и не на болоте",
  apiary: "Не на воде и не на болоте",
  clearing: `Контур до ${CLEARING.maxArea / 10000} га, не дальше ${CLEARING.reach} м от построенной дороги`,
  field: "Замкнутый контур на суше, не через дорогу и не поверх другого поля",
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
  { key: "logs", icon: "log", unit: "м³" },
  { key: "planks", icon: "planks", unit: "м³" },
  { key: "stone", icon: "stone", unit: "т" },
];

export const num = (n: number): string => String(Math.round(n * 10) / 10).replace(".", ",");

export function materialList(m: Materials): { icon: IconName; text: string }[] {
  return MAT_ICON.filter((x) => m[x.key] > 0).map((x) => ({ icon: x.icon, text: `${num(m[x.key])} ${x.unit}` }));
}

// Everything the hover card shows, taken from the sim tables.
export function toolInfo(t: Tool): ToolInfo {
  const b = BUILDINGS[t];
  const road = isRoadKind(t) ? ROAD_KINDS[t] : null;
  let reach: string | null = null;
  if (isService(t)) reach = `Охват ${SERVICES[t].reach} м по дорогам`;
  else if (t === "gumno") reach = `Поля до ${FIELD.radius} м от фермы`;
  else if (t === "woodcutter" || t === "fisher" || t === "forager") reach = `Радиус ${SITE_RADIUS[t]} м`;
  else if (t === "dig") reach = `Вскрывает ${DIG.startRadius} м, потом растёт до ${DIG.maxRadius} м и снимается сам`;
  else if (t === "garden" || t === "hunter" || t === "orchard" || t === "apiary") {
    // The best season with every job filled, a full working day.
    const rate = FOOD_RATE[t];
    reach = `Даёт до ${Math.round(Math.max(...rate.season) * rate.kgHour * BUILDINGS[t].jobs * workLength())} кг еды в день`;
  }
  return {
    tool: t,
    label: toolLabel(t),
    purpose: PURPOSE[t],
    labor: road ? `${num(road.labor)} чел.-ч на метр` : b ? `${num(b.labor)} чел.-ч` : null,
    materials: b ? materialList(b.materials) : [],
    jobs: b && b.jobs > 0 ? b.jobs : null,
    site: SITE[t] ?? (b ? "У построенной дороги, на свободных участках" : "На карте"),
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
