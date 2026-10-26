import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CALM, emptyWeather, type Weather, type WeatherState } from "../sim/weather";

const store = new Map<string, string>();
const stubStorage = () =>
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
  });

const setup = async () => {
  vi.resetModules();
  store.clear();
  stubStorage();
  return import("./weatherSound");
};

const ws = (now: Partial<Weather>, site = true): WeatherState => ({
  ...emptyWeather(),
  site: site ? { lat: 50, lng: 30, elev: 0, seed: 1, phase: 0 } : null,
  now: { ...CALM, ...now },
});

beforeEach(() => vi.unstubAllGlobals());
afterEach(() => vi.unstubAllGlobals());

describe("ambienceLevels", () => {
  it("is silent without weather or a site", async () => {
    const { ambienceLevels } = await setup();
    expect(ambienceLevels(null)).toEqual({ rain: 0, wind: 0, hush: 0 });
    expect(ambienceLevels(undefined)).toEqual({ rain: 0, wind: 0, hush: 0 });
    expect(ambienceLevels(ws({}, false))).toEqual({ rain: 0, wind: 0, hush: 0 });
  });

  it("is silent on a dry clear day", async () => {
    const { ambienceLevels } = await setup();
    expect(ambienceLevels(ws({ precip: 0, cloud: 0, wind: 2, snow: false }))).toEqual({ rain: 0, wind: 0, hush: 0 });
  });

  it("grows rain with precip and saturates", async () => {
    const { ambienceLevels } = await setup();
    const light = ambienceLevels(ws({ precip: 0.5 })).rain;
    const heavy = ambienceLevels(ws({ precip: 1.5 })).rain;
    const max = ambienceLevels(ws({ precip: 2.5 })).rain;
    expect(light).toBeGreaterThan(0);
    expect(heavy).toBeGreaterThan(light);
    expect(max).toBe(1);
  });

  it("switches rain off and raises hush in snow", async () => {
    const { ambienceLevels } = await setup();
    const snow = ambienceLevels(ws({ precip: 1.2, snow: true }));
    expect(snow.rain).toBe(0);
    expect(snow.hush).toBeGreaterThan(0);
    expect(ambienceLevels(ws({ precip: 1.2, snow: false })).hush).toBe(0);
  });

  it("grows wind and clamps it", async () => {
    const { ambienceLevels } = await setup();
    expect(ambienceLevels(ws({ wind: 2, cloud: 0 })).wind).toBe(0);
    expect(ambienceLevels(ws({ wind: 9, cloud: 0 })).wind).toBeGreaterThan(0);
    expect(ambienceLevels(ws({ wind: 100, cloud: 0 })).wind).toBe(1);
    expect(ambienceLevels(ws({ wind: 100, cloud: 1 })).wind).toBe(1);
  });

  it("lifts wind under heavy cloud", async () => {
    const { ambienceLevels } = await setup();
    const clear = ambienceLevels(ws({ wind: 9, cloud: 0 })).wind;
    const storm = ambienceLevels(ws({ wind: 9, cloud: 1 })).wind;
    expect(storm).toBeGreaterThan(clear);
  });
});

describe("weather sound setting", () => {
  it("is off by default", async () => {
    const s = await setup();
    expect(s.weatherSoundOn.value).toBe(false);
  });

  it("persists and reloads", async () => {
    const s = await setup();
    s.setWeatherSound(true);
    expect(s.weatherSoundOn.value).toBe(true);
    expect(store.get("rebirth.weatherSound")).toBe("1");

    vi.resetModules();
    const again = await import("./weatherSound");
    expect(again.weatherSoundOn.value).toBe(true);
  });

  it("survives broken storage", async () => {
    const s = await setup();
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("x");
      },
      setItem: () => {
        throw new Error("x");
      },
    });
    expect(() => s.setWeatherSound(true)).not.toThrow();
    expect(s.weatherSoundOn.value).toBe(true);
  });

  it("does not throw without AudioContext", async () => {
    const s = await setup();
    expect(() => s.setWeatherSound(true)).not.toThrow();
    expect(() => s.setWeatherSound(false)).not.toThrow();
  });
});
