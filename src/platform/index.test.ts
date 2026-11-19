import { afterEach, beforeEach, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("VITE_PLATFORM", "crazygames");
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.doUnmock("./crazygames");
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function sdkStub(init = vi.fn(async () => {})) {
  return {
    init,
    environment: "local" as const,
    user: { systemInfo: { locale: "ru-RU" } },
    game: { loadingStart: vi.fn(), loadingStop: vi.fn(), gameplayStart: vi.fn(), gameplayStop: vi.fn() },
    ad: { requestAd: vi.fn() },
  };
}

it("falls back to standalone when the portal adapter import fails", async () => {
  vi.doMock("./crazygames", () => { throw new Error("adapter unavailable"); });
  const mod = await import("./index");
  await mod.initPlatform();
  expect(mod.platform).toBe(mod.NO_PLATFORM);
});

it("waits for the async CrazyGames SDK script before starting the portal", async () => {
  const script = new EventTarget();
  const win: { CrazyGames?: Window["CrazyGames"] } = {};
  vi.stubGlobal("window", win);
  vi.stubGlobal("document", { getElementById: (id: string) => id === "crazygames-sdk" ? script : null });
  const mod = await import("./index");
  const starting = mod.initPlatform();
  await vi.dynamicImportSettled();
  expect(mod.platform).toBe(mod.NO_PLATFORM);

  const sdk = sdkStub();
  win.CrazyGames = { SDK: sdk };
  script.dispatchEvent(new Event("load"));
  await starting;
  expect(sdk.init).toHaveBeenCalledOnce();
  expect(sdk.game.loadingStart).toHaveBeenCalledOnce();
  expect(mod.platform.lang).toBe("ru");
});

it("keeps standalone active when the CrazyGames SDK initializes after the deadline", async () => {
  vi.useFakeTimers();
  let ready!: () => void;
  const sdk = sdkStub(vi.fn(() => new Promise<void>((resolve) => { ready = resolve; })));
  vi.stubGlobal("window", { CrazyGames: { SDK: sdk } });
  const mod = await import("./index");
  const starting = mod.initPlatform();
  await vi.dynamicImportSettled();
  expect(sdk.init).toHaveBeenCalledOnce();

  await vi.advanceTimersByTimeAsync(15_000);
  await starting;
  ready();
  await Promise.resolve();
  expect(mod.platform).toBe(mod.NO_PLATFORM);
  expect(sdk.game.loadingStart).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});
