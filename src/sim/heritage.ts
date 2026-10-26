import { INSIGHTS, type InsightDef } from "./tech";
import type { ProgressState } from "./types";
import type { DomainId } from "./domains";

// Which OpenMapTiles POI classes mark a notable old building and which knowledge domain it feeds
// (PLAN-research.ru.md section 3). Static; the values were checked against real z14 tiles. A game
// abstraction: the player-facing text never claims a historical cause.

// POI `class` -> domain, when the class alone is enough.
const BY_CLASS: Record<string, DomainId> = {
  castle: "build", // castle/castle, castle/ruins
  monument: "build",
  town_hall: "build", // town_hall/townhall, courthouse, public_building
  school: "learn",
  college: "learn", // college/college, college/university
  library: "learn",
  museum: "learn",
  theatre: "learn",
  place_of_worship: "care",
  hospital: "care", // hospital/hospital, hospital/clinic
  doctors: "care",
  pharmacy: "care",
  harbor: "trade",
  ferry_terminal: "trade",
  bank: "trade",
};

// "class/subclass" where the subclass decides: [kind, domain] picks it, null drops a subclass of an accepted class.
// The kind is what is stored as a foundation's `cls`, so the domain can be read back from it alone.
const BY_SUB: Record<string, [string, DomainId] | null> = {
  "grocery/marketplace": ["marketplace", "trade"],
  "grocery/department_store": ["department_store", "trade"],
  "shop/mall": ["mall", "trade"],
  "shop/wholesale": ["wholesale", "trade"],
  "railway/station": ["station", "trade"],
  "railway/halt": ["halt", "trade"],
  "bus/bus_station": ["bus_station", "trade"],
  "car/car_repair": ["car_repair", "craft"],
  "school/kindergarten": null,
  "town_hall/community_centre": null,
};

const BY_KIND: Record<string, DomainId> = Object.fromEntries(Object.values(BY_SUB).flatMap((v) => (v ? [v] : [])));

// The stored kind of a curated POI, or null when it is not one.
export function heritageKind(cls: string, subclass?: string): string | null {
  if (subclass) {
    const k = `${cls}/${subclass}`;
    if (k in BY_SUB) return BY_SUB[k] ? BY_SUB[k]![0] : null;
  }
  return cls in BY_CLASS ? cls : null;
}

// Domain of a POI class (with its subclass) or of a stored kind; null when not curated.
export function heritageDomain(cls: string | undefined, subclass?: string): DomainId | null {
  if (!cls) return null;
  const kind = subclass ? heritageKind(cls, subclass) : cls;
  if (kind === null) return null;
  return BY_CLASS[kind] ?? BY_KIND[kind] ?? null;
}

// A typed (notable) foundation: its stored kind is in the table.
export const isHeritage = (f: { cls?: string }): boolean => !!f.cls && (f.cls in BY_CLASS || f.cls in BY_KIND);

// ---------- restoration (PLAN-research.ru.md section 7) ----------
// Pure data and rules shared by the worker and the panel.

// What a kind is called on the map and in the panel (neutral wording, no historical claim).
export const KIND_NAME: Record<string, string> = {
  castle: "Замок",
  monument: "Памятный знак",
  town_hall: "Здание управления",
  school: "Школа",
  college: "Училище",
  library: "Библиотека",
  museum: "Музей",
  theatre: "Театр",
  place_of_worship: "Культовое здание",
  hospital: "Больница",
  doctors: "Медицинский кабинет",
  pharmacy: "Аптека",
  harbor: "Пристань",
  ferry_terminal: "Паромная пристань",
  bank: "Банк",
  marketplace: "Рынок",
  department_store: "Универмаг",
  mall: "Торговый центр",
  wholesale: "Оптовый склад",
  station: "Вокзал",
  halt: "Остановочный пункт",
  bus_station: "Автовокзал",
  car_repair: "Автомастерская",
};
export const kindName = (cls: string | undefined): string => (cls && KIND_NAME[cls]) || "Старая постройка";

// The template a kind works as in the "working" mode; every other kind is a monument only.
const WORK_TEMPLATE: Record<string, string> = {
  place_of_worship: "chapel",
  school: "school",
  college: "school",
  hospital: "healer",
  doctors: "healer",
  pharmacy: "healer",
  marketplace: "market",
  department_store: "market",
  mall: "market",
  wholesale: "market",
  car_repair: "carpentry",
};
export const workTemplate = (cls: string | undefined): string | null => (cls && WORK_TEMPLATE[cls]) || null;

export const siteTitle = (f: { cls?: string; name?: string }): string => f.name ?? kindName(f.cls);

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
export const MIN_HEIGHT = 4;
export const MAX_RESTORED_HEIGHT = 25;
export const restoredHeight = (height: number | undefined, fallback: number): number => clamp(height ?? fallback, MIN_HEIGHT, MAX_RESTORED_HEIGHT);

// Cost of a restoration by the foundation's area: person-hours and m3 / m3 / t.
export function restoreCost(area: number): { labor: number; logs: number; planks: number; stone: number } {
  const a = Math.max(0, area);
  return { labor: clamp(40 + 0.5 * a, 60, 1200), logs: clamp(a / 20, 2, 120), planks: clamp(a / 40, 0.5, 60), stone: clamp(a / 30, 1, 80) };
}

// Scarcity (section 5): the fewer notable buildings a revealed area holds, the more each restoration is worth.
export const SCARCITY = { target: 20, min: 1, max: 3, cell: 10 }; // target: typed foundations per km2 that count as plain 1
export const WORKING_SHARE = 0.5; // a working building counts half

const mulCache = new WeakMap<object, number>();

// Area in m2 covered by the discs (a 10 m grid, so overlapping discs count once).
export function discArea(discs: readonly { x: number; y: number; r: number }[]): number {
  const g = SCARCITY.cell;
  const cells = new Set<number>();
  for (const d of discs) {
    const x0 = Math.floor((d.x - d.r) / g);
    const x1 = Math.floor((d.x + d.r) / g);
    const y0 = Math.floor((d.y - d.r) / g);
    const y1 = Math.floor((d.y + d.r) / g);
    for (let i = x0; i <= x1; i++) for (let j = y0; j <= y1; j++) if (Math.hypot((i + 0.5) * g - d.x, (j + 0.5) * g - d.y) <= d.r) cells.add(i * 1048576 + j);
  }
  return cells.size * g * g;
}

// m = clamp(20 / density, 1, 3), density = typed foundations per km2 of the revealed area; 1 while nothing is revealed.
export function scarcity(finds: { foundations: readonly { cls?: string }[]; revealed: readonly { x: number; y: number; r: number }[] }): number {
  const hit = mulCache.get(finds);
  if (hit !== undefined) return hit;
  let m = 1;
  if (finds.revealed.length > 0) {
    const km2 = discArea(finds.revealed) / 1e6;
    const typed = finds.foundations.filter(isHeritage).length;
    const density = km2 > 0 ? typed / km2 : Infinity;
    m = density <= 0 ? SCARCITY.max : Math.round(clamp(SCARCITY.target / density, SCARCITY.min, SCARCITY.max) * 100) / 100;
  }
  mulCache.set(finds, m);
  return m;
}
export const restoreWeightOf = (mode: "monument" | "working", mul: number): number => Math.round((mode === "monument" ? mul : mul * WORKING_SHARE) * 100) / 100;

// The insight a restoration in `domain` grants: the first of the domain not held and not used up; with none left, the
// first such one of a domain that has no real sites (farm, then craft), so those domains stay reachable.
export function nextInsight(p: Pick<ProgressState, "insights" | "techs">, domain: DomainId): InsightDef | null {
  const open = (d: DomainId) => INSIGHTS.find((i) => i.domain === d && !p.insights.includes(i.id) && !(i.tech && p.techs.includes(i.tech)));
  return open(domain) ?? open("farm") ?? open("craft") ?? null;
}

// Monuments (finished, in "monument" mode) make the houses within this reach happier and the land dearer.
export const MONUMENT = { radius: 200, mood: 1, land: 5, landCap: 15 };
