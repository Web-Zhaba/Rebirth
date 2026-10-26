import { describe, expect, it } from "vitest";
import { emptyWeather, type WeatherState } from "../sim/weather";
import { condition, cropText, tempText, weatherChip } from "./weatherModel";

const w = (o: Partial<Parameters<typeof condition>[0]> = {}) => ({ cloud: 0, precip: 0, snow: false, wind: 3, ...o });

describe("condition", () => {
  it("picks by cloud cover when dry", () => {
    expect(condition(w())).toBe("clear");
    expect(condition(w({ cloud: 0.4 }))).toBe("partly");
    expect(condition(w({ cloud: 0.8 }))).toBe("overcast");
  });
  it("rain and downpour at 3 mm/h", () => {
    expect(condition(w({ cloud: 0.9, precip: 1 }))).toBe("rain");
    expect(condition(w({ cloud: 0.9, precip: 3.5 }))).toBe("downpour");
  });
  it("snow and blizzard at wind 12", () => {
    expect(condition(w({ cloud: 0.9, precip: 1, snow: true, wind: 8 }))).toBe("snow");
    expect(condition(w({ cloud: 0.9, precip: 1, snow: true, wind: 13 }))).toBe("blizzard");
  });
  it("hurricane over 20 m/s wins", () => {
    expect(condition(w({ wind: 21, precip: 2 }))).toBe("hurricane");
    expect(condition(w({ wind: 20 }))).toBe("clear");
  });
});

describe("text", () => {
  it("uses a true minus and no negative zero", () => {
    expect(tempText(-3.4)).toBe("−3°C");
    expect(tempText(-0.2)).toBe("0°C");
    expect(tempText(21.6)).toBe("22°C");
  });
  it("crop estimate only before winter", () => {
    expect(cropText(0.853, 1)).toBe("урожай ~85 %");
    expect(cropText(0.853, 3)).toBeNull();
  });
});

describe("weatherChip", () => {
  const site = { lat: 50, lng: 14, elev: 200, seed: 1, phase: 0 };
  it("is hidden without a site", () => {
    expect(weatherChip(emptyWeather(), 0)).toBeNull();
    expect(weatherChip(undefined, 0)).toBeNull();
  });
  it("lists details and flags", () => {
    const ws: WeatherState = { ...emptyWeather(), site, now: { temp: -5, cloud: 0.9, precip: 0.5, snow: true, wind: 6 }, snowpack: 0.12, frozen: 0.8, ice: 0.1, soil: 0.42 };
    const c = weatherChip(ws, 3)!;
    expect(c.temp).toBe("−5°C");
    expect(c.word).toBe("снег");
    expect(c.rows.map((r) => r.value)).toEqual(["6 м/с", "0,5 мм/ч", "42 %", "12 см"]);
    expect(c.notes).toEqual(["Земля промёрзла"]);
  });
});
