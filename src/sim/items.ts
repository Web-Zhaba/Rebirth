import { centroid, pointInRing } from "./excavation";
import { foundationIndex } from "./foundationLots";
import { normName, siteDomain, TYPICAL_SHARE } from "./heritage";
import type { DomainId } from "./domains";
import type { Building, FindFate, Finds, FoundFoundation, SimState, StoredArticle } from "./types";
import { L } from "../i18n";

// Finds (docs/PLAN-restoration.md section 6). Every find comes from one real feature of the data: a named place gives
// its sign, or the typical object of its kind with its real name; a named street its street sign; a garden old seeds, an
// industrial ground machine parts, a railway its rails, a well its bucket; an article of the notebook with a building's
// name its archive page. The catalogue is derived from the finds the survey recorded; a find is found once a dug
// foundation lies within reach of it (or it belongs to that foundation), so finds lead to places not opened yet. Only
// what the player did with a find is stored (\`Finds.fates\`). Game wording stays neutral: no claim the object existed.

export const FIND = {
  reach: 60, // m from a dug foundation's centroid: the finds of its surroundings turn up
  partsWeight: 0.2, // craft research weight of machine parts studied
  railTools: 5, // tools the metal of melted rails makes
  wellReach: 30, // m: a bucket returns to a well this close
};

export type ItemKind = "sign" | "object" | "street" | "seeds" | "parts" | "rails" | "bucket" | "page";

export interface Item {
  id: string;
  kind: ItemKind;
  name: string; // as shown
  source: "OSM" | "Wikipedia";
  theme: string; // exhibition theme key (sim/museum.ts)
  themeName: string;
  domain: DomainId;
  x: number;
  y: number;
  place?: string; // the foundation it belongs to
  street?: string; // the street it belongs to (id)
  lines?: [number, number][][]; // a street sign: the street's line, for the reach
  usable: boolean; // can be put to use
}

// The typical object of a POI class, with the real name: one object type per class.
const OBJECT: Record<string, (name: string) => string> = {
  post: (n) => L(`Почтовый штемпель отделения «${n}»`, `Postmark of the “${n}” office`),
  railway: (n) => L(`Станционный колокол «${n}»`, `Station bell of “${n}”`),
  school: (n) => L(`Школьный колокольчик «${n}»`, `School bell of “${n}”`),
  college: (n) => L(`Учебный журнал «${n}»`, `Class register of “${n}”`),
  library: (n) => L(`Библиотечный штамп «${n}»`, `Library stamp of “${n}”`),
  place_of_worship: (n) => L(`Колокол «${n}»`, `Bell of “${n}”`),
  pharmacy: (n) => L(`Аптечная склянка «${n}»`, `Pharmacy jar of “${n}”`),
  hospital: (n) => L(`Врачебный саквояж «${n}»`, `Doctor’s bag of “${n}”`),
  bank: (n) => L(`Счёты «${n}»`, `Abacus of “${n}”`),
  town_hall: (n) => L(`Печать «${n}»`, `Seal of “${n}”`),
  bakery: (n) => L(`Хлебная форма «${n}»`, `Bread tin of “${n}”`),
  fire_station: (n) => L(`Пожарный рожок «${n}»`, `Fire horn of “${n}”`),
  museum: (n) => L(`Опись собрания «${n}»`, `Inventory of “${n}”`),
  theatre: (n) => L(`Афиша «${n}»`, `Playbill of “${n}”`),
};

// The domain a find feeds when it has no building of its own.
const KIND_DOMAIN: Record<"seeds" | "parts" | "rails" | "bucket" | "street", DomainId> = { seeds: "farm", parts: "craft", rails: "trade", bucket: "care", street: "build" };

const near = (x: number, y: number, lines: readonly [number, number][][]): number => {
  let best = Infinity;
  for (const l of lines)
    for (let i = 1; i < l.length; i++) {
      const [ax, ay] = l[i - 1];
      const [bx, by] = l[i];
      const dx = bx - ax;
      const dy = by - ay;
      const len2 = dx * dx + dy * dy;
      const t = len2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len2)) : 0;
      best = Math.min(best, Math.hypot(x - ax - t * dx, y - ay - t * dy));
    }
  return best;
};

type CatalogueInput = Pick<SimState, "finds"> & { articles?: readonly StoredArticle[] };
const NO_FEATURES: Finds["features"] = [];
interface Entry {
  features: object;
  streets: object;
  foundations: object;
  articles: readonly StoredArticle[] | undefined;
  out: Item[];
}
const cache = new WeakMap<object, Entry>(); // by the pois list; the other inputs are checked by identity

// Every find the recorded features give, found or not.
export function catalogue(s: CatalogueInput): Item[] {
  const features = s.finds.features ?? NO_FEATURES;
  const hit = cache.get(s.finds.pois);
  if (hit && hit.features === features && hit.streets === s.finds.streets && hit.foundations === s.finds.foundations && hit.articles === s.articles) return hit.out;
  const out: Item[] = [];
  const list = s.finds.foundations;
  const idx = foundationIndex(list);
  const placeOf = (x: number, y: number): FoundFoundation | null => idx.at(x, y);
  const streetNear = (x: number, y: number) => {
    let best: { id: string; name: string; d: number } | null = null;
    for (const t of s.finds.streets) if (t.lines) {
      const d = near(x, y, t.lines);
      if (d <= 30 && (!best || d < best.d)) best = { id: t.id, name: t.name, d };
    }
    return best;
  };
  const placeTheme = (f: FoundFoundation | null, x: number, y: number): Pick<Item, "theme" | "themeName"> => {
    if (f?.name) return { theme: `place:${f.id}`, themeName: f.name };
    const st = streetNear(x, y);
    return st ? { theme: `street:${st.name}`, themeName: st.name } : { theme: "town", themeName: L("Старый город", "The old town") };
  };
  const named = (id: string, name: string, cls: string, x: number, y: number) => {
    const f = placeOf(x, y);
    const obj: ((n: string) => string) | undefined = Object.hasOwn(OBJECT, cls) ? OBJECT[cls] : undefined;
    out.push({
      id: `${obj ? "obj" : "sign"}:${id}`,
      kind: obj ? "object" : "sign",
      name: obj ? obj(name) : L(`Вывеска «${name}»`, `Sign “${name}”`),
      source: "OSM",
      ...placeTheme(f, x, y),
      domain: siteDomain(f?.cls) ?? "learn",
      x,
      y,
      ...(f ? { place: f.id } : {}),
      usable: false,
    });
  };
  for (const p of s.finds.pois) if (p.x !== undefined && p.y !== undefined) named(p.id, p.name, p.kind, p.x, p.y);
  for (const t of s.finds.streets) {
    if (!t.lines || t.lines.length === 0) continue;
    const [x, y] = t.lines[0][0];
    out.push({ id: `street:${t.id}`, kind: "street", name: L(`Табличка «${t.name}»`, `Street sign “${t.name}”`), source: "OSM", theme: `street:${t.name}`, themeName: t.name, domain: KIND_DOMAIN.street, x, y, street: t.id, lines: t.lines, usable: false });
  }
  for (const f of features) {
    if (f.kind === "number") continue; // counted per street, no item
    if (f.kind === "sign") {
      named(f.id, f.name ?? "", f.cls ?? "", f.x, f.y);
      continue;
    }
    const base = { id: `feat:${f.id}`, source: "OSM" as const, x: f.x, y: f.y, domain: KIND_DOMAIN[f.kind] };
    if (f.kind === "seeds") out.push({ ...base, kind: "seeds", name: L("Семена старых сортов", "Seeds of old varieties"), theme: "gardens", themeName: L("Сады и огороды", "Gardens"), usable: true });
    else if (f.kind === "parts") out.push({ ...base, kind: "parts", name: L("Детали машин и инструмент", "Machine parts and tools"), theme: "crafts", themeName: L("Ремёсла", "Crafts"), usable: true });
    else if (f.kind === "rails") out.push({ ...base, kind: "rails", name: L("Рельс, костыли и путевой знак", "A rail, spikes and a track sign"), theme: "railway", themeName: L("Железная дорога", "The railway"), usable: true });
    else if (f.kind === "bucket") out.push({ ...base, kind: "bucket", name: L("Ведро и ворот колодца", "Well bucket and windlass"), ...placeTheme(null, f.x, f.y), usable: false });
  }
  // an article of the notebook titled with a building's name: its archive page
  const byName = new Map<string, FoundFoundation>();
  for (const f of list) if (f.name) byName.set(normName(f.name), f);
  for (const a of s.articles ?? []) {
    const f = byName.get(normName(a.title));
    if (!f) continue;
    const [x, y] = centroid(f.ring);
    out.push({ id: `page:${a.id}`, kind: "page", name: L(`Архивная страница «${a.title}»`, `Archive page “${a.title}”`), source: "Wikipedia", theme: `place:${f.id}`, themeName: f.name!, domain: siteDomain(f.cls) ?? "learn", x, y, place: f.id, usable: false });
  }
  cache.set(s.finds.pois, { features, streets: s.finds.streets, foundations: list, articles: s.articles, out });
  return out;
}

// Dug foundations: recorded and no longer an outline.
const dugList = (finds: Pick<Finds, "foundations">): FoundFoundation[] => finds.foundations.filter((f) => !f.ghost);

// Is the find found: its own foundation dug, or a dug foundation's centroid within reach of it (of its line, for a street
// sign).
export function isFound(item: Item, dug: readonly { id: string; c: [number, number] }[], dugIds: ReadonlySet<string>): boolean {
  if (item.place && dugIds.has(item.place)) return true;
  for (const d of dug) {
    const dist = item.lines ? near(d.c[0], d.c[1], item.lines) : Math.hypot(d.c[0] - item.x, d.c[1] - item.y);
    if (dist <= FIND.reach) return true;
  }
  return false;
}

const foundCache = new WeakMap<object, WeakMap<object, Set<string>>>();

// Ids of the finds found so far.
export function foundIds(s: CatalogueInput): Set<string> {
  const items = catalogue(s);
  let inner = foundCache.get(items);
  if (!inner) foundCache.set(items, (inner = new WeakMap()));
  const hit = inner.get(s.finds.foundations);
  if (hit) return hit;
  const dug = dugList(s.finds).map((f) => ({ id: f.id, c: centroid(f.ring) }));
  const ids = new Set(dug.map((d) => d.id));
  const out = new Set(items.filter((i) => isFound(i, dug, ids)).map((i) => i.id));
  inner.set(s.finds.foundations, out);
  return out;
}

// Is a point inside the revealed discs?
export const inRevealed = (finds: Pick<Finds, "revealed">, x: number, y: number): boolean => finds.revealed.some((r) => Math.hypot(x - r.x, y - r.y) <= r.r);

// A find beyond the revealed discs points to a place the survey has not reached (a street sign: none of its line revealed).
export const beyondSurvey = (finds: Pick<Finds, "revealed">, i: Pick<Item, "x" | "y" | "lines">): boolean =>
  i.lines ? !i.lines.some((l) => l.some(([x, y]) => inRevealed(finds, x, y))) : !inRevealed(finds, i.x, i.y);

// ---------- fates ----------

export type FateResult = { ok: true; sim: SimState } | { ok: false; reason: string };

// The finished building on a foundation (no dig site), if any.
const standingOn = (buildings: Record<number, Building>, foundationId: string): Building | undefined =>
  Object.values(buildings).find((b) => b.foundationId === foundationId && b.state === "active" && b.template !== "excavation");

// Why a find cannot go back to its place now, or null.
export function returnBlocker(s: Pick<SimState, "finds" | "buildings"> & { articles?: readonly StoredArticle[] }, item: Item): string | null {
  if (item.kind === "seeds" || item.kind === "parts" || item.kind === "rails") return L("Этой находке нет своего места", "This find has no place of its own");
  if (item.place) return standingOn(s.buildings, item.place) ? null : L("Сначала поставьте здание на её фундамент", "Put a building on its foundation first");
  if (item.street) return s.finds.streets.find((t) => t.id === item.street)?.restored !== undefined ? null : L("Сначала восстановите улицу целиком", "Restore the whole street first");
  if (item.kind === "bucket") return Object.values(s.buildings).some((b) => b.template === "well" && b.state === "active" && Math.hypot(b.lot.cx - item.x, b.lot.cy - item.y) <= FIND.wellReach) ? null : L(`Нужен колодец в ${FIND.wellReach} м от места находки`, `Needs a well within ${FIND.wellReach} m of the find`);
  return L("Этой находке нет своего места", "This find has no place of its own");
}

function check(s: SimState, id: unknown): Item | string {
  if (typeof id !== "string") return L("Некорректная находка", "Invalid find");
  const item = catalogue(s).find((i) => i.id === id);
  if (!item) return L("Нет такой находки", "No such find");
  if (!foundIds(s).has(id)) return L("Находка ещё не найдена", "Not found yet");
  if (s.finds.fates[id]) return L("С этой находкой уже решено", "This find is settled already");
  return item;
}

const withFate = (s: SimState, id: string, fate: FindFate): SimState => ({ ...s, finds: { ...s.finds, fates: { ...s.finds.fates, [id]: fate } } });

// Returns a find to its place: its building or street. A typical building as it was then counts in full (its weight
// leaves the TYPICAL_SHARE): its sign says what it was.
export function returnFind(s: SimState, id: unknown): FateResult {
  const item = check(s, id);
  if (typeof item === "string") return { ok: false, reason: item };
  const why = returnBlocker(s, item);
  if (why) return { ok: false, reason: why };
  let out = withFate(s, item.id, "returned");
  const b = item.place ? standingOn(s.buildings, item.place) : undefined;
  if (b?.asItWas && b.restoreWeight !== undefined && !b.landmark && !returnedTo(s, item.place!)) {
    const domain = siteDomain(s.finds.foundations.find((f) => f.id === item.place)?.cls);
    const full = Math.round((b.restoreWeight / TYPICAL_SHARE) * 100) / 100;
    if (domain) out = { ...out, progress: { ...out.progress, restored: { ...out.progress.restored, [domain]: Math.round(((out.progress.restored[domain] ?? 0) + full - b.restoreWeight) * 100) / 100 } }, buildings: { ...out.buildings, [b.id]: { ...b, restoreWeight: full } } };
  }
  return { ok: true, sim: out };
}

// Has any find of this foundation been returned already?
export const returnedTo = (s: Pick<SimState, "finds">, foundationId: string): boolean => catalogue(s).some((i) => i.place === foundationId && s.finds.fates[i.id] === "returned");

// Puts a find to use: seeds raise the fields' yield, machine parts studied feed craft research, rails melted make tools
// and are gone from the museum for good.
export function useFind(s: SimState, id: unknown): FateResult {
  const item = check(s, id);
  if (typeof item === "string") return { ok: false, reason: item };
  if (!item.usable) return { ok: false, reason: L("Эту находку не пустить в дело", "This find cannot be put to use") };
  let out = withFate(s, item.id, "used");
  if (item.kind === "seeds") out = { ...out, progress: { ...out.progress, seeds: (out.progress.seeds ?? 0) + 1 } };
  else if (item.kind === "parts") out = { ...out, progress: { ...out.progress, restored: { ...out.progress.restored, craft: Math.round(((out.progress.restored.craft ?? 0) + FIND.partsWeight) * 100) / 100 } } };
  else if (item.kind === "rails") out = { ...out, stock: { ...out.stock, tools: out.stock.tools + FIND.railTools } };
  return { ok: true, sim: out };
}


// What a building on a foundation is called: its real name once it is as it was or one of its finds came back.
export function realName(s: Pick<SimState, "finds"> & { articles?: readonly StoredArticle[] }, b: Pick<Building, "foundationId" | "asItWas">): string | null {
  if (!b.foundationId) return null;
  const f = s.finds.foundations.find((x) => x.id === b.foundationId);
  if (!f?.name) return null;
  return b.asItWas || returnedTo(s, f.id) ? f.name : null;
}

// Is the point inside a recorded foundation's ring? (For the house numbers of a street.)
export const insideRing = (f: FoundFoundation, x: number, y: number): boolean => pointInRing(x, y, f.ring);
