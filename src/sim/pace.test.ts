import { describe, expect, it } from "vitest";
import { advanceTo, BASE_TICK, clockAt, OFFLINE, OFFLINE_CAP, tickMs, type Pace, type Speed } from "./clock";
import { Handler, type Storage } from "./handler";
import { emptyGrowth, seedOf } from "./growth";
import type { FromWorker, ToWorker } from "./protocol";
import { emptyRoads } from "./roads";
import { parseSave } from "./save";
import type { City, SimState } from "./types";
import { emptyZones } from "./zones";

const NOW = 1_800_000_000_000;
const city: City = { name: "Тест", lat: 59.12, lng: 37.9, foundedAt: NOW - 1000 };
const live = (speed: Speed): Pace => ({ speed, offline: false });
const DAY = 0; // 06:00
const NIGHT = 16 * 60; // 22:00
const start = (gameMinutes = DAY): SimState => ({ realTime: NOW, gameMinutes, roads: emptyRoads(), zones: emptyZones(), ...emptyGrowth(seedOf(city.foundedAt), 0) });

describe("tickMs", () => {
  it("live speeds: 2500 / 1250 / 625 ms per tick by day", () => {
    expect(tickMs(DAY, live(1))).toBe(2500);
    expect(tickMs(DAY, live(2))).toBe(1250);
    expect(tickMs(DAY, live(4))).toBe(625);
  });
  it("night boost runs 22:00-05:00 on top of the speed, dusk and dawn at normal rate", () => {
    const at = (hour: number) => tickMs(((hour - 6 + 24) % 24) * 60, live(1)); // gameMinutes 0 is 06:00
    for (const h of [22, 23, 0, 1, 4]) expect(at(h)).toBe(625);
    for (const h of [5, 6, 12, 19, 21]) expect(at(h)).toBe(2500);
    expect(tickMs(NIGHT, live(4))).toBe(156.25);
  });
  it("offline is 1 game minute per real second, whatever the speed or hour", () => {
    expect(tickMs(DAY, OFFLINE)).toBe(10_000);
    expect(tickMs(NIGHT, { speed: 4, offline: true })).toBe(10_000);
  });
  it("paused costs no tick", () => {
    expect(tickMs(DAY, live(0))).toBe(Infinity);
  });
  it("clockAt interpolates with the live rate and freezes when paused", () => {
    expect(clockAt(100, NOW, NOW + 1000, 1)).toBeCloseTo(104);
    expect(clockAt(100, NOW, NOW + 500, 4)).toBeCloseTo(108);
    expect(clockAt(100, NOW, NOW + 60_000, 1)).toBeCloseTo(100 + BASE_TICK, 2); // never past the next tick
    expect(clockAt(100, NOW, NOW + 1000, 0)).toBe(100);
  });
});

describe("advanceTo", () => {
  it("2x spends half the wall time per tick", () => {
    const a = advanceTo(start(), NOW + 5000, live(1));
    const b = advanceTo(start(), NOW + 5000, live(2));
    expect(a).toMatchObject({ gameMinutes: 2 * BASE_TICK, realTime: NOW + 5000 });
    expect(b).toMatchObject({ gameMinutes: 4 * BASE_TICK, realTime: NOW + 5000 });
  });
  it("night ticks cost a quarter", () => {
    const s = advanceTo(start(NIGHT), NOW + 2500, live(1));
    expect(s.gameMinutes).toBe(NIGHT + 4 * BASE_TICK);
    expect(s.realTime).toBe(NOW + 2500);
  });
  it("pause drops wall time: nothing is owed after the unpause", () => {
    const paused = advanceTo(start(), NOW + 3_600_000, live(0));
    expect(paused.gameMinutes).toBe(0);
    expect(paused.realTime).toBe(NOW + 3_600_000);
    const after = advanceTo(paused, NOW + 3_600_000 + 2500, live(1));
    expect(after.gameMinutes).toBe(BASE_TICK);
  });
  it("offline catch-up uses 1 game minute per second and caps at 24 real hours", () => {
    const s = advanceTo(start(), NOW + 3 * OFFLINE_CAP, OFFLINE);
    expect(s.gameMinutes).toBe(OFFLINE_CAP / 1000);
    expect(s.realTime).toBe(NOW + 3 * OFFLINE_CAP);
    expect(advanceTo(start(NIGHT), NOW + 60_000, { speed: 4, offline: true }).gameMinutes).toBe(NIGHT + 60);
  });
});

function setup() {
  let stored: unknown;
  const storage: Storage = { get: async () => stored, put: async (s) => void (stored = s), clear: async () => void (stored = undefined) };
  const out: FromWorker[] = [];
  const h = new Handler(storage, (m) => out.push(m));
  const gm = () => (out.filter((m) => m.t === "snapshot").pop() as Extract<FromWorker, { t: "snapshot" }> | undefined)?.sim.gameMinutes;
  return { h, out, gm, stored: () => stored };
}

describe("handler pace", () => {
  it("pause: no game time, no catch-up and nothing owed after unpausing", async () => {
    const { h, out, gm } = setup();
    await h.handle({ t: "found", city, now: NOW });
    await h.handle({ t: "speed", speed: 0, now: NOW });
    out.length = 0;
    h.tick(NOW + 3_600_000);
    expect(out).toEqual([]); // no snapshot, no progress, no away
    await h.handle({ t: "speed", speed: 1, now: NOW + 3_600_000 });
    h.tick(NOW + 3_600_000 + 2500);
    expect(gm()).toBe(BASE_TICK);
  });
  it("the saved realTime never runs ahead of the clock, also after a pause", async () => {
    const { h, stored } = setup();
    await h.handle({ t: "found", city, now: NOW });
    await h.handle({ t: "speed", speed: 0, now: NOW });
    h.tick(NOW + 5000);
    await h.handle({ t: "flush" });
    expect(parseSave(stored(), NOW + 5000)).not.toBeNull();
  });
  it("hidden for more than 5 minutes runs at the offline rate until the tab is visible again", async () => {
    const { h, gm } = setup();
    await h.handle({ t: "found", city, now: NOW });
    await h.handle({ t: "visibility", hidden: true, now: NOW - 6 * 60_000 });
    h.tick(NOW + 10_000);
    expect(gm()).toBe(10); // 10 real s at 1 game min/s
    await h.handle({ t: "visibility", hidden: false, now: NOW + 10_000 });
    h.tick(NOW + 20_000);
    expect(gm()).toBe(10 + 40); // 10 real s live: 4 ticks
  });
  it("hidden for a short while stays live", async () => {
    const { h, gm } = setup();
    await h.handle({ t: "found", city, now: NOW });
    await h.handle({ t: "visibility", hidden: true, now: NOW - 60_000 });
    h.tick(NOW + 10_000);
    expect(gm()).toBe(40);
  });
  it("paused and hidden stays paused", async () => {
    const { h, out, gm } = setup();
    await h.handle({ t: "found", city, now: NOW });
    await h.handle({ t: "speed", speed: 0, now: NOW });
    await h.handle({ t: "visibility", hidden: true, now: NOW });
    out.length = 0;
    h.tick(NOW + 3_600_000);
    expect(out).toEqual([]);
    expect(gm()).toBeUndefined();
  });
  it("a gap of more than a minute is caught up at the offline rate, whatever the speed", async () => {
    const { h, out, gm } = setup();
    await h.handle({ t: "found", city, now: NOW });
    await h.handle({ t: "speed", speed: 4, now: NOW });
    h.tick(NOW + 120_000);
    await h.idle();
    expect(out.some((m) => m.t === "away")).toBe(true);
    expect(gm()).toBe(120);
  });
  it("load catches up at 1 game minute per second and caps at 24 real hours", async () => {
    const a = setup();
    await a.h.handle({ t: "found", city, now: NOW });
    const save = a.stored();
    const out: FromWorker[] = [];
    const loader = new Handler({ get: async () => save, put: async () => {}, clear: async () => {} }, (m) => out.push(m));
    await loader.handle({ t: "load", legacy: null, now: NOW + 3 * OFFLINE_CAP });
    const loaded = out.find((m) => m.t === "loaded") as Extract<FromWorker, { t: "loaded" }>;
    expect(loaded.save?.sim.gameMinutes).toBe(OFFLINE_CAP / 1000);
  });
  it("ignores malformed speed and visibility messages", async () => {
    const { h, out, gm } = setup();
    await h.handle({ t: "found", city, now: NOW });
    await h.handle({ t: "speed", speed: 3, now: NOW } as unknown as ToWorker);
    await h.handle({ t: "speed", speed: 2, now: "x" } as unknown as ToWorker);
    await h.handle({ t: "visibility", hidden: "yes", now: NOW } as unknown as ToWorker);
    out.length = 0;
    h.tick(NOW + 2500);
    expect(gm()).toBe(BASE_TICK); // still 1x
  });
});
