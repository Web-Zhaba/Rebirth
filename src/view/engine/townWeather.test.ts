import { describe, expect, it } from "vitest";
import type { WeatherState } from "../../sim/weather";
import { mppAtZoom, zoomAtMpp } from "../view";
import { climateGround, townShare, townWeather, wetness } from "./townWeather";

const state = (now: Partial<WeatherState["now"]>, rest: Partial<WeatherState> = {}): WeatherState =>
  ({ now: { temp: 5, cloud: 0.5, precip: 0, snow: false, wind: 3, ...now }, snowpack: 0, ice: 0, soil: 0.3, ...rest }) as WeatherState;

describe("town weather", () => {
  it("is null with no weather and no override", () => {
    expect(townWeather(null, {})).toBeNull();
  });
  it("takes the sim's weather and lets the DEV override win", () => {
    const w = state({ precip: 1.2, snow: true, wind: 7 }, { snowpack: 0.3, ice: 0.4, soil: 0.9 });
    expect(townWeather(w, {})).toEqual({ snowpack: 0.3, ice: 0.4, precip: 1.2, snowing: true, wind: 7, soil: 0.9 });
    expect(townWeather(w, { precip: 3, snowing: false })).toMatchObject({ precip: 3, snowing: false, snowpack: 0.3 });
    expect(townWeather(null, { snowpack: 0.5 })).toMatchObject({ snowpack: 0.5, precip: 0, snowing: false });
  });
});

describe("wetness", () => {
  it("is dry without rain on a dry soil", () => {
    expect(wetness(0, false, 0.3)).toBe(0);
  });
  it("grows with the rain, not with falling snow", () => {
    expect(wetness(0.5, false, 0.3)).toBeGreaterThan(0);
    expect(wetness(2, false, 0.3)).toBe(1);
    expect(wetness(2, true, 0.3)).toBe(0);
  });
  it("stays a little wet on a soaked soil after the rain", () => {
    expect(wetness(0, false, 1)).toBeCloseTo(0.5);
  });
});

describe("zoomAtMpp", () => {
  it("inverts mppAtZoom", () => {
    for (const z of [2, 6.5, 12, 15.5]) expect(zoomAtMpp(mppAtZoom(z))).toBeCloseTo(z, 9);
  });
});

describe("climate on the ground", () => {
  it("snows and freezes in the cold, wets the warm ground under rain", () => {
    const cold = climateGround({ cover: 1, precip: 0.5, temp: -12 }, 0, 1.3);
    expect(cold).toMatchObject({ snow: 1, wet: 0, ice: 1, snowing: true });
    const warm = climateGround({ cover: 1, precip: 0.5, temp: 15 }, 0, 1.3);
    expect(warm).toMatchObject({ snow: 0, wet: 1, ice: 0, snowing: false });
    expect(warm.precip).toBeCloseTo(0.65);
  });
  it("gets colder with height (6.5 °C per km)", () => {
    expect(climateGround({ cover: 0, precip: 0, temp: 8 }, 0, 1.3).snow).toBe(0);
    expect(climateGround({ cover: 0, precip: 0, temp: 8 }, 2500, 1.3).snow).toBe(1);
  });
  it("hands the ground over from the town to the climate between 20 and 60 km", () => {
    expect(townShare(10000)).toBe(1);
    expect(townShare(40000)).toBeCloseTo(0.5);
    expect(townShare(80000)).toBe(0);
  });
});
