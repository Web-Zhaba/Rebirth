import type { Stock } from "./types";
import { L } from "../i18n";

// Goods: the workshops' output, in pieces. Clothing, dishes and furnishings are handed out to
// the households by the shops and markets; tools wear out with work.
export const GOODS = ["clothes", "dishes", "furniture", "tools"] as const;
export type Good = (typeof GOODS)[number];

export const GOOD_NAMES: Record<Good, string> = { clothes: L("Одежда", "Clothing"), dishes: L("Посуда", "Dishes"), furniture: L("Утварь", "Furnishings"), tools: L("Инструменты", "Tools") };

// Pieces a person needs a day; the goods a household needs grow with the level of its house (a tent counts as level 1).
export const NEED_PER_PERSON: Record<Exclude<Good, "tools">, number> = { clothes: 0.03, dishes: 0.015, furniture: 0.01 };
export function needsAt(level: number): Exclude<Good, "tools">[] {
  if (level >= 3) return ["clothes", "dishes", "furniture"];
  if (level >= 2) return ["clothes", "dishes"];
  return ["clothes"];
}
// A family whose goods were served at least this share at the last midnight lets its house be raised.
export const GOODS_UPGRADE = 0.8;

// Tools: pieces worn per worker-hour at the places that use them; without tools such a place works at TOOLLESS of its rate.
export const TOOL_WEAR = 0.002;
export const TOOLLESS = 0.5;
export const TOOL_USERS: ReadonlySet<string> = new Set(["woodcutter", "sawpit", "quarry", "gumno", "weaver", "pottery", "carpentry"]);

// All the goods in the stock, pieces.
export const goodsTotal = (st: Stock): number => GOODS.reduce((a, g) => a + st[g], 0);

// The household goods a call for settlers or a gift takes, largest piles first (tools are kept for work).
export function takeGoods(st: Stock, n: number): Stock | null {
  const kinds: Good[] = ["clothes", "dishes", "furniture"];
  if (kinds.reduce((a, g) => a + st[g], 0) < n - 1e-9) return null;
  const out = { ...st };
  let left = n;
  while (left > 1e-9) {
    const g = kinds.reduce((p, q) => (out[q] > out[p] ? q : p));
    const take = Math.min(left, out[g], Math.max(1, left / kinds.length));
    out[g] -= take;
    left -= take;
  }
  return out;
}
export const homeGoods = (st: Stock): number => st.clothes + st.dishes + st.furniture;

// Saves from before goods groups carried one `wares` number: it is split by these shares.
export const WARES_SPLIT: Record<Good, number> = { clothes: 0.45, dishes: 0.25, furniture: 0.1, tools: 0.2 };
