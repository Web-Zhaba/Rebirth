import { describe, expect, it } from "vitest";
import { DAY_SUMMARY_MS, daySummaryRemaining } from "./daySummaryTimerModel";

describe("day summary timer", () => {
  it("lasts exactly three real seconds", () => {
    expect(DAY_SUMMARY_MS).toBe(3000);
    expect(daySummaryRemaining(0)).toBe(1);
    expect(daySummaryRemaining(1500)).toBe(0.5);
    expect(daySummaryRemaining(3000)).toBe(0);
  });

  it("clamps elapsed time outside the timer range", () => {
    expect(daySummaryRemaining(-100)).toBe(1);
    expect(daySummaryRemaining(4000)).toBe(0);
  });
});
