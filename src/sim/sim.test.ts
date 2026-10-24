import { describe, expect, it } from "vitest";
import { advanceTo, BASE_TICK, calendar, daylight, OFFLINE_CAP, TICK_MS } from "./clock";
import { Handler, type Storage } from "./handler";
import type { FromWorker } from "./protocol";
import { migrateLegacy, parseSaveV3 } from "./save";
import type { City, SaveV3 } from "./types";

const NOW = 1_800_000_000_000;
const city: City = { name: "Череповец", lat: 59.12, lng: 37.9, foundedAt: NOW - 1000 };

describe("clock", () => {
  it("one-shot equals many increasing calls", () => {
    const start = { realTime: NOW, gameMinutes: 0 };
    let t = NOW;
    let s = start;
    let seed = 7;
    while (t < NOW + 3_600_000) {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      t += seed % 5000;
      s = advanceTo(s, t);
    }
    expect(s).toEqual(advanceTo(start, t));
  });
  it("runs whole ticks only", () => {
    const s = advanceTo({ realTime: NOW, gameMinutes: 0 }, NOW + 25_000);
    expect(s).toEqual({ realTime: NOW + 2 * TICK_MS, gameMinutes: 2 * BASE_TICK });
  });
  it("caps offline gap", () => {
    const s = advanceTo({ realTime: NOW, gameMinutes: 0 }, NOW + 3 * OFFLINE_CAP);
    expect(s.gameMinutes).toBe((OFFLINE_CAP / 1000) * 1);
    expect(s.realTime).toBe(NOW + 3 * OFFLINE_CAP);
  });
  it("calendar start, rollover", () => {
    expect(calendar(0)).toEqual({ year: 1, season: 0, dayOfSeason: 1, dayOfYear: 1, hour: 6, minute: 0 });
    expect(calendar(18 * 60)).toMatchObject({ dayOfSeason: 2, hour: 0, minute: 0 });
    expect(calendar(90 * 1440)).toMatchObject({ season: 1, dayOfSeason: 1, hour: 6 });
    const y2 = calendar(360 * 1440);
    expect(y2).toMatchObject({ year: 2, season: 0, dayOfSeason: 1, dayOfYear: 1 });
    expect(calendar(359 * 1440)).toMatchObject({ year: 1, season: 3, dayOfSeason: 90, dayOfYear: 360 });
  });
  it("daylight extremes", () => {
    expect(daylight(0)).toBe(0);
    expect(daylight(3)).toBe(0);
    expect(daylight(12)).toBe(1);
    expect(daylight(23)).toBe(0);
    const dawn = daylight(6);
    expect(dawn).toBeGreaterThan(0);
    expect(dawn).toBeLessThan(1);
  });
});

describe("save", () => {
  const valid: SaveV3 = { version: 3, city, sim: { realTime: NOW, gameMinutes: 50 } };
  it("accepts valid", () => {
    expect(parseSaveV3(valid, NOW)).toEqual(valid);
  });
  it("rejects garbage", () => {
    expect(parseSaveV3(null, NOW)).toBeNull();
    expect(parseSaveV3("x", NOW)).toBeNull();
    expect(parseSaveV3({ ...valid, version: 2 }, NOW)).toBeNull();
    expect(parseSaveV3({ ...valid, city: { ...city, name: "" } }, NOW)).toBeNull();
    expect(parseSaveV3({ ...valid, city: { ...city, name: "x".repeat(41) } }, NOW)).toBeNull();
    expect(parseSaveV3({ ...valid, city: { ...city, lat: 91 } }, NOW)).toBeNull();
    expect(parseSaveV3({ ...valid, sim: { realTime: NOW + 120_000, gameMinutes: 0 } }, NOW)).toBeNull();
    expect(parseSaveV3({ ...valid, sim: { realTime: NOW, gameMinutes: -1 } }, NOW)).toBeNull();
    expect(parseSaveV3({ ...valid, sim: { realTime: NaN, gameMinutes: 0 } }, NOW)).toBeNull();
  });
  it("migrates v1 and v2", () => {
    const legacyCity = { ...city, cell: "891234" };
    for (const version of [1, 2]) {
      const raw = JSON.stringify({ version, city: legacyCity, economy: { food: 5 } });
      const s = migrateLegacy(raw, NOW)!;
      expect(s).toEqual({ version: 3, city, sim: { realTime: NOW, gameMinutes: 0 } });
      expect(s.city).not.toHaveProperty("cell");
    }
  });
  it("rejects bad legacy", () => {
    expect(migrateLegacy("not json", NOW)).toBeNull();
    expect(migrateLegacy(JSON.stringify({ version: 3, city }), NOW)).toBeNull();
    expect(migrateLegacy(JSON.stringify({ version: 2, city: { ...city, name: 5 } }), NOW)).toBeNull();
  });
});

function setup(initial: unknown = undefined) {
  let stored: unknown = initial;
  let puts = 0;
  const storage: Storage = {
    get: async () => stored,
    put: async (s) => {
      stored = s;
      puts++;
    },
    clear: async () => {
      stored = undefined;
    },
  };
  const out: FromWorker[] = [];
  const h = new Handler(storage, (m) => out.push(m));
  return { h, out, get: () => stored, puts: () => puts };
}

describe("handler", () => {
  it("load with nothing", async () => {
    const { h, out } = setup();
    await h.handle({ t: "load", legacy: null, now: NOW });
    expect(out).toEqual([{ t: "loaded", save: null, migrated: false, away: null }]);
  });
  it("load legacy migrates and persists", async () => {
    const { h, out, get } = setup();
    const legacy = JSON.stringify({ version: 2, city: { ...city, cell: "x" }, economy: {} });
    await h.handle({ t: "load", legacy, now: NOW });
    const m = out[0] as Extract<FromWorker, { t: "loaded" }>;
    expect(m.migrated).toBe(true);
    expect(m.save?.city).toEqual(city);
    expect(m.away).toBeNull();
    expect((get() as SaveV3).version).toBe(3);
  });
  it("load existing reports away", async () => {
    const saved: SaveV3 = { version: 3, city, sim: { realTime: NOW - 3_600_000, gameMinutes: 100 } };
    const { h, out, get } = setup(saved);
    await h.handle({ t: "load", legacy: null, now: NOW });
    const m = out[0] as Extract<FromWorker, { t: "loaded" }>;
    expect(m.migrated).toBe(false);
    expect(m.away).toEqual({ realMs: 3_600_000, gameMinutes: 3600 });
    expect(m.save?.sim.gameMinutes).toBe(3700);
    expect((get() as SaveV3).sim.gameMinutes).toBe(3700);
  });
  it("short gap gives no away report", async () => {
    const { h, out } = setup({ version: 3, city, sim: { realTime: NOW - 30_000, gameMinutes: 0 } });
    await h.handle({ t: "load", legacy: null, now: NOW });
    expect((out[0] as Extract<FromWorker, { t: "loaded" }>).away).toBeNull();
  });
  it("found", async () => {
    const { h, out, get } = setup();
    await h.handle({ t: "found", city, now: NOW });
    expect(out[0]).toMatchObject({ t: "loaded", migrated: false, away: null });
    expect(get()).toEqual({ version: 3, city, sim: { realTime: NOW, gameMinutes: 0 } });
  });
  it("tick posts snapshot only when time advanced", async () => {
    const { h, out } = setup();
    h.tick(NOW); // nothing loaded
    await h.handle({ t: "found", city, now: NOW });
    out.length = 0;
    h.tick(NOW + 5000);
    expect(out).toEqual([]);
    h.tick(NOW + 10_000);
    expect(out).toEqual([{ t: "snapshot", sim: { realTime: NOW + 10_000, gameMinutes: 10 } }]);
    h.tick(NOW + 12_000);
    expect(out.length).toBe(1);
  });
  it("reset clears", async () => {
    const { h, out, get } = setup();
    await h.handle({ t: "found", city, now: NOW });
    out.length = 0;
    await h.handle({ t: "reset" });
    expect(get()).toBeUndefined();
    expect(out).toEqual([{ t: "resetDone" }]);
    h.tick(NOW + 20_000);
    expect(out.length).toBe(1);
  });
});
