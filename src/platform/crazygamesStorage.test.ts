import { expect, it } from "vitest";
import { crazyGamesStorage } from "./crazygamesStorage";
import type { SaveV4 } from "../sim/types";

function dataStub() {
  const keys = new Map<string, string>();
  const store = crazyGamesStorage({
    getItem: (key) => keys.get(key) ?? null,
    setItem: (key, value) => { keys.set(key, value); },
    removeItem: (key) => { keys.delete(key); },
  });
  return { keys, store };
}

it("round trips a compressed town larger than the raw quota and clears only the town", async () => {
  const { keys, store } = dataStub();
  keys.set("unrelated", "keep");
  const save = { version: 4, article: "История поселения. ".repeat(40_000) } as unknown as SaveV4;

  expect(await store.get()).toBeNull();
  await store.put(save);
  expect(await store.get()).toEqual(save);
  await store.clear();
  expect(await store.get()).toBeNull();
  expect(keys.get("unrelated")).toBe("keep");
});

it("keeps the previous snapshot when the replacement exceeds the quota", async () => {
  const { store } = dataStub();
  const previous = { version: 4 } as SaveV4;
  await store.put(previous);

  let article = "";
  for (let i = 0; i < 140; i++) {
    const bytes = crypto.getRandomValues(new Uint8Array(8192));
    article += btoa(String.fromCharCode(...bytes));
  }
  const oversized = { article } as unknown as SaveV4;
  await expect(store.put(oversized)).rejects.toThrow(/Data limit/);
  expect(await store.get()).toEqual(previous);
});

it("distinguishes unreadable data from an empty game", async () => {
  const { keys, store } = dataStub();
  keys.set("rebirth.town", "broken");
  expect(await store.get()).toBe("broken");
});
