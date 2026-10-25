import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { diffEvents, soundFor } from "./toastModel";
import type { TownEvent } from "../sim/types";

const store = new Map<string, string>();
const setup = async () => {
  vi.resetModules();
  store.clear();
  vi.stubGlobal("localStorage", { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) });
  return import("./sound");
};

const fakeCtx = () => {
  const made = { osc: 0 };
  class Ctx {
    state = "running";
    currentTime = 0;
    destination = {};
    resume = () => Promise.resolve();
    createOscillator() {
      made.osc++;
      const o = { type: "", frequency: { value: 0 }, connect: (x: unknown) => x, start() {}, stop() {} };
      return o;
    }
    createGain() {
      return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect: (x: unknown) => x };
    }
  }
  vi.stubGlobal("AudioContext", Ctx);
  return made;
};

beforeEach(() => vi.unstubAllGlobals());
afterEach(() => vi.unstubAllGlobals());

describe("sound settings", () => {
  it("is off by default with a middle volume", async () => {
    const s = await setup();
    expect(s.soundEnabled.value).toBe(false);
    expect(s.soundVolume.value).toBe(s.DEFAULT_VOLUME);
  });
  it("persists and reloads", async () => {
    const s = await setup();
    s.setSoundEnabled(true);
    s.setSoundVolume(0.8);
    expect(s.loadSettings()).toEqual({ enabled: true, volume: 0.8 });
    expect(JSON.parse(store.get("rebirth.sound")!)).toEqual({ enabled: true, volume: 0.8 });
  });
  it("survives broken storage", async () => {
    const s = await setup();
    store.set("rebirth.sound", "{oops");
    expect(s.loadSettings()).toEqual({ enabled: false, volume: s.DEFAULT_VOLUME });
    vi.stubGlobal("localStorage", { getItem: () => { throw new Error("x"); }, setItem: () => { throw new Error("x"); } });
    expect(() => s.setSoundEnabled(true)).not.toThrow();
  });
  it("clamps the volume", async () => {
    const s = await setup();
    s.setSoundVolume(7);
    expect(s.soundVolume.value).toBe(1);
  });
});

describe("play", () => {
  it("does nothing while disabled", async () => {
    const made = fakeCtx();
    const s = await setup();
    s.play("click");
    expect(made.osc).toBe(0);
  });
  it("is a no-op without AudioContext", async () => {
    const s = await setup();
    s.setSoundEnabled(true);
    expect(() => s.play("place")).not.toThrow();
  });
  it("plays the notes when enabled", async () => {
    const made = fakeCtx();
    const s = await setup();
    s.setSoundEnabled(true);
    s.play("finished");
    expect(made.osc).toBe(3);
  });
  it("never throws when the context breaks", async () => {
    vi.stubGlobal("AudioContext", class { constructor() { throw new Error("blocked"); } });
    const s = await setup();
    s.setSoundEnabled(true);
    expect(() => s.play("error")).not.toThrow();
  });
});

describe("sounds from new events", () => {
  const ev = (at: number, kind: TownEvent["kind"]): TownEvent => ({ at, kind, text: "x" });
  it("fires once per new event, never for history", () => {
    const first = [ev(1, "built"), ev(2, "arrival")];
    const base = diffEvents(first, null);
    expect(base.fresh.filter((e) => soundFor(e.kind))).toHaveLength(0);
    const next = diffEvents([...first, ev(3, "goal")], base.seen);
    expect(next.fresh.filter((e) => soundFor(e.kind))).toHaveLength(1);
    const again = diffEvents([...first, ev(3, "goal")], next.seen);
    expect(again.fresh).toHaveLength(0);
  });
  it("maps only built and goal", () => {
    expect(soundFor("built")).toBe("finished");
    expect(soundFor("goal")).toBe("finished");
    expect(soundFor("event")).toBeNull();
  });
});
