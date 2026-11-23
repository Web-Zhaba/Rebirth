import { NO_PLATFORM, type Platform, type PlatformHooks } from "./index";
import { loadScript } from "./script";

// GameMonetize HTML5 SDK: https://github.com/MonetizeGame/GameMonetize.com-SDK
declare global {
  interface Window {
    SDK_OPTIONS?: { gameId: string; onEvent(event: { name: string }): void };
    sdk?: { showBanner(): void };
  }
}

const SDK_URL = "https://api.gamemonetize.com/sdk.js";

export async function initGameMonetize(signal: AbortSignal): Promise<Platform> {
  const gameId = import.meta.env.VITE_GM_GAME_ID;
  if (!gameId) return NO_PLATFORM;

  let hooks: PlatformHooks | null = null;
  let adPaused = false;
  let sdkReady = false;
  let gameReady = false;
  let playing = false;
  let requested = false;

  function setAdPaused(paused: boolean) {
    if (adPaused === paused) return;
    adPaused = paused;
    if (paused) hooks?.pause();
    else hooks?.resume();
  }

  // The SDK requires showBanner(), which requests a fullscreen ad. Limit it to the first play of the session.
  function requestPreroll() {
    const sdk = window.sdk;
    if (requested || !sdkReady || !gameReady || !playing || !sdk?.showBanner) return;
    requested = true;
    try {
      sdk.showBanner();
    } catch (error) {
      setAdPaused(false);
      console.warn("GameMonetize ad failed:", error);
    }
  }

  window.SDK_OPTIONS = {
    gameId,
    onEvent({ name }) {
      switch (name) {
        case "SDK_READY":
          sdkReady = true;
          requestPreroll();
          break;
        case "SDK_GAME_PAUSE":
          return setAdPaused(true);
        case "SDK_GAME_START":
          return setAdPaused(false);
      }
    },
  };
  await loadScript(SDK_URL);
  signal.throwIfAborted();

  return {
    ...NO_PLATFORM,
    listen(next) {
      hooks = next;
      if (adPaused) hooks.pause();
    },
    ready() {
      gameReady = true;
      requestPreroll();
    },
    gameplay(on) {
      playing = on;
      requestPreroll();
    },
  };
}
