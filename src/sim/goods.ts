import type { Stock } from "./types";
import type { StoreGroup } from "./buildings";
import { L } from "../i18n";

// Every good of the stock, one row each. Units are the stock's: kg of food, m3 of logs and planks, t of stone, pieces
// of the goods.
export interface GoodInfo {
  label: string; // in a list or a heading ("Брёвна")
  name: string; // in a sentence ("брёвна")
  accusative: string; // as the object of a sentence ("отдаём одежду")
  unit: string;
  store: StoreGroup; // the room of the stores it lies in (sim/buildings.ts)
  mass: number; // t per unit (sim/storage.ts carting)
  load: number; // units in one cart load (sim/life.ts carts)
  trade: { value: number; keep: number; step: number }; // sim/trade.ts: worth per unit, default reserve, panel step
  need?: number; // units a person needs a day (the household goods)
}
export const GOOD_INFO = {
  food: { label: L("Еда", "Food"), name: L("еда", "food"), accusative: L("еду", "food"), unit: L("кг", "kg"), store: "food", mass: 0.001, load: 500, trade: { value: 3, keep: 1500, step: 250 } },
  logs: { label: L("Брёвна", "Logs"), name: L("брёвна", "logs"), accusative: L("брёвна", "logs"), unit: L("м³", "m³"), store: "wood", mass: 0.6, load: 5, trade: { value: 4, keep: 80, step: 20 } },
  planks: { label: L("Доски", "Planks"), name: L("доски", "planks"), accusative: L("доски", "planks"), unit: L("м³", "m³"), store: "wood", mass: 0.5, load: 2, trade: { value: 10, keep: 20, step: 5 } },
  stone: { label: L("Камень", "Stone"), name: L("камень", "stone"), accusative: L("камень", "stone"), unit: L("т", "t"), store: "stone", mass: 1, load: 3, trade: { value: 6, keep: 20, step: 5 } },
  clothes: { label: L("Одежда", "Clothing"), name: L("одежда", "clothing"), accusative: L("одежду", "clothing"), unit: L("шт", "pcs"), store: "goods", mass: 0.003, load: 20, trade: { value: 20, keep: 10, step: 2 }, need: 0.03 },
  dishes: { label: L("Посуда", "Dishes"), name: L("посуда", "dishes"), accusative: L("посуду", "dishes"), unit: L("шт", "pcs"), store: "goods", mass: 0.004, load: 20, trade: { value: 20, keep: 6, step: 2 }, need: 0.015 },
  furniture: { label: L("Утварь", "Furnishings"), name: L("утварь", "furnishings"), accusative: L("утварь", "furnishings"), unit: L("шт", "pcs"), store: "goods", mass: 0.02, load: 6, trade: { value: 35, keep: 4, step: 1 }, need: 0.01 },
  tools: { label: L("Инструменты", "Tools"), name: L("инструменты", "tools"), accusative: L("инструменты", "tools"), unit: L("шт", "pcs"), store: "goods", mass: 0.004, load: 15, trade: { value: 40, keep: 8, step: 2 } },
} satisfies Record<keyof Stock, GoodInfo>;
export const STOCK_KEYS = Object.keys(GOOD_INFO) as (keyof Stock)[];

// A table of every good of the stock from its row.
export const byGood = <T>(f: (info: GoodInfo, g: keyof Stock) => T): Record<keyof Stock, T> =>
  Object.fromEntries(STOCK_KEYS.map((g) => [g, f(GOOD_INFO[g], g)])) as Record<keyof Stock, T>;
// An empty stock: nothing of anything.
export const zeroStock = (): Stock => byGood(() => 0);

// Goods: the workshops' output, in pieces. Clothing, dishes and furnishings are handed out to
// the households by the shops and markets; tools wear out with work.
export const GOODS = ["clothes", "dishes", "furniture", "tools"] as const;
export type Good = (typeof GOODS)[number];

export const GOOD_NAMES: Record<Good, string> = { clothes: GOOD_INFO.clothes.label, dishes: GOOD_INFO.dishes.label, furniture: GOOD_INFO.furniture.label, tools: GOOD_INFO.tools.label };

// Pieces a person needs a day; the goods a household needs grow with the level of its house (a tent counts as level 1).
export const NEED_PER_PERSON: Record<Exclude<Good, "tools">, number> = { clothes: GOOD_INFO.clothes.need, dishes: GOOD_INFO.dishes.need, furniture: GOOD_INFO.furniture.need };
export function needsAt(level: number): Exclude<Good, "tools">[] {
  if (level >= 3) return ["clothes", "dishes", "furniture"];
  if (level >= 2) return ["clothes", "dishes"];
  return ["clothes"];
}
// A family whose goods were served at least this share at the last midnight lets its house be raised.
export const GOODS_UPGRADE = 0.8;

// Tools: pieces worn per worker-hour at the places that use them (rules `usesTools`); without tools such a place works at TOOLLESS of its rate.
export const TOOL_WEAR = 0.002;
export const TOOLLESS = 0.5;

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
