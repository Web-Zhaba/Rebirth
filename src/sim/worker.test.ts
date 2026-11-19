import { afterEach, expect, it, vi } from "vitest";
import type { FromWorker, ToWorker } from "./protocol";

const storage = vi.hoisted(() => ({
  get: vi.fn(async () => undefined),
  put: vi.fn(async () => {}),
  clear: vi.fn(async () => {}),
}));
vi.mock("./idbStorage", () => ({ idbStorage: storage }));

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  vi.resetModules();
});

async function workerWithLock(available: boolean) {
  vi.useFakeTimers();
  const postMessage = vi.fn<(msg: FromWorker) => void>();
  const self: { postMessage: typeof postMessage; onmessage?: (e: { data: ToWorker }) => void } = { postMessage };
  let released = false;
  const request = vi.fn(async (name: string, options: LockOptions, run: (lock: object | null) => Promise<void>) => {
    await run(available ? { name, mode: options.mode ?? "exclusive" } : null);
    released = true;
  });
  vi.stubGlobal("self", self);
  vi.stubGlobal("navigator", { locks: { request } });
  await import("./worker");
  return { send: (data: ToWorker) => self.onmessage?.({ data }), postMessage, request, released: () => released };
}

const now = 1_800_000_000_000;
const load: ToWorker = { t: "load", now, legacy: null };
const found: ToWorker = { t: "found", now, city: { name: "Речной", lat: 50, lng: 37, foundedAt: now }, elevation: 0 };

it("blocks all save operations when another tab holds the lock", async () => {
  const worker = await workerWithLock(false);
  worker.send(load);
  await vi.advanceTimersByTimeAsync(0);
  expect(worker.postMessage).toHaveBeenCalledWith({ t: "loadFailed", reason: "locked" });
  worker.send(found);
  worker.send({ t: "flush" });
  worker.send({ t: "reset" });
  await vi.advanceTimersByTimeAsync(0);
  expect(storage.get).not.toHaveBeenCalled();
  expect(storage.put).not.toHaveBeenCalled();
  expect(storage.clear).not.toHaveBeenCalled();
});

it("holds the lock after loading and keeps it while the owning tab is hidden", async () => {
  const worker = await workerWithLock(true);
  worker.send(load);
  await vi.advanceTimersByTimeAsync(0);
  expect(worker.request).toHaveBeenCalledWith("rebirth-save", { ifAvailable: true }, expect.any(Function));
  expect(worker.postMessage).toHaveBeenCalledWith({ t: "loaded", save: null, migrated: false });
  worker.send(found);
  await vi.advanceTimersByTimeAsync(0);
  worker.send({ t: "visibility", hidden: true, now });
  worker.send({ t: "flush" });
  await vi.advanceTimersByTimeAsync(0);
  expect(storage.put).toHaveBeenCalledTimes(2);
  expect(worker.released()).toBe(false);
});
