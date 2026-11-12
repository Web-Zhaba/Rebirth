import { domainName, type DomainId } from "../sim/domains";
import { beyondSurvey, catalogue, foundIds, realName, returnBlocker, type ItemKind } from "../sim/items";
import { exhibitionEffects, halls, hallsOf, hallStrength, isMuseum, MUSEUM, quality, themes, type Theme } from "../sim/museum";
import { SPEED } from "../sim/research";
import type { Building, SimState } from "../sim/types";
import { L } from "../i18n";

// Pure view model of the museum window (sim/museum.ts): the halls of every museum of the town, the register of themes
// with their showcases (every find of the theme, found or not), and what the exhibitions give.

export type ThemeGroup = "hall" | "ready" | "partial" | "few";

export interface HallRow {
  museum: number;
  index: number;
  label: string; // «Зал 2», with the museum's name when the town has more than one
  theme: string | null;
  themeName: string | null;
  domain: DomainId | null;
  shown: number;
  showable: number;
  complete: boolean;
  value: number; // quality x hall strength: 1 is a complete exhibition at full staff
}

export interface MuseumRow {
  id: number;
  name: string;
  staff: number; // share of its jobs filled, 0..1
  asItWas: boolean;
  strength: number; // what its halls multiply an exhibition by
  footprint: [number, number][]; // the old ring it stands on: the plan of the window
  at: [number, number]; // its centre
  halls: HallRow[];
}

export interface ShowcaseItem {
  id: string;
  no: number; // its number in the theme's inventory, 1..
  name: string | null; // null: not found yet, shown as an empty place in the showcase
  kind: ItemKind;
  source: string;
  state: "shown" | "returned" | "used" | "unfound";
  beyond: boolean; // beyond the survey: a place not open yet
  at: [number, number];
  returnWhy: string | null; // why it cannot go back now (null: it can, or it is not found)
  canReturn: boolean;
  canUse: boolean;
  breaks: boolean; // taking it out of the museum drops its hall's exhibition below the minimum
}

export interface ThemeRow {
  key: string;
  name: string;
  domain: DomainId;
  domainName: string;
  shown: number;
  showable: number;
  unfound: number; // finds of the theme still to be found: what a complete exhibition waits for
  complete: boolean;
  quality: number; // 0..1, a complete exhibition is 1
  group: ThemeGroup;
  hall: HallRow | null; // where it is shown
  items: ShowcaseItem[];
}

export interface MuseumEffects {
  research: { domain: DomainId; name: string; pct: number }[]; // research speed added per domain, %
  pullPct: number; // attraction added, %
  pullRawPct: number; // before the cap
  capPct: number;
}

export interface MuseumView {
  museums: MuseumRow[];
  themes: ThemeRow[];
  effects: MuseumEffects;
  hallsTotal: number;
  hallsFilled: number;
  complete: number; // complete exhibitions in halls
  idleReady: number; // complete themes not in any hall
}

type Input = Pick<SimState, "finds" | "buildings"> & { articles?: SimState["articles"]; museumStaff: Record<number, number> };

const pct = (v: number): number => Math.round(v * 1000) / 10;
// Research speed (%) a research weight adds, and attraction (%) an exhibition value adds.
export const researchPct = (value: number): number => pct(MUSEUM.research * value * SPEED.restored);
export const pullPct = (value: number): number => pct(MUSEUM.pull * value);

const groupOf = (t: Theme, inHall: boolean): ThemeGroup => (inHall ? "hall" : t.complete ? "ready" : quality(t) > 0 ? "partial" : "few");

export function museumView(s: Input): MuseumView {
  const all = themes(s);
  const byKey = new Map(all.map((t) => [t.key, t]));
  const list = Object.values(s.buildings).filter(isMuseum).sort((a, b) => a.id - b.id);
  const many = list.length > 1;
  const nameOf = (b: Building, i: number): string => realName(s, b) ?? (many ? L(`Музей ${i + 1}`, `Museum ${i + 1}`) : L("Музей", "Museum"));
  const museums: MuseumRow[] = list.map((b, i) => {
    const staff = s.museumStaff[b.id] ?? 0;
    const strength = hallStrength(b, staff);
    const name = nameOf(b, i);
    const rows = halls(s)
      .filter((h) => h.museum === b.id)
      .map((h): HallRow => {
        const t = h.theme;
        return {
          museum: b.id,
          index: h.index,
          label: many ? L(`${name}, зал ${h.index + 1}`, `${name}, hall ${h.index + 1}`) : L(`Зал ${h.index + 1}`, `Hall ${h.index + 1}`),
          theme: t?.key ?? null,
          themeName: t?.name ?? null,
          domain: t?.domain ?? null,
          shown: t?.shown.length ?? 0,
          showable: t?.showable ?? 0,
          complete: !!t?.complete,
          value: t ? Math.round(quality(t) * strength * 100) / 100 : 0,
        };
      });
    return { id: b.id, name, staff, asItWas: !!b.asItWas, strength, footprint: b.footprint, at: [b.lot.cx, b.lot.cy], halls: rows };
  });
  const hallOf = new Map(museums.flatMap((m) => m.halls.flatMap((h) => (h.theme ? [[h.theme, h] as const] : []))));

  const found = foundIds(s);
  const items = new Map<string, ShowcaseItem[]>();
  for (const i of catalogue(s)) {
    if (!byKey.has(i.theme)) continue;
    const fate = s.finds.fates[i.id];
    const state: ShowcaseItem["state"] = !found.has(i.id) ? "unfound" : fate === "returned" ? "returned" : fate === "used" ? "used" : "shown";
    const t = byKey.get(i.theme)!;
    const why = state === "shown" ? returnBlocker(s, i) : null;
    const hasPlace = !!i.place || !!i.street || i.kind === "bucket";
    const row: ShowcaseItem = {
      id: i.id,
      no: 0,
      name: state === "unfound" ? null : i.name,
      kind: i.kind,
      source: i.source === "OSM" ? "OpenStreetMap" : L("Википедия", "Wikipedia"),
      state,
      beyond: beyondSurvey(s.finds, i),
      at: [i.x, i.y],
      returnWhy: hasPlace ? why : null,
      canReturn: state === "shown" && hasPlace && why === null,
      canUse: state === "shown" && i.usable,
      breaks: state === "shown" && hallOf.has(t.key) && t.shown.length - 1 < MUSEUM.min,
    };
    const arr = items.get(i.theme);
    if (arr) arr.push(row);
    else items.set(i.theme, [row]);
  }
  const order: Record<ShowcaseItem["state"], number> = { shown: 0, returned: 1, used: 2, unfound: 3 };

  const rows: ThemeRow[] = all.map((t) => {
    const hall = hallOf.get(t.key) ?? null;
    const list = items.get(t.key) ?? [];
    [...list].sort((a, b) => a.id.localeCompare(b.id)).forEach((x, k) => (x.no = k + 1)); // stable whatever is found
    const showcase = list.sort((a, b) => order[a.state] - order[b.state] || a.no - b.no);
    return {
      key: t.key,
      name: t.name,
      domain: t.domain,
      domainName: domainName(t.domain),
      shown: t.shown.length,
      showable: t.showable,
      unfound: t.showable - t.shown.length,
      complete: t.complete,
      quality: quality(t),
      group: groupOf(t, !!hall),
      hall,
      items: showcase,
    };
  });
  rows.sort((a, b) => b.quality - a.quality || a.unfound - b.unfound || b.shown - a.shown || a.name.localeCompare(b.name));

  const fx = exhibitionEffects(s, s.museumStaff);
  const raw = museums.reduce((n, m) => n + m.halls.reduce((k, h) => k + h.value, 0), 0);
  const effects: MuseumEffects = {
    research: (Object.entries(fx.exhibits) as [DomainId, number][]).map(([d, w]) => ({ domain: d, name: domainName(d), pct: pct(w * SPEED.restored) })).sort((a, b) => b.pct - a.pct),
    pullPct: pct(fx.pull),
    pullRawPct: pullPct(raw),
    capPct: pct(MUSEUM.pullCap),
  };
  const allHalls = museums.flatMap((m) => m.halls);
  return {
    museums,
    themes: rows,
    effects,
    hallsTotal: list.reduce((n, b) => n + hallsOf(b), 0),
    hallsFilled: allHalls.filter((h) => h.theme).length,
    complete: allHalls.filter((h) => h.theme && byKey.get(h.theme)?.complete).length,
    idleReady: rows.filter((r) => r.group === "ready").length,
  };
}

export const KIND_NAME: Record<ItemKind, string> = {
  sign: L("вывеска", "sign"),
  object: L("предмет", "object"),
  street: L("уличная табличка", "street sign"),
  seeds: L("семена", "seeds"),
  parts: L("детали", "parts"),
  rails: L("путевое железо", "track iron"),
  bucket: L("колодезная утварь", "well gear"),
  page: L("архивная страница", "archive page"),
};

export const GROUPS: [ThemeGroup, string][] = [
  ["hall", L("В залах", "In the halls")],
  ["ready", L("Полные: ждут зала", "Complete: waiting for a hall")],
  ["partial", L("Неполные", "Incomplete")],
  ["few", L(`Меньше ${MUSEUM.min} находок`, `Fewer than ${MUSEUM.min} finds`)],
];
