import { floorArea } from "./buildings";
import type { DomainId } from "./domains";
import { catalogue, foundIds, type Item } from "./items";
import type { Building, SimState, StoredArticle } from "./types";
import { L } from "../i18n";

// The museum (docs/PLAN-restoration.md section 6.3): a purpose of any old foundation. Its halls go by floor area and
// each shows one themed exhibition (a street, the railway, crafts, gardens, a building), made of the finds of that theme
// found and neither returned nor used. A complete exhibition, every known find of its theme shown, gives research in its
// domain and makes the town more attractive. There are fewer halls than themes: the player picks what to show.

export const MUSEUM = {
  template: "museum",
  hallArea: 100, // m2 of floor area per hall
  maxHalls: 8,
  min: 3, // finds an exhibition needs to count as complete
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
  complete: boolean; // every known find of it can be shown, and enough of them
}

type Input = Pick<SimState, "finds" | "buildings"> & { articles?: readonly StoredArticle[] };

// Themes that have at least one find found.
export function themes(s: Input): Theme[] {
  const found = foundIds(s);
  const by = new Map<string, Theme>();
  for (const i of catalogue(s)) {
    let t = by.get(i.theme);
    if (!t) by.set(i.theme, (t = { key: i.theme, name: i.themeName, domain: i.domain, items: [], shown: [], complete: false }));
    t.items.push(i);
    if (found.has(i.id) && !s.finds.fates[i.id]) t.shown.push(i);
  }
  const out: Theme[] = [];
  for (const t of by.values()) {
    if (t.shown.length === 0 && !t.items.some((i) => found.has(i.id))) continue;
    const showable = t.items.filter((i) => s.finds.fates[i.id] !== "used" && s.finds.fates[i.id] !== "returned");
    t.complete = t.shown.length >= MUSEUM.min && t.shown.length === showable.length;
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

// The research weight per domain and the attraction share the complete exhibitions give now (set daily on the progress).
export function exhibitionEffects(s: Input): { exhibits: Partial<Record<DomainId, number>>; pull: number } {
  const exhibits: Partial<Record<DomainId, number>> = {};
  let n = 0;
  for (const h of halls(s)) {
    if (!h.theme?.complete) continue;
    const b = s.buildings[h.museum];
    const k = b.asItWas ? MUSEUM.asItWas : 1;
    exhibits[h.theme.domain] = Math.round(((exhibits[h.theme.domain] ?? 0) + MUSEUM.research * k) * 100) / 100;
    n += k;
  }
  return { exhibits, pull: Math.min(MUSEUM.pullCap, Math.round(MUSEUM.pull * n * 100) / 100) };
}

// Daily: the complete exhibitions as the research and the attraction see them.
export function museumDaily(s: SimState): SimState {
  const { exhibits, pull } = exhibitionEffects(s);
  const same = JSON.stringify(exhibits) === JSON.stringify(s.progress.exhibits ?? {}) && pull === (s.progress.museumPull ?? 0);
  if (same) return s;
  const progress = { ...s.progress, exhibits, museumPull: pull };
  if (Object.keys(exhibits).length === 0) delete (progress as { exhibits?: unknown }).exhibits;
  if (pull === 0) delete (progress as { museumPull?: unknown }).museumPull;
  return { ...s, progress };
}
