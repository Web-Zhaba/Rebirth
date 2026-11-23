import { expect, it, vi } from "vitest";
import { emptyGrowth } from "./growth";
import { emptyRoads } from "./roads";
import { remoteSaveStorage, serveSaveStorage } from "./savePort";
import type { SaveV4 } from "./types";
import { emptyZones } from "./zones";

const save: SaveV4 = {
  version: 4,
  city: { name: "Test", lat: 51, lng: 55, foundedAt: 1_000 },
  sim: { realTime: 1_000, gameMinutes: 0, roads: emptyRoads(), zones: emptyZones(), ...emptyGrowth(1) },
};

it("loads, writes and removes one save through the storage port", async () => {
  const { port1, port2 } = new MessageChannel();
  let stored: SaveV4 | null = null;
  serveSaveStorage(port1, {
    get: async () => stored,
    put: async (value) => { stored = value; },
    clear: async () => { stored = null; },
  });

  try {
    const remote = remoteSaveStorage(port2);
    expect(await remote.get()).toBeNull();
    await remote.put(save);
    expect(await remote.get()).toEqual(save);
    await remote.clear();
    expect(await remote.get()).toBeNull();
  } finally {
    port1.close();
    port2.close();
  }
});

it("propagates backend errors and runs subsequent operations in order", async () => {
  const { port1, port2 } = new MessageChannel();
  let finishPut!: () => void;
  let markStarted!: () => void;
  const started = new Promise<void>((resolve) => { markStarted = resolve; });
  const get = vi.fn(async () => { throw new Error("backend unavailable"); });
  serveSaveStorage(port1, {
    get,
    put: () => new Promise<void>((resolve) => {
      finishPut = resolve;
      markStarted();
    }),
    clear: async () => {},
  });

  try {
    const remote = remoteSaveStorage(port2);
    const writing = remote.put(save);
    const read = expect(remote.get()).rejects.toThrow("backend unavailable");
    await started;
    expect(get).not.toHaveBeenCalled();
    finishPut();
    await writing;
    await read;
  } finally {
    port1.close();
    port2.close();
  }
});
