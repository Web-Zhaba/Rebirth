import { describe, expect, it } from "vitest";
import { START_MINUTE_OF_DAY } from "./clock";
import { etaRealMs, formatReal } from "./buildEta";

// gameMinutes 0 is 06:00; 60 is 07:00.
describe("etaRealMs", () => {
  it("is infinite when paused or without builders", () => {
    expect(etaRealMs(10, 5, 60, 0)).toBe(Infinity);
    expect(etaRealMs(10, 0, 60, 1)).toBe(Infinity);
    expect(etaRealMs(0, 0, 60, 0)).toBe(0);
  });
  it("is person-hours / hands in game hours at 1x inside the working day", () => {
    expect(START_MINUTE_OF_DAY).toBe(360);
    // 60 person-hours by 10 builders = 6 game hours = 360 game minutes at 250 ms each
    expect(etaRealMs(60, 10, 60, 1)).toBeCloseTo(360 * 250, -2);
  });
  it("halves at 2x and waits out the night", () => {
    expect(etaRealMs(60, 10, 60, 2)).toBeCloseTo(180 * 250, -2);
    const morning = etaRealMs(10, 10, 60, 1); // 1 h
    const evening = etaRealMs(10, 10, 60 + 12 * 60, 1); // starts 19:00, waits for 07:00
    expect(evening).toBeGreaterThan(morning * 2);
  });
});

describe("formatReal", () => {
  it("picks a unit", () => {
    expect(formatReal(40_000)).toBe("~40 с");
    expect(formatReal(180_000)).toBe("~3 мин");
    expect(formatReal(7_200_000)).toBe("~2 ч");
  });
});
