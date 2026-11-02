import type { Stock } from "./types";

// Trade at the market (the town has no money): the player picks one good to give away and one to get, the market
// workers swap them every day at fixed values minus a margin. Only what lies above the reserve is given.

export type TradeGood = keyof Stock;
export const TRADE_GOODS: readonly TradeGood[] = ["food", "logs", "planks", "stone", "wares"];

export const TRADE_NAME: Record<TradeGood, string> = { food: "еду", logs: "брёвна", planks: "доски", stone: "камень", wares: "товары" };

export interface TradeOrder {
  give: TradeGood;
  get: TradeGood;
}

export const TRADE = {
  // Worth of one unit (kg, m3, m3, t, piece) in the same abstract points; felt, not labor-derived, because building materials come PACE times faster.
  value: { food: 1, logs: 4, planks: 10, stone: 6, wares: 25 } satisfies Record<TradeGood, number>,
  keep: { food: 1500, logs: 80, planks: 20, stone: 20, wares: 10 } satisfies Record<TradeGood, number>, // never given away
  margin: 0.25, // share of the worth the neighbours keep
  perWorker: 150, // points of the given good a market worker moves in a day
};

const EPS = 1e-9;

export const isTradeOrder = (v: unknown): v is TradeOrder => {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return typeof o.give === "string" && typeof o.get === "string" && (TRADE_GOODS as readonly string[]).includes(o.give) && (TRADE_GOODS as readonly string[]).includes(o.get) && o.give !== o.get;
};

// Units of `get` received for one unit of `give`.
export const tradeRate = (o: TradeOrder): number => (TRADE.value[o.give] * (1 - TRADE.margin)) / TRADE.value[o.get];

// Units of the given good that `workers` (summed working strength) can move in a day.
export const tradeCapacity = (o: TradeOrder, workers: number): number => (TRADE.perWorker * Math.max(0, workers)) / TRADE.value[o.give];

// One day of trade: what is swapped and the stock after it; null when nothing moves. `foodRoom` is the space left for food in the barns.
export function tradeDay(stock: Stock, order: TradeOrder | null, workers: number, foodRoom: number): { stock: Stock; gave: number; got: number } | null {
  if (!order || workers <= 0) return null;
  const { give, get } = order;
  const rate = tradeRate(order);
  let gave = Math.min(Math.max(0, stock[give] - TRADE.keep[give]), tradeCapacity(order, workers));
  if (get === "food") gave = Math.min(gave, Math.max(0, foodRoom) / rate);
  if (gave <= EPS) return null;
  const got = gave * rate;
  return { stock: { ...stock, [give]: stock[give] - gave, [get]: stock[get] + got }, gave, got };
}
