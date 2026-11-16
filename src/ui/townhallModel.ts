import type { Effect, HistoryKey, HistoryRow } from "../sim/government";
import { YEAR_DAYS } from "../sim/time";
import { L } from "../i18n";

// The town hall window (TownhallPanel.tsx) as data: the effects in words and the records as a chart.

export interface Chip {
  text: string;
  tone: "ok" | "bad";
}

const sign = (v: number): string => (v > 0 ? `+${v}` : `−${-v}`);
const pctOf = (v: number): number => Math.round(v * 100);

// An effect as short chips: «настроение +4», «управление −25 %». Zero parts are left out.
export function effectChips(e: Partial<Effect>): Chip[] {
  const out: Chip[] = [];
  const add = (v: number | undefined, text: (n: string) => string) => {
    if (!v) return;
    out.push({ text: text(sign(v)), tone: v > 0 ? "ok" : "bad" });
  };
  add(e.mood ? Math.round(e.mood) : 0, (n) => L(`настроение ${n}`, `mood ${n}`));
  add(e.manage ? pctOf(e.manage) : 0, (n) => L(`управление ${n} %`, `administration ${n}%`));
  add(e.attract ? pctOf(e.attract) : 0, (n) => L(`привлекательность ${n} %`, `attractiveness ${n}%`));
  add(e.work ? pctOf(e.work) : 0, (n) => L(`работа ${n} %`, `work ${n}%`));
  return out;
}

export const SERIES: Record<HistoryKey, { label: string; unit: string }> = {
  pop: { label: L("Жители", "Residents"), unit: L("чел.", "people") },
  mood: { label: L("Настроение", "Mood"), unit: L("из 100", "of 100") },
  food: { label: L("Еда", "Food"), unit: L("кг", "kg") },
  logs: { label: L("Брёвна", "Logs"), unit: L("м³", "m³") },
  planks: { label: L("Доски", "Planks"), unit: L("м³", "m³") },
  stone: { label: L("Камень", "Stone"), unit: L("т", "t") },
  goods: { label: L("Товары", "Goods"), unit: L("шт", "pcs") },
  tools: { label: L("Инструменты", "Tools"), unit: L("шт", "pcs") },
};

export interface Chart {
  line: string; // svg path in a 0..w x 0..h box, y down
  area: string;
  min: number;
  max: number;
  last: number;
  yearAgo: number | null; // the value a year before the last row, when the records go back that far
  years: { x: number; year: number }[]; // where each year begins
}

// The records of one series as a chart `w` x `h`: a line, the area under it, the range and the year marks.
export function chartOf(rows: readonly HistoryRow[], key: HistoryKey, w: number, h: number): Chart | null {
  if (rows.length === 0) return null;
  const first = rows[0].day;
  const span = Math.max(1, rows[rows.length - 1].day - first);
  let min = Infinity;
  let max = -Infinity;
  for (const r of rows) {
    min = Math.min(min, r[key]);
    max = Math.max(max, r[key]);
  }
  const lo = Math.min(0, min); // the stocks and the people are measured from zero
  const hi = max > lo ? max : lo + 1;
  const xOf = (day: number) => (rows.length === 1 ? w / 2 : ((day - first) / span) * w);
  const yOf = (v: number) => h - ((v - lo) / (hi - lo)) * h;
  const pts = rows.map((r) => `${xOf(r.day).toFixed(1)},${yOf(r[key]).toFixed(1)}`);
  const line = `M${pts.join("L")}`;
  const area = `${line}L${xOf(rows[rows.length - 1].day).toFixed(1)},${h}L${xOf(first).toFixed(1)},${h}Z`;
  const last = rows[rows.length - 1];
  const before = rows.find((r) => r.day >= last.day - YEAR_DAYS);
  const years: Chart["years"] = [];
  for (let y = Math.ceil(first / YEAR_DAYS); y * YEAR_DAYS <= last.day; y++) years.push({ x: xOf(y * YEAR_DAYS), year: y + 1 });
  return { line, area, min, max, last: last[key], yearAgo: before && last.day - before.day >= YEAR_DAYS - 1 ? before[key] : null, years };
}

// The row nearest to a point `x` of `w` across the chart.
export function rowAt(rows: readonly HistoryRow[], x: number, w: number): HistoryRow | null {
  if (rows.length === 0) return null;
  const first = rows[0].day;
  const span = Math.max(1, rows[rows.length - 1].day - first);
  const day = first + (Math.min(w, Math.max(0, x)) / w) * span;
  let best = rows[0];
  for (const r of rows) if (Math.abs(r.day - day) < Math.abs(best.day - day)) best = r;
  return best;
}
