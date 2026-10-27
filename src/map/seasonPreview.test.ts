import { describe, expect, it } from "vitest";
import { calendar } from "../sim/clock";
import type { WeatherState } from "../sim/weather";
import { seasonClock, seasonWeather } from "./seasonPreview";

describe("season preview", () => {
  const now = 3 * 8 * 1440 + 2 * 1440 + 600; // a day into autumn, mid-morning
  it("moves the clock into the season, keeping the day of the season and the hour", () => {
    for (const season of [0, 1, 2, 3]) {
      const c = calendar(seasonClock(now, season)), was = calendar(now);
      expect(c.season).toBe(season);
      expect([c.dayOfSeason, c.hour, c.minute]).toEqual([was.dayOfSeason, was.hour, was.minute]);
      expect(seasonClock(now, season)).toBeGreaterThanOrEqual(now);
    }
    expect(seasonClock(now, null)).toBe(now);
  });
  it("lays snow and ice in winter only", () => {
    const w = { snowpack: 0.1, ice: 0.3, frozen: 0.5, now: { temp: 2, cloud: 0.5, precip: 1, snow: false, wind: 3 } } as WeatherState;
    expect(seasonWeather(w, 3)).toMatchObject({ snowpack: 0.4, ice: 1, now: { snow: true } });
    expect(seasonWeather(w, 1)).toMatchObject({ snowpack: 0, ice: 0, now: { snow: false } });
    expect(seasonWeather(w, null)).toBe(w);
  });
});
