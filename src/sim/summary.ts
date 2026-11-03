import { peopleStats } from "./people";
import { GOOD } from "./production";
import { massText } from "./units";
import { dayStart } from "./time";
import type { DaySummary, SimState, Stock, SummaryLine, TownEvent } from "./types";
import { decimal, L, plural } from "../i18n";

// The card stays until 07:00 the next morning (nine hours after the 22:00 it was made).
export const SUMMARY_SHOWN_MIN = 9 * 60;
export const summaryShown = (summary: DaySummary | null, gameMinutes: number): summary is DaySummary =>
  !!summary && gameMinutes >= summary.at && gameMinutes < summary.at + SUMMARY_SHOWN_MIN;

const MAX_BUILT = 4; // built lines before the rest are folded into one

const volume = (v: number): string => decimal((Math.round(v * 10) / 10).toString());

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
  if (built.length > MAX_BUILT) lines.push({ kind: "built", text: L(`И ещё построено: ${built.length - MAX_BUILT}`, `And ${built.length - MAX_BUILT} more built`) });

  const arrivals = today.filter((e) => e.kind === "arrival");
  if (arrivals.length > 0) {
    const pos = arrivals.find((e) => e.pos)?.pos;
    lines.push({ kind: "arrived", text: L(`Приехало ${arrivals.length} ${plural(arrivals.length, "семья", "семьи", "семей")}`, `${arrivals.length} ${plural(arrivals.length, "", "", "", "family", "families")} arrived`), ...(pos ? { pos } : {}) });
  }

  const births = today.filter((e) => e.kind === "birth").length;
  if (births > 0) lines.push({ kind: "born", text: L(`Родилось: ${births}`, `Born: ${births}`) });

  const made = madeToday(s);
  const parts: string[] = [];
  if (made.food >= 1) parts.push(L(`еды ${massText(made.food)}`, `food ${massText(made.food)}`));
  if (made.logs >= 0.05) parts.push(L(`брёвен ${volume(made.logs)} м³`, `logs ${volume(made.logs)} m³`));
  if (made.planks >= 0.05) parts.push(L(`досок ${volume(made.planks)} м³`, `planks ${volume(made.planks)} m³`));
  if (made.stone >= 0.05) parts.push(L(`камня ${volume(made.stone)} т`, `stone ${volume(made.stone)} t`));
  if (made.wares >= 0.05) parts.push(L(`товаров ${volume(made.wares)} шт.`, `goods ${volume(made.wares)} pcs`));
  if (parts.length > 0) lines.push({ kind: "made", text: L(`Сделано: ${parts.join(", ")}`, `Made: ${parts.join(", ")}`) });

  const seen = new Set<string>();
  for (const e of today) {
    if ((e.kind !== "shortage" && e.kind !== "food") || seen.has(e.text)) continue;
    seen.add(e.text);
    lines.push({ kind: "problem", text: e.text, ...(e.pos ? { pos: e.pos } : {}) });
  }
  if (s.prod.flags.hungry && !seen.has(L("Еда закончилась, люди голодают", "Food has run out, people are starving"))) lines.push({ kind: "problem", text: L("Люди голодают", "People are starving") });
  const ps = peopleStats(s);
  const needs = ps.needs;
  if (needs.starving > 0) lines.push({ kind: "problem", text: L(`Истощены: ${needs.starving}`, `Starving: ${needs.starving}`) });
  if (needs.tired > 0) lines.push({ kind: "problem", text: L(`Не высыпаются: ${needs.tired}`, `Not sleeping enough: ${needs.tired}`) });
  if (needs.lonely > 0) lines.push({ kind: "problem", text: L(`Одиноки: ${needs.lonely}`, `Lonely: ${needs.lonely}`) });
  if (needs.freezing > 0) lines.push({ kind: "problem", text: L(`Мёрзнут: ${needs.freezing}`, `Freezing: ${needs.freezing}`) });
  const idle = ps.unemployed;
  if (idle > 0) lines.push({ kind: "problem", text: L(`Без дела: ${idle} ${plural(idle, "взрослый", "взрослых", "взрослых")}`, `Idle: ${idle} ${plural(idle, "", "", "", "adult")}`) });

  return { at: s.gameMinutes, lines };
}
