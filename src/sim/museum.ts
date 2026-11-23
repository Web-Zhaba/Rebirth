import { BUILDINGS, floorArea, scaledJobs } from "./buildings";
import { DOMAIN_IDS, domainName, type DomainId } from "./domains";
import { catalogue, foundIds, type Item } from "./items";
import type { Building, Resident, SimState, StoredArticle } from "./types";
import { L } from "../i18n";

// The museum: a purpose of any old foundation. Its halls go by floor area and
// each shows one themed exhibition (a street, the railway, crafts, gardens, a building), made of the finds of that theme
// found and neither returned nor used. A complete exhibition, every known find of its theme shown, gives research in its
// domain and makes the town more attractive; one with enough finds but not all of them gives a part of that, by the share
// shown. The museum's staff carry it: a hall works by the share of its jobs filled. There are fewer halls than themes:
// the player picks what to show.

export const MUSEUM = {
  template: "museum",
  hallArea: 100, // m2 of floor area per hall
  maxHalls: 8,
  min: 3, // finds an exhibition needs to count at all
  partial: 0.5, // what an incomplete exhibition gives against a complete one, times the share of its finds shown
  research: 0.5, // research weight of a complete exhibition in its domain
  pull: 0.05, // attraction share a complete exhibition adds
  pullCap: 0.25,
  asItWas: 1.5, // an old museum brought back as a museum shows its exhibitions better
};

export const isMuseum = (b: Pick<Building, "template" | "state">): boolean => b.template === MUSEUM.template && b.state === "active";
export const hallsOf = (b: Pick<Building, "template" | "scale" | "level" | "foundationId">): number => Math.max(1, Math.min(MUSEUM.maxHalls, Math.floor(floorArea(b) / MUSEUM.hallArea)));

export interface Theme {
  key: string;
  name: string;
  domain: DomainId;
  items: Item[]; // every known find of the theme
  shown: Item[]; // found, neither returned nor used: what an exhibition of it shows
  showable: number; // finds of the theme neither returned nor used: what a complete exhibition needs shown
  complete: boolean; // every known find of it can be shown, and enough of them
}

// What an exhibition of the theme is worth against a complete one: 1 complete, a part by the share shown, 0 under the minimum.
export const quality = (t: Pick<Theme, "shown" | "showable" | "complete">): number =>
  t.complete ? 1 : t.shown.length >= MUSEUM.min && t.showable > 0 ? Math.round(MUSEUM.partial * (t.shown.length / t.showable) * 100) / 100 : 0;

type Input = Pick<SimState, "finds" | "buildings"> & { articles?: readonly StoredArticle[] };

interface Collection {
  key: string;
  name: string;
  domain: DomainId;
  items: Item[];
}

const collectionsCache = new WeakMap<Item[], Collection[]>();

function collections(items: Item[]): Collection[] {
  const hit = collectionsCache.get(items);
  if (hit) return hit;
  const by = new Map<string, Collection>();
  for (const i of items) {
    let group = by.get(i.theme);
    if (!group) by.set(i.theme, (group = { key: i.theme, name: i.themeName, domain: i.domain, items: [] }));
    group.items.push(i);
  }
  const large = [...by.values()].filter((g) => g.items.length >= MUSEUM.min);
  const small = [...by.values()].filter((g) => g.items.length < MUSEUM.min);
  const merged: Collection[] = [];
  const labels = new Map<string, number>();
  const title = (name: string): string => {
    const n = (labels.get(name) ?? 0) + 1;
    labels.set(name, n);
    return n === 1 ? name : `${name} ${n}`;
  };
  // Keep each small theme together and close a new collection as soon as it can give a bonus.
  const pack = (groups: Collection[], name: string): Collection[] => {
    let tail: Collection[] = [];
    let count = 0;
    for (const g of groups) {
      tail.push(g);
      count += g.items.length;
      if (count < MUSEUM.min) continue;
      merged.push({ ...tail[0], name: title(name), items: tail.flatMap((x) => x.items) });
      tail = [];
      count = 0;
    }
    return tail;
  };
  const loose = DOMAIN_IDS.flatMap((domain) => pack(small.filter((g) => g.domain === domain), domainName(domain)));
  const town = L("Городские находки", "Town finds");
  const rest = pack(loose, town);
  if (rest.length) {
    const remaining = rest.flatMap((g) => g.items);
    const related = (g: Collection) => rest.every((r) => r.domain === g.domain);
    const target = merged.find(related) ?? merged.at(-1) ?? large.find(related) ?? large.at(-1);
    if (target) {
      if (!related(target)) target.name = title(town);
      target.items.push(...remaining);
    } else merged.push({ ...rest[0], name: rest.length > 1 ? town : rest[0].name, items: remaining });
  }
  const groups = [...large, ...merged];
  collectionsCache.set(items, groups);
  return groups;
}

// Collection membership is based on the catalogue, so using or returning a find never reshuffles collections.
export function themes(s: Input): Theme[] {
  const found = foundIds(s);
  const out: Theme[] = [];
  for (const group of collections(catalogue(s))) {
    if (!group.items.some((i) => found.has(i.id))) continue;
    const shown = group.items.filter((i) => found.has(i.id) && !s.finds.fates[i.id]);
    const showable = group.items.filter((i) => !s.finds.fates[i.id]).length;
    out.push({ ...group, shown, showable, complete: shown.length >= MUSEUM.min && shown.length === showable });
  }
  return out.sort((a, b) => b.shown.length - a.shown.length || a.name.localeCompare(b.name));
}

export interface Hall {
  museum: number; // building id
  index: number;
  theme: Theme | null;
}

// Saved theme keys may refer to any of the original groups in a merged collection.
const exhibitionKeys = (list: Theme[]): Map<string, Theme> => {
  const keys = new Map<string, Theme>();
  for (const t of list) for (const i of t.items) keys.set(i.theme, t);
  return keys;
};

function assignedHalls(s: Input, byKey: Map<string, Theme>): Hall[] {
  const seen = new Set<string>();
  const out: Hall[] = [];
  for (const b of Object.values(s.buildings)) {
    if (!isMuseum(b)) continue;
    for (let k = 0; k < hallsOf(b); k++) {
      const key = b.exhibits?.[k] ?? null;
      const theme = key ? byKey.get(key) : undefined;
      const show = theme && !seen.has(theme.key) ? theme : null;
      if (show) seen.add(show.key);
      out.push({ museum: b.id, index: k, theme: show });
    }
  }
  return out;
}

// The halls of every finished museum with what they show.
export const halls = (s: Input): Hall[] => assignedHalls(s, exhibitionKeys(themes(s)));

export type MuseumResult = { ok: true; sim: SimState } | { ok: false; reason: string };

// Shows a theme in a hall of a museum (null empties the hall). A theme is shown in one hall of the town at a time.
export function setExhibition(s: SimState, buildingId: unknown, hall: unknown, theme: unknown): MuseumResult {
  if (typeof buildingId !== "number" || !Object.hasOwn(s.buildings, buildingId)) return { ok: false, reason: L("Нет такого музея", "No such museum") };
  const b = s.buildings[buildingId];
  if (!isMuseum(b)) return { ok: false, reason: L("Это не готовый музей", "This is no finished museum") };
  if (typeof hall !== "number" || !Number.isInteger(hall) || hall < 0 || hall >= hallsOf(b)) return { ok: false, reason: L("Нет такого зала", "No such hall") };
  const byKey = exhibitionKeys(themes(s));
  const next = typeof theme === "string" ? byKey.get(theme)?.key : null;
  if (theme !== null && !next) return { ok: false, reason: L("Для этой темы нет находок", "No finds for this theme") };
  const assigned = assignedHalls(s, byKey);
  const target = assigned.find((h) => h.museum === b.id && h.index === hall)!;
  if (next && assigned.some((h) => h !== target && h.theme?.key === next)) return { ok: false, reason: L("Эта тема уже в другом зале", "This theme is in another hall already") };
  const buildings = { ...s.buildings };
  for (const museum of Object.values(buildings).filter(isMuseum)) {
    const exhibits = Array.from({ length: hallsOf(museum) }, (_, k) => {
      if (museum.id === b.id && k === hall) return next ?? null;
      const old = museum.exhibits?.[k] ?? null;
      // Remove duplicate legacy assignments when taking down or replacing their visible collection.
      return old && target.theme && byKey.get(old)?.key === target.theme.key ? null : old;
    });
    if (museum.id === b.id || exhibits.some((key, k) => key !== (museum.exhibits?.[k] ?? null))) buildings[museum.id] = { ...museum, exhibits };
  }
  return { ok: true, sim: { ...s, buildings } };
}

// The share of each finished museum's jobs filled: the strength its halls work at.
export function museumStaff(s: Pick<SimState, "buildings"> & { residents: Record<number, Pick<Resident, "job">> }): Record<number, number> {
  const workers = new Map<number, number>();
  for (const r of Object.values(s.residents)) if (r.job !== null) workers.set(r.job, (workers.get(r.job) ?? 0) + 1);
  const out: Record<number, number> = {};
  for (const b of Object.values(s.buildings)) {
    if (!isMuseum(b)) continue;
    const jobs = scaledJobs(BUILDINGS[b.template].jobs, b);
    out[b.id] = jobs > 0 ? Math.round(Math.min(1, (workers.get(b.id) ?? 0) / jobs) * 100) / 100 : 1;
  }
  return out;
}

// What a hall of a museum multiplies its exhibition by: the staff at work, and an old museum brought back as it was.
export const hallStrength = (b: Pick<Building, "asItWas">, staff: number): number => staff * (b.asItWas ? MUSEUM.asItWas : 1);

// The research weight per domain and the attraction share the exhibitions give now (set daily on the progress).
export function exhibitionEffects(s: Input, staff: Record<number, number>): { exhibits: Partial<Record<DomainId, number>>; pull: number } {
  const exhibits: Partial<Record<DomainId, number>> = {};
  let n = 0;
  for (const h of halls(s)) {
    if (!h.theme) continue;
    const k = quality(h.theme) * hallStrength(s.buildings[h.museum], staff[h.museum] ?? 0);
    if (k <= 0) continue;
    exhibits[h.theme.domain] = Math.round(((exhibits[h.theme.domain] ?? 0) + MUSEUM.research * k) * 100) / 100;
    n += k;
  }
  return { exhibits, pull: Math.min(MUSEUM.pullCap, Math.round(MUSEUM.pull * n * 100) / 100) };
}

// The best exhibitions for the halls of the town: the strongest halls get the themes worth most, the rest are filled in
// order of the finds shown. The player's own choice is replaced.
export function arrangeExhibitions(s: SimState): MuseumResult {
  const staff = museumStaff(s);
  const museums = Object.values(s.buildings).filter(isMuseum);
  if (museums.length === 0) return { ok: false, reason: L("В городе нет готового музея", "The town has no finished museum") };
  const list = themes(s).sort((a, b) => quality(b) - quality(a) || b.shown.length - a.shown.length || a.name.localeCompare(b.name));
  if (list.length === 0) return { ok: false, reason: L("Находок для выставок пока нет", "No finds to exhibit yet") };
  const slots = museums.flatMap((b) => Array.from({ length: hallsOf(b) }, (_, k) => ({ b, k, w: hallStrength(b, staff[b.id] ?? 0) }))).sort((x, y) => y.w - x.w || x.b.id - y.b.id || x.k - y.k);
  const exhibits = new Map(museums.map((b) => [b.id, Array.from<string | null>({ length: hallsOf(b) }).fill(null)]));
  slots.forEach((slot, i) => (exhibits.get(slot.b.id)![slot.k] = list[i]?.key ?? null));
  const buildings = { ...s.buildings };
  for (const b of museums) buildings[b.id] = { ...b, exhibits: exhibits.get(b.id)! };
  return { ok: true, sim: { ...s, buildings } };
}

// Daily (and on every change to the halls or the finds): the exhibitions as the research and the attraction see them.
export function museumDaily(s: SimState): SimState {
  const { exhibits, pull } = exhibitionEffects(s, museumStaff(s));
  const same = JSON.stringify(exhibits) === JSON.stringify(s.progress.exhibits ?? {}) && pull === (s.progress.museumPull ?? 0);
  if (same) return s;
  const progress = { ...s.progress, exhibits, museumPull: pull };
  if (Object.keys(exhibits).length === 0) delete (progress as { exhibits?: unknown }).exhibits;
  if (pull === 0) delete (progress as { museumPull?: unknown }).museumPull;
  return { ...s, progress };
}
