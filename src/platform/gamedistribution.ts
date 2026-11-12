import { NO_PLATFORM, type Platform, type PlatformHooks } from "./index";
import { loadScript } from "./script";

// GameDistribution HTML5 SDK (https://github.com/GameDistribution/GD-HTML5/wiki/SDK-Implementation). The SDK reads its
// options from a global set before it loads; the game's id is public and sits in `.env.gamedistribution`.
interface GdSdk {
  showAd(type?: "rewarded"): Promise<unknown>;
}

declare global {
  interface Window {
    GD_OPTIONS?: { gameId: string; onEvent(event: { name: string }): void };
    gdsdk?: GdSdk;
  }
}

const SDK_URL = "https://html5.api.gamedistribution.com/main.min.js";
const READY_WAIT_MS = 10_000;

export async function initGameDistribution(): Promise<Platform> {
  const gameId = import.meta.env.VITE_GD_GAME_ID;
  if (!gameId) {
    console.warn("VITE_GD_GAME_ID is not set, running without GameDistribution");
    return NO_PLATFORM;
  }
  let hooks: PlatformHooks | null = null;
  let watched = false;
  let sdkReady: (ok: boolean) => void = () => {};
  const ready = new Promise<boolean>((resolve) => (sdkReady = resolve));
  window.GD_OPTIONS = {
    gameId,
    // The SDK pauses the game around every ad, its own pre-roll included.
    onEvent(event) {
      switch (event.name) {
        case "SDK_READY":
          return sdkReady(true);
        case "SDK_ERROR":
          return sdkReady(false);
        case "SDK_GAME_PAUSE":
          return hooks?.pause();
        case "SDK_GAME_START":
          return hooks?.resume();
        case "SDK_REWARDED_WATCH_COMPLETE":
          watched = true;
      }
    },
  };
  try {
    await loadScript(SDK_URL);
    const ok = await Promise.race([ready, new Promise<boolean>((r) => setTimeout(r, READY_WAIT_MS, false))]);
    if (!ok || !window.gdsdk) throw new Error("the SDK did not get ready");
  } catch (e) {
    console.warn("GameDistribution SDK unavailable, running without it:", e);
    return NO_PLATFORM;
  }
  const sdk = window.gdsdk;
  return {
    lang: null,
    listen(h) {
      hooks = h;
    },
    // The reward is the watch-complete event, not the end of the ad: a skipped ad also ends.
    rewarded: async () => {
      watched = false;
      try {
        await sdk.showAd("rewarded");
      } catch (e) {
        console.warn("Rewarded ad failed:", e);
        return false;
      }
      return watched;
    },
    ready() {},
    gameplay() {},
  };
}
