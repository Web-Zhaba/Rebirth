import { BUILDINGS, floorArea, scaledJobs } from "./buildings";
import type { DomainId } from "./domains";
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

// Themes that have at least one find found.
export function themes(s: Input): Theme[] {
  const found = foundIds(s);
  const by = new Map<string, Theme>();
  for (const i of catalogue(s)) {
    let t = by.get(i.theme);
    if (!t) by.set(i.theme, (t = { key: i.theme, name: i.themeName, domain: i.domain, items: [], shown: [], showable: 0, complete: false }));
    t.items.push(i);
    if (found.has(i.id) && !s.finds.fates[i.id]) t.shown.push(i);
  }
  const out: Theme[] = [];
  for (const t of by.values()) {
    if (t.shown.length === 0 && !t.items.some((i) => found.has(i.id))) continue;
    t.showable = t.items.filter((i) => s.finds.fates[i.id] !== "used" && s.finds.fates[i.id] !== "returned").length;
    t.complete = t.shown.length >= MUSEUM.min && t.shown.length === t.showable;
    out.push(t);
  }
  return out.sort((a, b) => b.shown.length - a.shown.length || a.name.localeCompare(b.name));
}

export interface Hall {
  museum: number; // building id
  index: number;
  theme: Theme | null;
}

// The halls of every finished museum with what they show.
export function halls(s: Input): Hall[] {
  const byKey = new Map(themes(s).map((t) => [t.key, t]));
  const out: Hall[] = [];
  for (const b of Object.values(s.buildings)) {
    if (!isMuseum(b)) continue;
    for (let k = 0; k < hallsOf(b); k++) {
      const key = b.exhibits?.[k] ?? null;
      out.push({ museum: b.id, index: k, theme: key ? (byKey.get(key) ?? null) : null });
    }
  }
  return out;
}

export type MuseumResult = { ok: true; sim: SimState } | { ok: false; reason: string };

// Shows a theme in a hall of a museum (null empties the hall). A theme is shown in one hall of the town at a time.
export function setExhibition(s: SimState, buildingId: unknown, hall: unknown, theme: unknown): MuseumResult {
  if (typeof buildingId !== "number" || !Object.hasOwn(s.buildings, buildingId)) return { ok: false, reason: L("Нет такого музея", "No such museum") };
  const b = s.buildings[buildingId];
  if (!isMuseum(b)) return { ok: false, reason: L("Это не готовый музей", "This is no finished museum") };
  if (typeof hall !== "number" || !Number.isInteger(hall) || hall < 0 || hall >= hallsOf(b)) return { ok: false, reason: L("Нет такого зала", "No such hall") };
  if (theme !== null && (typeof theme !== "string" || !themes(s).some((t) => t.key === theme))) return { ok: false, reason: L("Для этой темы нет находок", "No finds for this theme") };
  if (theme !== null) for (const h of halls(s)) if (h.theme?.key === theme && !(h.museum === b.id && h.index === hall)) return { ok: false, reason: L("Эта тема уже в другом зале", "This theme is in another hall already") };
  const exhibits = Array.from({ length: hallsOf(b) }, (_, k) => (k === hall ? (theme as string | null) : (b.exhibits?.[k] ?? null)));
  return { ok: true, sim: { ...s, buildings: { ...s.buildings, [b.id]: { ...b, exhibits } } } };
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
