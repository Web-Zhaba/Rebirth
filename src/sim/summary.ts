import { peopleStats } from "./people";
import { GOOD } from "./production";
import { massText } from "./units";
import { dayStart } from "./time";
import type { DaySummary, SimState, Stock, SummaryLine, TownEvent } from "./types";

// The card stays until 07:00 the next morning (nine hours after the 22:00 it was made).
export const SUMMARY_SHOWN_MIN = 9 * 60;
export const summaryShown = (summary: DaySummary | null, gameMinutes: number): summary is DaySummary =>
  !!summary && gameMinutes >= summary.at && gameMinutes < summary.at + SUMMARY_SHOWN_MIN;

const MAX_BUILT = 4; // built lines before the rest are folded into one

const plural = (n: number, one: string, few: string, many: string) => {
  const m = n % 100;
  if (m >= 11 && m <= 14) return many;
  return n % 10 === 1 ? one : n % 10 >= 2 && n % 10 <= 4 ? few : many;
};

const volume = (v: number): string => (Math.round(v * 10) / 10).toString().replace(".", ",");

// What the town made today: workshop output by good, plus the wares of the evening crafts (key 0 of prod.today).
export function madeToday(s: Pick<SimState, "prod" | "buildings">): Stock {
  const out: Stock = { food: 0, logs: 0, planks: 0, stone: 0, wares: 0 };
  for (const [key, n] of Object.entries(s.prod.today)) {
    const id = Number(key);
    const b = s.buildings[id];
    const g = b ? GOOD[b.template] : id === 0 ? "wares" : undefined;
    if (g) out[g] += n;
  }
  return out;
}

// «Итоги дня» assembled at 22:00 from the day's events, output and standing problems. Each line may carry a position.
export function daySummary(s: SimState): DaySummary {
  const from = dayStart(s.gameMinutes);
  const today: TownEvent[] = s.events.filter((e) => e.at >= from);
  const lines: SummaryLine[] = [];

  const built = today.filter((e) => e.kind === "built");
  for (const e of built.slice(0, MAX_BUILT)) lines.push({ kind: "built", text: e.text, ...(e.pos ? { pos: e.pos } : {}) });
  if (built.length > MAX_BUILT) lines.push({ kind: "built", text: `И ещё построено: ${built.length - MAX_BUILT}` });

  const arrivals = today.filter((e) => e.kind === "arrival");
  if (arrivals.length > 0) {
    const pos = arrivals.find((e) => e.pos)?.pos;
    lines.push({ kind: "arrived", text: `Приехало ${arrivals.length} ${plural(arrivals.length, "семья", "семьи", "семей")}`, ...(pos ? { pos } : {}) });
  }

  const births = today.filter((e) => e.kind === "birth").length;
  if (births > 0) lines.push({ kind: "born", text: `Родилось: ${births}` });

  const made = madeToday(s);
  const parts: string[] = [];
  if (made.food >= 1) parts.push(`провизии ${massText(made.food)}`);
  if (made.logs >= 0.05) parts.push(`брёвен ${volume(made.logs)} м³`);
  if (made.planks >= 0.05) parts.push(`досок ${volume(made.planks)} м³`);
  if (made.stone >= 0.05) parts.push(`камня ${volume(made.stone)} т`);
  if (made.wares >= 0.05) parts.push(`товаров ${volume(made.wares)} шт.`);
  if (parts.length > 0) lines.push({ kind: "made", text: `Сделано: ${parts.join(", ")}` });

  const seen = new Set<string>();
  for (const e of today) {
    if ((e.kind !== "shortage" && e.kind !== "food") || seen.has(e.text)) continue;
    seen.add(e.text);
    lines.push({ kind: "problem", text: e.text, ...(e.pos ? { pos: e.pos } : {}) });
  }
  if (s.prod.flags.hungry && !seen.has("Провизия закончилась, люди голодают")) lines.push({ kind: "problem", text: "Люди голодают" });
  const idle = peopleStats(s).unemployed;
  if (idle > 0) lines.push({ kind: "problem", text: `Без дела: ${idle} ${plural(idle, "взрослый", "взрослых", "взрослых")}` });

  return { at: s.gameMinutes, lines };
}
