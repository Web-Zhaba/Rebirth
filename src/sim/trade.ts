import type { Stock } from "./types";
import { L } from "../i18n";

// Trade at the market (the town has no money): the player sets up to a few orders, each one good to give away and one to
// get, and the market workers swap them every day at fixed values minus a margin. Only what lies above the order's reserve
// is given; an order with a cap stops once the stock of the got good reaches it. The day's volume is shared by the
// orders in their order: the first takes what it can, the next the rest. How many orders and whether the reserve and the
// cap can be set is opened by research (tech.ts tradeSlots, tradeLimits).

export type TradeGood = keyof Stock;
export const TRADE_GOODS: readonly TradeGood[] = ["food", "logs", "planks", "stone", "clothes", "dishes", "furniture", "tools"];

export const TRADE_NAME: Record<TradeGood, string> = { food: L("еду", "food"), logs: L("брёвна", "logs"), planks: L("доски", "planks"), stone: L("камень", "stone"), clothes: L("одежду", "clothing"), dishes: L("посуду", "dishes"), furniture: L("утварь", "furnishings"), tools: L("инструменты", "tools") };

export interface TradeOrder {
  give: TradeGood;
  get: TradeGood;
  keep?: number; // units of `give` never given away; TRADE.keep[give] when absent
  until?: number; // no more is got once the stock of `get` reaches this; no cap when absent
}

// What one order swapped in a day.
export interface TradeSwap {
  give: TradeGood;
  get: TradeGood;
  gave: number;
  got: number;
}

export const TRADE = {
  // Worth of one unit (kg, m3, m3, t, piece) in the same abstract points; felt, not labor-derived, because building materials come PACE times faster.
  value: { food: 3, logs: 4, planks: 10, stone: 6, clothes: 20, dishes: 20, furniture: 35, tools: 40 } satisfies Record<TradeGood, number>,
  keep: { food: 1500, logs: 80, planks: 20, stone: 20, clothes: 10, dishes: 6, furniture: 4, tools: 8 } satisfies Record<TradeGood, number>, // default reserve, never given away
  step: { food: 250, logs: 20, planks: 5, stone: 5, clothes: 2, dishes: 2, furniture: 1, tools: 2 } satisfies Record<TradeGood, number>, // step of the reserve and the cap in the panel
  limit: 1e6, // largest reserve or cap an order takes
  margin: 0.25, // share of the worth the neighbours keep
  perWorker: 150, // points of the given goods a market worker moves in a day
};

export const STALL_NAME_MAX = 32; // characters of a stall name

const EPS = 1e-9;

const isAmount = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= TRADE.limit;
const isGood = (v: unknown): v is TradeGood => typeof v === "string" && (TRADE_GOODS as readonly string[]).includes(v);

export const isTradeOrder = (v: unknown): v is TradeOrder => {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return isGood(o.give) && isGood(o.get) && o.give !== o.get && (o.keep === undefined || isAmount(o.keep)) && (o.until === undefined || isAmount(o.until));
};

// A clean copy: only the known fields; without `limits` the reserve and the cap are dropped.
export const cleanOrder = (o: TradeOrder, limits = true): TradeOrder => ({ give: o.give, get: o.get, ...(limits && o.keep !== undefined ? { keep: o.keep } : {}), ...(limits && o.until !== undefined ? { until: o.until } : {}) });

export const orderKeep = (o: TradeOrder): number => o.keep ?? TRADE.keep[o.give];

// Units of `get` received for one unit of `give`.
export const tradeRate = (o: Pick<TradeOrder, "give" | "get">): number => (TRADE.value[o.give] * (1 - TRADE.margin)) / TRADE.value[o.get];

// Units of the given good that `workers` (summed working strength) can move in a day when the order has the market to itself.
export const tradeCapacity = (o: Pick<TradeOrder, "give">, workers: number): number => (TRADE.perWorker * Math.max(0, workers)) / TRADE.value[o.give];

// One day of trade: what each order swapped and the stock after it; null when nothing moves. `foodRoom` is the space left
// for food in the barns.
export function tradeDay(stock: Stock, orders: readonly TradeOrder[], workers: number, foodRoom: number): { stock: Stock; swaps: TradeSwap[] } | null {
  if (orders.length === 0 || workers <= 0) return null;
  let points = TRADE.perWorker * workers;
  let room = Math.max(0, foodRoom);
  const out = { ...stock };
  const swaps: TradeSwap[] = [];
  for (const o of orders) {
    if (points <= EPS) break;
    const rate = tradeRate(o);
    let gave = Math.min(Math.max(0, out[o.give] - orderKeep(o)), points / TRADE.value[o.give]);
    if (o.until !== undefined) gave = Math.min(gave, Math.max(0, o.until - out[o.get]) / rate);
    if (o.get === "food") gave = Math.min(gave, room / rate);
    if (gave <= EPS) continue;
    const got = gave * rate;
    out[o.give] -= gave;
    out[o.get] += got;
    points -= gave * TRADE.value[o.give];
    if (o.get === "food") room -= got;
    if (o.give === "food") room += gave;
    swaps.push({ give: o.give, get: o.get, gave, got });
  }
  return swaps.length > 0 ? { stock: out, swaps } : null;
}
