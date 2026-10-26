import { describe, expect, it } from "vitest";
import { step } from "./clock";
import { emptyGrowth, seedOf } from "./growth";
import { Handler, type Storage } from "./handler";
import type { FromWorker } from "./protocol";
import { emptyRoads } from "./roads";
import { parseSave } from "./save";
import { DAY_MIN, YEAR_MIN, calendar } from "./time";
import type { City, SaveV4, SimState } from "./types";
import { cloudField, climate, emptyWeather, startWeather, sunDirection, weatherAt, weatherStep, yearFrac, type WeatherSite } from "./weather";
import { emptyZones } from "./zones";

const site = (lat: number, elev = 0, lng = 20, phase = 0): WeatherSite => ({ lat, lng, elev, seed: 4242, phase });
const NOW = 1_800_000_000_000;
const city: City = { name: "Тест", lat: 50, lng: 30, foundedAt: NOW - 1000 };
const fresh = (w = emptyWeather(), gameMinutes = 0): SimState => ({ realTime: NOW, gameMinutes, roads: emptyRoads(), zones: emptyZones(), ...emptyGrowth(seedOf(city.foundedAt)), weather: w });
const SUMMER = 0.25 * YEAR_MIN - 360;
const WINTER = 0.75 * YEAR_MIN - 360;

describe("climate and weather", () => {
  it("is deterministic", () => {
    const a = weatherAt(site(45), 5000);
    expect(weatherAt(site(45), 5000)).toEqual(a);
    expect(cloudField(10, 45, 5000, 4242, 0)).toEqual(cloudField(10, 45, 5000, 4242, 0));
    expect(weatherAt({ ...site(45), seed: 1 }, 5000)).not.toEqual(a);
  });

  it("is warmer at the equator than at 60 and at the pole", () => {
    for (const f of [0, 0.25, 0.5, 0.75]) {
      const e = climate(0, 0, f).mean;
      expect(e).toBeGreaterThan(climate(60, 0, f).mean);
      expect(e).toBeGreaterThan(climate(90, 0, f).mean);
    }
  });

  it("flips the seasons between hemispheres and grows the amplitude with latitude", () => {
    expect(climate(50, 0, 0.33).mean).toBeGreaterThan(climate(50, 0, 0.83).mean);
    expect(climate(-50, 0, 0.83).mean).toBeGreaterThan(climate(-50, 0, 0.33).mean);
    expect(climate(50, 0, 0.33).mean).toBeCloseTo(climate(-50, 0, 0.83).mean, 6);
    const amp = (lat: number) => climate(lat, 0, 0.33).mean - climate(lat, 0, 0.83).mean;
    expect(amp(10)).toBeLessThan(amp(30));
    expect(amp(30)).toBeLessThan(amp(55));
    expect(amp(55)).toBeLessThan(amp(75));
  });

  it("cools 6.5 degrees per km", () => {
    expect(climate(40, 0, 0.3).mean - climate(40, 1000, 0.3).mean).toBeCloseTo(6.5, 6);
  });

  it("changes temperature smoothly in time", () => {
    for (const lat of [0, 50, -35]) {
      let prev = weatherAt(site(lat), 0).temp;
      for (let t = 60; t < YEAR_MIN; t += 60) {
        const w = weatherAt(site(lat), t).temp;
        expect(Math.abs(w - prev)).toBeLessThan(4);
        prev = w;
      }
    }
  });

  it("keeps cloud and precipitation in range, rain only under thick cloud, snow only when cold", () => {
    let rained = 0;
    for (let i = 0; i < 4000; i++) {
      const w = weatherAt(site((i % 17) * 10 - 80, 200, (i % 7) * 50 - 150), i * 97);
      expect(w.cloud).toBeGreaterThanOrEqual(0);
      expect(w.cloud).toBeLessThanOrEqual(1);
      expect(w.precip).toBeGreaterThanOrEqual(0);
      if (w.precip > 0) {
        rained++;
        expect(w.cloud).toBeGreaterThan(0.6);
        expect(w.snow).toBe(w.temp < 0.5);
      } else expect(w.snow).toBe(false);
    }
    expect(rained).toBeGreaterThan(100);
  });

  it("gives a unit sun vector with the right declination and hour angle", () => {
    expect(Math.hypot(...sunDirection(12345, 0))).toBeCloseTo(1, 9);
    const dec = (t: number, p = 0) => (Math.asin(sunDirection(t, p)[2]) * 180) / Math.PI;
    expect(dec(-360)).toBeCloseTo(0, 6);
    expect(dec(SUMMER)).toBeCloseTo(23.44, 4);
    expect(dec(WINTER)).toBeCloseTo(-23.44, 4);
    expect(dec(SUMMER, 0.5)).toBeCloseTo(-23.44, 4);
    const lng = (t: number) => {
      const v = sunDirection(t, 0);
      return (Math.atan2(v[1], v[0]) * 180) / Math.PI;
    };
    const t = 3 * DAY_MIN + 600;
    const d = ((lng(t + 60) - lng(t) + 540) % 360) - 180;
    expect(d).toBeCloseTo(-15, 4);
    expect(lng(360)).toBeCloseTo(0, 4); // 12:00
  });

  it("counts the year from the local spring", () => {
    expect(yearFrac(-360, 0)).toBeCloseTo(0, 9);
    expect(yearFrac(-360, 0.5)).toBeCloseTo(0.5, 9);
    expect(calendar(YEAR_MIN).year).toBe(2);
  });

  it("has a plausible mid-latitude statistic over three years", () => {
    const s = site(50, 0);
    let sum = 0;
    let n = 0;
    let spring = 0;
    let wet = 0;
    for (let t = 0; t < 3 * YEAR_MIN; t += 60) {
      const w = weatherAt(s, t);
      sum += w.temp;
      n++;
      if (calendar(t).season === 0) {
        spring++;
        if (w.precip > 1) wet++;
      }
    }
    expect(Math.abs(sum / n - 9)).toBeLessThan(3);
    expect(wet / spring).toBeGreaterThan(0.05);
    expect(wet / spring).toBeLessThan(0.35);
  });
});

describe("state", () => {
  it("spins up snow at 65N in early spring, none at the equator", () => {
    expect(startWeather(site(65)).snowpack).toBeGreaterThan(0.05);
    expect(startWeather(site(65)).frozen).toBeGreaterThan(0);
    expect(startWeather(site(0)).snowpack).toBe(0);
    const w = startWeather(site(50));
    expect(w.soil).toBeGreaterThanOrEqual(0);
    expect(w.soil).toBeLessThanOrEqual(1);
    expect(w.crop).toBeGreaterThan(0);
  });

  it("is the identity without a site", () => {
    const s = fresh();
    const moved = { ...s, gameMinutes: 10 };
    expect(weatherStep(moved)).toBe(moved);
    expect(step(s).weather).toEqual(emptyWeather());
  });

  it("refreshes in step and rolls the day at midnight", () => {
    let s = fresh(startWeather(site(50)));
    const y0 = s.weather.yesterday;
    for (let i = 0; i < 144 * 2; i++) s = step(s);
    expect(s.weather.now).toEqual(weatherAt(site(50), s.gameMinutes));
    expect(s.weather.yesterday).not.toEqual(y0);
    expect(s.weather.day.min).toBeLessThanOrEqual(s.weather.day.max);
  });

  it("wets the soil in rain and dries it in dry hot weather", () => {
    let wetT = -1;
    let dryT = -1;
    for (let d = 0; d < 400 && (wetT < 0 || dryT < 0); d++) {
      const t = d * DAY_MIN;
      let rain = 0;
      let temp = 0;
      for (let h = 0; h < 72; h++) {
        const w = weatherAt(site(50), t + h * 60);
        rain += w.precip;
        temp += w.temp / 72;
      }
      if (wetT < 0 && rain > 40 && temp > 4) wetT = t;
      if (dryT < 0 && rain === 0 && temp > 18) dryT = t;
    }
    expect(wetT).toBeGreaterThanOrEqual(0);
    expect(dryT).toBeGreaterThanOrEqual(0);
    const soilAfter = (t0: number, soil: number) => {
      let s = fresh({ ...startWeather(site(50), t0), soil, snowpack: 0 }, t0);
      for (let i = 0; i < 144 * 3; i++) s = weatherStep({ ...s, gameMinutes: s.gameMinutes + 10 });
      return s.weather.soil;
    };
    expect(soilAfter(wetT, 0.3)).toBeGreaterThan(0.3);
    expect(soilAfter(dryT, 0.8)).toBeLessThan(0.8);
  });
});

describe("save and handler", () => {
  const raw = (s: SimState): unknown => JSON.parse(JSON.stringify({ version: 4, city, sim: s }));

  it("round-trips the weather and clamps a damaged one", () => {
    const w = startWeather(site(50, 120));
    const back = parseSave(raw(fresh(w)), NOW)!.sim.weather;
    expect(back.site).toEqual(w.site);
    expect(back.soil).toBeCloseTo(w.soil, 9);
    expect(back.crop).toBeCloseTo(w.crop, 9);
    const bad = raw(fresh(w)) as { sim: { weather: Record<string, unknown> } };
    bad.sim.weather.soil = 9;
    bad.sim.weather.ice = "x";
    bad.sim.weather.crop = 50;
    const p = parseSave(bad, NOW)!.sim.weather;
    expect(p.soil).toBe(1);
    expect(p.ice).toBe(0);
    expect(p.crop).toBe(1.2);
  });

  it("gives an old save without weather the calm state", () => {
    const old = raw(fresh()) as { sim: Record<string, unknown> };
    delete old.sim.weather;
    expect(parseSave(old, NOW)!.sim.weather).toEqual(emptyWeather());
    old.sim.weather = { site: { lat: "x" } };
    expect(parseSave(old, NOW)!.sim.weather.site).toBeNull();
  });

  function setup(initial: unknown, elevation?: (lng: number, lat: number) => Promise<number>) {
    let stored: unknown = initial;
    const storage: Storage = { get: async () => stored, put: async (s) => void (stored = s), clear: async () => void (stored = undefined) };
    const out: FromWorker[] = [];
    return { h: new Handler(storage, (m) => out.push(m), undefined, elevation), out, get: () => stored as SaveV4 };
  }

  it("sets the site on founding with the sampled elevation", async () => {
    const t = setup(undefined, async () => 321);
    await t.h.handle({ t: "found", city, now: NOW });
    expect(t.get().sim.weather.site).toEqual({ lat: 50, lng: 30, elev: 321, seed: seedOf(city.foundedAt), phase: 0 });
    const south = setup(undefined);
    await south.h.handle({ t: "found", city: { ...city, lat: -40 }, now: NOW });
    expect(south.get().sim.weather.site).toMatchObject({ elev: 0, phase: 0.5 });
  });

  it("falls back to 0 m when the elevation fails and sets the site on loading an old save", async () => {
    const old = raw(fresh()) as { sim: Record<string, unknown> };
    delete old.sim.weather;
    const t = setup(old, async () => {
      throw new Error("no dem");
    });
    await t.h.handle({ t: "load", legacy: null, now: NOW });
    await t.h.idle();
    const sim = t.get().sim;
    expect(sim.weather.site).toMatchObject({ lat: 50, lng: 30, elev: 0 });
    expect(sim.gameMinutes).toBe(0);
  });
});

describe("calibration at 50N, 200 m", () => {
  it("keeps snow and soil in plausible ranges over three game years", () => {
    const s0 = { lat: 50, lng: 15, elev: 200, seed: 777, phase: 0 };
    let s = fresh(startWeather(s0));
    let snowMax = 0;
    let springLate = 0;
    let autumnEarly = 0;
    let sum = 0;
    let n = 0;
    let hi = 0;
    let lo = 0;
    for (let i = 0; i < (3 * YEAR_MIN) / 10; i++) {
      s = weatherStep({ ...s, gameMinutes: s.gameMinutes + 10 });
      const w = s.weather;
      const day = Math.floor((s.gameMinutes + 360) / DAY_MIN) % 32; // 0-based day of the year
      snowMax = Math.max(snowMax, w.snowpack);
      if (day >= 5 && day < 8) springLate = Math.max(springLate, w.snowpack); // game days 6-8
      if (day >= 16 && day < 22) autumnEarly = Math.max(autumnEarly, w.snowpack); // game days 17-22
      sum += w.soil;
      n++;
      if (w.soil > 0.95) hi++;
      if (w.soil < 0.1) lo++;
    }
    expect(snowMax).toBeGreaterThan(0.1);
    expect(snowMax).toBeLessThan(1);
    expect(springLate).toBeLessThan(0.05);
    expect(autumnEarly).toBeLessThan(0.05);
    expect(sum / n).toBeGreaterThan(0.4);
    expect(sum / n).toBeLessThan(0.75);
    expect(hi / n).toBeLessThan(0.05);
    expect(lo / n).toBeLessThan(0.05);
  });
});

// East-west to north-south correlation-length ratio of the cloud cover around `lat`, over many times: the ratio of the
// rms cover difference across a physical separation along a meridian to the one along a parallel. 1 is isotropic,
// big means stripes running east-west.
function anisotropy(lat: number, seed: number): number {
  const sep = 3; // degrees of arc
  const dLng = sep / Math.cos(lat * (Math.PI / 180));
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (let d = 0; d < 96; d += 2.5) {
    const t = d * DAY_MIN;
    for (let la = lat - 5; la <= lat + 5; la += 2.5) {
      for (let lg = 0; lg < 360; lg += 6) {
        const c = cloudField(lg, la, t, seed, 0).cloud;
        sx += (cloudField(lg + dLng, la, t, seed, 0).cloud - c) ** 2;
        sy += (cloudField(lg, la + sep, t, seed, 0).cloud - c) ** 2;
        n++;
      }
    }
  }
  return Math.sqrt(sy / sx);
}

describe("cloud field shear", () => {
  it("does not stripe the clouds east-west where the zonal wind turns over", () => {
    const r = [1, 2, 3].map((seed) => anisotropy(30, seed) / anisotropy(50, seed));
    for (const x of r) expect(x).toBeLessThan(1.4);
  });

  it("still moves the fronts east in mid-latitudes and west in the tropics", () => {
    // lng shift that best explains the cover half a game day later, averaged over many times
    const drift = (lat: number) => {
      const dt = 0.5;
      let best = 0;
      let bestErr = Infinity;
      for (let sh = -20; sh <= 20; sh += 1) {
        let err = 0;
        for (let d = 0; d < 60; d += 3) {
          for (let lg = 0; lg < 360; lg += 10) {
            err += (cloudField(lg, lat, d * DAY_MIN, 5, 0).cloud - cloudField(lg + sh, lat, (d + dt) * DAY_MIN, 5, 0).cloud) ** 2;
          }
        }
        if (err < bestErr) {
          bestErr = err;
          best = sh;
        }
      }
      return best / dt; // degrees of longitude per game day, eastward positive
    };
    expect(drift(50)).toBeGreaterThan(8);
    expect(drift(50)).toBeLessThan(16);
    expect(drift(0)).toBeLessThan(-3);
  });
});

describe("cloud climatology", () => {
  // mean cover over a deterministic sample of times and longitudes
  const meanCover = (lats: number[], lng0 = 0, lng1 = 360) => {
    let sum = 0;
    let n = 0;
    for (let d = 0; d < 128; d += 3.7) {
      for (const lat of lats) {
        for (let lg = lng0; lg < lng1; lg += 7) {
          sum += cloudField(lg, lat, d * DAY_MIN, 11, 0).cloud;
          n++;
        }
      }
    }
    return sum / n;
  };
  it("keeps the subtropical highs clear, the ITCZ and the storm tracks cloudy", () => {
    expect(meanCover([20, 22, 25, 28, 30], 0, 30)).toBeLessThan(0.3);
    expect(meanCover([0, 4, 8])).toBeGreaterThan(0.55);
    const mid = meanCover([45, 50, 55]);
    expect(mid).toBeGreaterThan(0.5);
    expect(mid).toBeLessThan(0.75);
  });
});
