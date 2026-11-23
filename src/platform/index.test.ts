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
    data: { getItem: vi.fn(() => null), setItem: vi.fn(), removeItem: vi.fn() },
    user: { systemInfo: { locale: "ru-RU" } },
    game: {
      settings: { muteAudio: true },
      addSettingsChangeListener: vi.fn<(listener: (settings: { muteAudio: boolean }) => void) => void>(),
      loadingStart: vi.fn(), loadingStop: vi.fn(), gameplayStart: vi.fn(), gameplayStop: vi.fn(), happytime: vi.fn(),
    },
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

it("applies the initial CrazyGames mute setting and follows changes", async () => {
  const sdk = sdkStub();
  vi.stubGlobal("window", { CrazyGames: { SDK: sdk } });
  const mod = await import("./index");
  await mod.initPlatform();

  const muteAudio = vi.fn();
  mod.platform.listen({ pause: vi.fn(), resume: vi.fn(), muteAudio });
  expect(muteAudio).toHaveBeenCalledWith(true);
  sdk.game.addSettingsChangeListener.mock.calls[0][0]({ muteAudio: false });
  expect(muteAudio).toHaveBeenLastCalledWith(false);
});

it("reports a settlement founding as CrazyGames Happytime", async () => {
  const sdk = sdkStub();
  vi.stubGlobal("window", { CrazyGames: { SDK: sdk } });
  const mod = await import("./index");
  await mod.initPlatform();

  expect(sdk.game.happytime).not.toHaveBeenCalled();
  mod.platform.settlementFounded?.();
  expect(sdk.game.happytime).toHaveBeenCalledOnce();
});

it("blocks progression during a CrazyGames rewarded request and only grants a completed reward", async () => {
  vi.stubEnv("VITE_REWARDED_ADS", "");
  const sdk = sdkStub();
  let callbacks!: Parameters<NonNullable<Window["CrazyGames"]>["SDK"]["ad"]["requestAd"]>[1];
  sdk.ad.requestAd.mockImplementation((_type, next) => { callbacks = next; });
  vi.stubGlobal("window", { CrazyGames: { SDK: sdk } });
  const mod = await import("./index");
  await mod.initPlatform();

  const pause = vi.fn();
  const resume = vi.fn();
  const blockInput = vi.fn();
  mod.platform.listen({ pause, resume, blockInput });
  const unavailable = mod.platform.rewarded!();
  expect(pause).toHaveBeenCalledWith(false);
  expect(blockInput).toHaveBeenLastCalledWith(true);
  expect(await mod.platform.rewarded!()).toBe(false);
  callbacks.adError?.({ code: "unfilled", message: "No ad" });
  expect(await unavailable).toBe(false);
  expect(blockInput).toHaveBeenLastCalledWith(false);

  const watched = mod.platform.rewarded!();
  callbacks.adStarted?.();
  expect(pause).toHaveBeenLastCalledWith();
  callbacks.adFinished?.();
  expect(await watched).toBe(true);
  expect(resume).toHaveBeenCalledTimes(2);
  expect(blockInput).toHaveBeenLastCalledWith(false);
});
