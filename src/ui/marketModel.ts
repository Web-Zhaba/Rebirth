import { MAX_TRADE_SLOTS, TECHS, tradeLimits, tradeSlots, type TechDef } from "../sim/tech";
import { TRADE, type TradeOrder, type TradeSwap } from "../sim/trade";
import type { ProgressState } from "../sim/types";
import { L } from "../i18n";

// The market window (MarketPanel.tsx) as data: the market row with one stall per trade slot the tree can ever open.
// A stall holds an order, stands free, or is shut until the tech that opens it is researched.

export type StallState = "order" | "free" | "locked";

export interface Stall {
  index: number;
  state: StallState;
  order: TradeOrder | null;
  swap: TradeSwap | null; // what this stall's order swapped yesterday
  tech: TechDef | null; // the tech that opens a locked stall
  researching: boolean; // that tech is being researched now
}

export interface MarketView {
  stalls: Stall[];
  slots: number;
  limits: boolean;
  volume: number; // points of goods the market workers can move in a day
  used: number; // share of it the orders used yesterday, 0..1
}

const pair = (o: { give: string; get: string }) => `${o.give}>${o.get}`;

export function marketView(p: Pick<ProgressState, "techs" | "research"> | undefined, orders: readonly TradeOrder[], swaps: readonly TradeSwap[] | undefined, traders: number): MarketView {
  const slots = tradeSlots(p);
  const volume = TRADE.perWorker * Math.max(0, traders);
  // the techs that open stalls, in the tree's order; the ones not researched shut the stalls past the open ones
  const closed = TECHS.filter((t) => (t.modifiers?.tradeOrders ?? 0) > 0 && !p?.techs.includes(t.id));
  const shut: TechDef[] = closed.flatMap((t) => Array.from({ length: t.modifiers!.tradeOrders! }, () => t));
  const stalls: Stall[] = [];
  let used = 0;
  for (let i = 0; i < MAX_TRADE_SLOTS; i++) {
    const order = orders[i] ?? null;
    const swap = order ? (swaps?.find((w) => pair(w) === pair(order)) ?? null) : null;
    const points = swap ? swap.gave * TRADE.value[swap.give] : 0;
    used += points;
    const tech = i >= slots ? (shut[i - slots] ?? null) : null;
    stalls.push({
      index: i,
      state: i >= slots ? "locked" : order ? "order" : "free",
      order: i < slots ? order : null,
      swap,
      tech,
      researching: !!tech && p?.research.active?.techId === tech.id,
    });
  }
  return { stalls, slots, limits: tradeLimits(p), volume, used: volume > 0 ? Math.min(1, used / volume) : 0 };
}

// The stall the window opens on: the first free one, else the first.
export const firstStall = (v: MarketView): number => v.stalls.find((s) => s.state === "free")?.index ?? 0;

// Names a stall gets until the player gives it one: picked per town (by its founding moment), never twice in one market.
const STALL_NAMES = [
  L("Угловой прилавок", "Corner stall"),
  L("У ворот", "By the gate"),
  L("Под липой", "Under the linden"),
  L("Высокий навес", "High awning"),
  L("Весовой ряд", "Scales row"),
  L("Дальний ряд", "Far row"),
  L("У колодца", "By the well"),
  L("Солнечный ряд", "Sunny row"),
  L("Пёстрый навес", "Motley awning"),
  L("Старый прилавок", "Old stall"),
  L("Речной ряд", "River row"),
  L("Тихий угол", "Quiet corner"),
  L("Ранний прилавок", "Early stall"),
  L("Длинный стол", "Long table"),
  L("Крайний ряд", "End row"),
  L("Северный ряд", "North row"),
];

export function generatedStallName(index: number, seed: number): string {
  let h = Math.floor(Math.abs(seed)) % 2147483647;
  h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 3266489909) >>> 0;
  // a step coprime with the list's length keeps the stalls of one market apart
  return STALL_NAMES[(h + index * 5) % STALL_NAMES.length];
}

// The stall's name: the player's, else the generated one.
export const stallName = (index: number, seed: number, names: readonly string[] | undefined): string => names?.[index]?.trim() || generatedStallName(index, seed);
