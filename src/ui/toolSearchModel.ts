import { BUILDINGS } from "../sim/buildings";
import { PLACE_VARIANTS, ROAD_MATERIALS, isMaterialTool, isPlaceTool, type Tool } from "../map/tools";
import { CATEGORIES, toolLabel } from "./buildMenu";

// The search line over the build bar: every tool and every kind of one by its name.

export interface SearchHit {
  tool: Tool;
  kind?: string; // a building template of a placement tool, or the road kind of a material tool
  label: string;
  sub: string; // where it lives: the category, or the tool of a kind
}

const norm = (s: string) => s.toLowerCase().replace(/ё/g, "е").trim();

// The tools in bar order, each followed by its kinds (a kind named like its tool is the tool itself).
export function searchEntries(): SearchHit[] {
  const out: SearchHit[] = [];
  for (const c of CATEGORIES)
    for (const t of c.tools) {
      const name = toolLabel(t);
      out.push({ tool: t, label: name, sub: c.label });
      const kinds = isPlaceTool(t) ? (PLACE_VARIANTS[t] ?? []).map((k) => ({ id: k.id, label: BUILDINGS[k.id]?.name ?? k.label })) : isMaterialTool(t) ? ROAD_MATERIALS[t].map((m) => ({ id: m.id as string, label: m.title })) : [];
      for (const k of kinds) if (norm(k.label) !== norm(name)) out.push({ tool: t, kind: k.id, label: k.label, sub: name });
    }
  return out;
}

// The entries that match `query`, best first: the name starts with it, then a word of the name does, then the name
// holds it, then the place it lives does. At most `limit`; none for an empty query.
export function searchTools(query: string, entries: readonly SearchHit[] = searchEntries(), limit = 8): SearchHit[] {
  const q = norm(query);
  if (!q) return [];
  const rank = (h: SearchHit): number => {
    const name = norm(h.label);
    if (name.startsWith(q)) return 0;
    if (name.split(/[\s-]+/).some((w) => w.startsWith(q))) return 1;
    if (name.includes(q)) return 2;
    return norm(h.sub).includes(q) ? 3 : 4;
  };
  return entries
    .map((h, i) => ({ h, r: rank(h), i }))
    .filter((x) => x.r < 4)
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .slice(0, limit)
    .map((x) => x.h);
}
