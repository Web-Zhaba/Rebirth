import { beyondSurvey, catalogue, foundIds, returnBlocker } from "../sim/items";
import { halls, themes } from "../sim/museum";
import type { SimState } from "../sim/types";
import { L } from "../i18n";

// Pure view model of the notebook's finds: the finds found so far, by theme, with
// what can be done with each, and where a theme is shown.

export interface FindRow {
  id: string;
  name: string;
  source: string; // attribution of the data it comes from
  fate: "found" | "returned" | "used";
  hasPlace: boolean; // it has a place to go back to: its building, its street, a well
  returnWhy: string | null; // why it cannot go back to its place now (null: it can)
  usable: boolean;
  beyond: boolean; // it lies beyond the survey: it points to a place not open yet
}

export interface FindGroup {
  theme: string;
  name: string;
  rows: FindRow[];
  unfound: number; // finds of the theme not found yet
  hall: string | null; // where it is shown
  complete: boolean;
}

export function findsView(s: Pick<SimState, "finds" | "buildings"> & { articles?: SimState["articles"] }): FindGroup[] {
  const found = foundIds(s);
  const items = catalogue(s);
  const shownAt = new Map<string, string>();
  for (const h of halls(s)) if (h.theme) shownAt.set(h.theme.key, L(`зал ${h.index + 1} музея`, `hall ${h.index + 1} of the museum`));
  const complete = new Set(themes(s).filter((t) => t.complete).map((t) => t.key));
  const by = new Map<string, FindGroup>();
  for (const i of items) {
    let g = by.get(i.theme);
    if (!g) by.set(i.theme, (g = { theme: i.theme, name: i.themeName, rows: [], unfound: 0, hall: shownAt.get(i.theme) ?? null, complete: complete.has(i.theme) }));
    if (!found.has(i.id)) {
      g.unfound++;
      continue;
    }
    const fate: FindRow["fate"] = (s.finds.fates[i.id] as FindRow["fate"] | undefined) ?? "found";
    g.rows.push({
      id: i.id,
      name: i.name,
      source: i.source === "OSM" ? "OpenStreetMap" : L("Википедия", "Wikipedia"),
      fate,
      hasPlace: !!i.place || !!i.street || i.kind === "bucket",
      returnWhy: fate === "found" ? returnBlocker(s, i) : null,
      usable: fate === "found" && i.usable,
      beyond: beyondSurvey(s.finds, i),
    });
  }
  return [...by.values()].filter((g) => g.rows.length > 0).sort((a, b) => b.rows.length - a.rows.length || a.name.localeCompare(b.name));
}

export const foundCount = (groups: readonly FindGroup[]): number => groups.reduce((n, g) => n + g.rows.length, 0);
