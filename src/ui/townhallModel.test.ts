import { describe, expect, it } from "vitest";
import type { HistoryRow } from "../sim/government";
import { YEAR_DAYS } from "../sim/time";
import { chartOf, effectChips, rowAt } from "./townhallModel";

const row = (day: number, pop: number): HistoryRow => ({ day, pop, mood: 50, food: 0, logs: 0, planks: 0, stone: 0, goods: 0, tools: 0 });

describe("the town hall window", () => {
  it("puts an effect into signed chips, leaving zeros out", () => {
    expect(effectChips({ mood: 4, manage: -0.25, work: 0 })).toEqual([
      { text: "настроение +4", tone: "ok" },
      { text: "управление −25 %", tone: "bad" },
    ]);
  });

  it("draws the records from zero up, with a mark at each new year and the change over a year", () => {
    const rows = [row(YEAR_DAYS - 2, 10), row(YEAR_DAYS, 20), row(2 * YEAR_DAYS - 1, 40)];
    const c = chartOf(rows, "pop", 100, 50)!;
    expect(c.min).toBe(10);
    expect(c.max).toBe(40);
    expect(c.line.startsWith("M0.0,37.5")).toBe(true); // 10 of 40, from the bottom
    expect(c.years.map((y) => y.year)).toEqual([2]);
    expect(c.yearAgo).toBe(20); // the first row a year or less before the last
    expect(chartOf([], "pop", 100, 50)).toBeNull();
    expect(rowAt(rows, 100, 100)).toBe(rows[2]);
  });
});
