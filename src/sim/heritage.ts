import { INSIGHTS, type InsightDef } from "./tech";
import type { FoundFoundation, ProgressState, SimState } from "./types";
import type { DomainId } from "./domains";
import { L } from "../i18n";

// Which OpenMapTiles POI classes mark an old building of a known kind and which knowledge domain it feeds
// (PLAN-research.ru.md section 3, docs/PLAN-restoration.md section 3). Static; the values were checked against real z14
// tiles. A game abstraction: the player-facing text never claims a historical cause.
//
// Two groups of kinds: candidates for a unique building (worship, schools, halls, a station...), which the player alone
// decides about, and typical ones (shops, banks, pharmacies...), a chain or an everyday service, which grow like any
// other lot and bring a small bonus "as it was".

// POI `class` -> domain of a candidate, when the class alone is enough.
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
  harbor: "trade",
  ferry_terminal: "trade",
};

// "class/subclass" where the subclass decides: [kind, domain] picks a candidate, null drops a subclass of an accepted class.
// The kind is what is stored as a foundation's `cls`, so the domain can be read back from it alone.
const BY_SUB: Record<string, [string, DomainId] | null> = {
  "railway/station": ["station", "trade"],
  "school/kindergarten": null,
  "town_hall/community_centre": null,
};

const BY_KIND: Record<string, DomainId> = Object.fromEntries(Object.values(BY_SUB).flatMap((v) => (v ? [v] : [])));

// Typical kinds: "class/subclass" first, then the class, -> the stored kind; and each kind's domain.
const TYPICAL_SUB: Record<string, string> = {
  "grocery/marketplace": "marketplace",
  "shop/mall": "mall",
  "grocery/department_store": "department_store",
  "railway/halt": "halt",
  "bus/bus_station": "bus_station",
  "car/car_repair": "car_repair",
};
const TYPICAL_CLASS: Record<string, string> = { pharmacy: "pharmacy", doctors: "doctors", bank: "bank", shop: "shop", grocery: "shop", clothing_store: "shop", bakery: "shop", butcher: "shop" };
const TYPICAL_DOMAIN: Record<string, DomainId> = {
  shop: "trade",
  mall: "trade",
  department_store: "trade",
  marketplace: "trade",
  bank: "trade",
  wholesale: "trade", // only in old saves
  halt: "trade",
  bus_station: "trade",
  pharmacy: "care",
  doctors: "care",
  car_repair: "craft",
};

// The stored kind of a POI of a known kind (a candidate or a typical one), or null.
export function heritageKind(cls: string, subclass?: string): string | null {
  if (subclass) {
    const k = `${cls}/${subclass}`;
    if (k in BY_SUB) return BY_SUB[k] ? BY_SUB[k]![0] : null;
    if (k in TYPICAL_SUB) return TYPICAL_SUB[k];
  }
  if (cls in BY_CLASS) return cls;
  return TYPICAL_CLASS[cls] ?? null;
}

// Domain of a POI class (with its subclass) or of a stored kind; null when the kind is not known.
export function heritageDomain(cls: string | undefined, subclass?: string): DomainId | null {
  if (!cls) return null;
  const kind = subclass ? heritageKind(cls, subclass) : cls;
  if (kind === null) return null;
  return BY_CLASS[kind] ?? BY_KIND[kind] ?? TYPICAL_DOMAIN[kind] ?? null;
}

// A typical stored kind.
export const isTypicalKind = (cls: string | undefined): boolean => !!cls && cls in TYPICAL_DOMAIN;

// A stored kind that is a candidate for a unique building.
export const isCurated = (cls: string | undefined): boolean => !!cls && (cls in BY_CLASS || cls in BY_KIND);

// A notable site: a candidate's foundation, left to the player (zones and regular lots keep off it until it is lost).
export const isHeritage = (f: { cls?: string }): boolean => isCurated(f.cls);

// Domain of a stored foundation's kind, typical kinds included.
export const siteDomain = (cls: string | undefined): DomainId | null => heritageDomain(cls);

// ---------- tiers (docs/PLAN-restoration.md section 3) ----------
// Ordinary (no known kind): restoring gives the function and counts toward the place's recognisability. Typical (a
// typical kind, or a candidate that is nameless or whose name repeats in the revealed area: a chain): a small bonus,
// less for each further one. Unique: an idea, a chronicle line, and it works as a monument. A Wikipedia article of the
// notebook with the building's name is the strongest sign of a unique one.

export type Tier = "ordinary" | "typical" | "unique";
export interface TierContext {
  names: Map<string, number>; // normalised name -> named places of the revealed area that carry it
  titles: Map<string, ([number, number] | null)[]>; // normalised title -> where the notebook's articles of it point (null: unknown)
}

// An article counts for a building when its point lies this close to the ring's centre (Wikipedia points are rough).
export const ARTICLE_NEAR = 400; // m

type Ringed = { ring?: readonly [number, number][] };
const centreOf = (r: readonly [number, number][]): [number, number] => [r.reduce((a, p) => a + p[0], 0) / r.length, r.reduce((a, p) => a + p[1], 0) / r.length];

// Is there an article titled with the building's name next to its ring? An article without a known point (older saves)
// counts by its title alone.
export function articleNear(f: { name?: string } & Ringed, ctx: Pick<TierContext, "titles">): boolean {
  if (!f.name) return false;
  const at = ctx.titles.get(normName(f.name));
  if (!at) return false;
  if (!f.ring || f.ring.length === 0) return true;
  const [cx, cy] = centreOf(f.ring);
  return at.some((p) => p === null || Math.hypot(p[0] - cx, p[1] - cy) <= ARTICLE_NEAR);
}

export const normName = (s: string): string => s.trim().toLowerCase().replace(/ё/g, "е");

const ctxCache = new WeakMap<object, WeakMap<object, TierContext>>();
export function tierContext(finds: Pick<SimState["finds"], "pois">, articles: readonly { title: string; x?: number; y?: number }[]): TierContext {
  let inner = ctxCache.get(finds.pois);
  if (!inner) ctxCache.set(finds.pois, (inner = new WeakMap()));
  const hit = inner.get(articles);
  if (hit) return hit;
  const names = new Map<string, number>();
  for (const p of finds.pois) {
    const n = normName(p.name);
    names.set(n, (names.get(n) ?? 0) + 1);
  }
  const titles = new Map<string, ([number, number] | null)[]>();
  for (const a of articles) {
    const k = normName(a.title);
    const list = titles.get(k) ?? [];
    list.push(a.x !== undefined && a.y !== undefined ? [a.x, a.y] : null);
    titles.set(k, list);
  }
  const ctx: TierContext = { names, titles };
  inner.set(articles, ctx);
  return ctx;
}

export function tierOf(f: Pick<FoundFoundation, "cls" | "name"> & Ringed, ctx: TierContext): Tier {
  if (!siteDomain(f.cls)) return "ordinary";
  if (isTypicalKind(f.cls)) return "typical";
  if (!f.name) return "typical"; // a nameless building is never unique
  const n = normName(f.name);
  if (articleNear(f, ctx)) return "unique";
  return (ctx.names.get(n) ?? 0) > 1 ? "typical" : "unique";
}

// A typical building "as it was" adds this share of a unique one's research weight, and no idea.
export const TYPICAL_SHARE = 0.25;

// ---------- restoration (PLAN-research.ru.md section 7) ----------
// Pure data and rules shared by the worker and the panel.

// What a kind is called on the map and in the panel (neutral wording, no historical claim).
export const KIND_NAME: Record<string, string> = {
  castle: L("Замок", "Castle"),
  monument: L("Памятный знак", "Memorial"),
  town_hall: L("Здание управления", "Administration building"),
  school: L("Школа", "School"),
  college: L("Училище", "College"),
  library: L("Библиотека", "Library"),
  museum: L("Музей", "Museum"),
  theatre: L("Театр", "Theatre"),
  place_of_worship: L("Культовое здание", "Place of worship"),
  hospital: L("Больница", "Hospital"),
  doctors: L("Медицинский кабинет", "Doctor’s office"),
  pharmacy: L("Аптека", "Pharmacy"),
  harbor: L("Пристань", "Pier"),
  ferry_terminal: L("Паромная пристань", "Ferry pier"),
  bank: L("Банк", "Bank"),
  marketplace: L("Рынок", "Marketplace"),
  department_store: L("Универмаг", "Department store"),
  mall: L("Торговый центр", "Shopping centre"),
  wholesale: L("Оптовый склад", "Warehouse"),
  station: L("Вокзал", "Railway station"),
  halt: L("Остановочный пункт", "Railway halt"),
  bus_station: L("Автовокзал", "Bus station"),
  car_repair: L("Автомастерская", "Car workshop"),
  shop: L("Магазин", "Shop"),
};
export const kindName = (cls: string | undefined): string => (cls && KIND_NAME[cls]) || L("Старая постройка", "Old building");

// The purpose a kind works as; every other kind is kept as a monument.
const WORK_TEMPLATE: Record<string, string> = {
  place_of_worship: "chapel",
  school: "school",
  college: "school",
  hospital: "healer",
  museum: "museum",
  marketplace: "market",
  // typical kinds: a shop of any kind works as a shop (it grows in a trade zone), a pharmacy as an infirmary...
  shop: "shop",
  mall: "shop",
  department_store: "shop",
  bank: "shop",
  pharmacy: "healer",
  doctors: "healer",
  wholesale: "warehouse",
  car_repair: "smithy",
};
export const workTemplate = (cls: string | undefined): string | null => (cls && WORK_TEMPLATE[cls]) || null;

// The purpose that brings a foundation of a known old kind back "as it was" (docs/PLAN-restoration.md section 2): the
// building it worked as, or a monument; null for a foundation of no known kind.
export const asItWasTemplate = (cls: string | undefined): string | null => (siteDomain(cls) ? (workTemplate(cls) ?? "restored") : null);

export const siteTitle = (f: { cls?: string; name?: string }): string => f.name ?? kindName(f.cls);

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

// Scarcity (section 5): the fewer notable buildings a revealed area holds, the more each restoration is worth.
export const SCARCITY = { target: 20, min: 1, max: 3, cell: 10, kindGap: 300 }; // target: typed foundations per km2 that count as plain 1; kindGap: same-kind sites closer than this (m) count once

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

// Curated foundations counted by the scarcity density: several of one kind within kindGap m of each other count once.
export function distinctTyped(foundations: readonly Pick<FoundFoundation, "id" | "cls" | "ring">[]): number {
  const reps = new Map<string, [number, number][]>();
  let n = 0;
  for (const f of [...foundations].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
    if (!f.cls || !isCurated(f.cls) || f.ring.length === 0) continue;
    let cx = 0;
    let cy = 0;
    for (const [x, y] of f.ring) {
      cx += x;
      cy += y;
    }
    cx /= f.ring.length;
    cy /= f.ring.length;
    let list = reps.get(f.cls);
    if (!list) reps.set(f.cls, (list = []));
    if (list.some(([x, y]) => Math.hypot(x - cx, y - cy) <= SCARCITY.kindGap)) continue;
    list.push([cx, cy]);
    n++;
  }
  return n;
}

// m = clamp(20 / density, 1, 3), density = distinct curated foundations per km2 of the revealed area; 1 while nothing is revealed.
export function scarcity(finds: { foundations: readonly Pick<FoundFoundation, "id" | "cls" | "ring">[]; revealed: readonly { x: number; y: number; r: number }[] }): number {
  const hit = mulCache.get(finds);
  if (hit !== undefined) return hit;
  let m = 1;
  if (finds.revealed.length > 0) {
    const km2 = discArea(finds.revealed) / 1e6;
    const typed = distinctTyped(finds.foundations);
    const density = km2 > 0 ? typed / km2 : Infinity;
    m = density <= 0 ? SCARCITY.max : Math.round(clamp(SCARCITY.target / density, SCARCITY.min, SCARCITY.max) * 100) / 100;
  }
  mulCache.set(finds, m);
  return m;
}
// Each further restoration of a kind counts half of the one before: weight x REPEAT^n for n earlier ones.
export const REPEAT = 0.5;
export const repeatFactor = (n: number): number => REPEAT ** Math.max(0, n);
export const restoreWeightOf = (mul: number, earlier = 0): number => Math.round(mul * repeatFactor(earlier) * 100) / 100;

// Sites of `cls` ordered before building `beforeId` (all when absent) that are restoring or restored; lost ones do not count.
// A site without a building counts as earlier.
export function earlierOfKind(s: Pick<SimState, "finds" | "buildings">, cls: string | undefined, selfId: string, beforeId?: number): number {
  if (!cls) return 0;
  const orderOf = new Map<string, number>();
  if (beforeId !== undefined) for (const b of Object.values(s.buildings)) if (b.foundationId && b.asItWas) orderOf.set(b.foundationId, b.id);
  let n = 0;
  for (const f of s.finds.foundations) {
    if (f.id === selfId || f.cls !== cls || (f.state !== "restoring" && f.state !== "restored")) continue;
    if (beforeId === undefined || (orderOf.get(f.id) ?? -1) < beforeId) n++;
  }
  return n;
}

// Kinds that have a restoring or restored site: their other sites are drawn faintly on the ruins layer.
export const doneKinds = (foundations: readonly Pick<FoundFoundation, "cls" | "state">[]): Set<string> =>
  new Set(foundations.flatMap((f) => (f.cls && (f.state === "restoring" || f.state === "restored") ? [f.cls] : [])));

// The insight a restoration in `domain` grants: the first of the domain not held and not used up; with none left, the
// first such one of a domain that has no real sites (farm, then craft), so those domains stay reachable.
export function nextInsight(p: Pick<ProgressState, "insights" | "techs">, domain: DomainId): InsightDef | null {
  const open = (d: DomainId) => INSIGHTS.find((i) => i.domain === d && !p.insights.includes(i.id) && !(i.tech && p.techs.includes(i.tech)));
  return open(domain) ?? open("farm") ?? open("craft") ?? null;
}

// Monuments (finished, of the monument purpose) make the houses within this reach happier and the land dearer.
export const MONUMENT = { radius: 200, mood: 1, landmarkMood: 2, land: 5, landCap: 15 };
