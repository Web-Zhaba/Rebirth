import { NO_PLATFORM, type Platform, type PlatformHooks } from "./index";

// Y8 SDK v2: https://docs.y8.com/sdk/intro/
interface Y8Sdk {
  init(app: { appId: string; autoLogin: boolean }, ads?: { gameId: string; preloadAdBreaks: "on" }): Promise<void>;
  getPlatformLocale(): Promise<string>;
  showAd(options: {
    type: "reward";
    name: string;
    beforeReward(show: () => void): void;
    beforeAd(): void;
    afterAd(): void;
    adViewed(): void;
    adBreakDone(): void;
  }): Promise<void>;
}

declare global {
  interface Window {
    y8?: { sdk(): Y8Sdk; emitReadyEvent(): void };
  }
}

const SDK_WAIT_MS = 5_000;
const AD_OFFER_WAIT_MS = 15_000;
const AD_PLAY_WAIT_MS = 120_000;

export async function initY8(signal: AbortSignal): Promise<Platform> {
  let hooks: PlatformHooks | null = null;
  let focusPaused = false;
  let adPaused = false;
  let paused = false;
  let adPending = false;

  function updatePause() {
    const next = focusPaused || adPaused;
    if (paused === next) return;
    paused = next;
    if (paused) hooks?.pause();
    else hooks?.resume();
  }

  const result: Platform = {
    ...NO_PLATFORM,
    lang: "en",
    listen(next) {
      hooks = next;
      const updateFocus = () => {
        focusPaused = document.hidden || !document.hasFocus();
        updatePause();
      };
      window.addEventListener("blur", updateFocus);
      window.addEventListener("focus", updateFocus);
      document.addEventListener("visibilitychange", updateFocus);
      updateFocus();
    },
  };

  const appId = import.meta.env.VITE_Y8_APP_ID;
  const gameId = import.meta.env.VITE_Y8_GAME_ID;
  if (!appId) return result;

  const loading = new AbortController();
  const timer = setTimeout(() => loading.abort(new Error("Y8 SDK did not respond")), SDK_WAIT_MS);
  const loadSignal = AbortSignal.any([loading.signal, signal]);
  try {
    const canceled = new Promise<never>((_, reject) => {
      loadSignal.addEventListener("abort", () => reject(loadSignal.reason), { once: true });
    });
    const ready = new Promise<void>((resolve, reject) => {
      const script = document.getElementById("y8-sdk");
      script?.addEventListener("error", () => reject(new Error("Y8 SDK did not load")), { once: true, signal: loadSignal });
      window.addEventListener("y8sdk.ready", () => resolve(), { once: true, signal: loadSignal });
      window.y8?.emitReadyEvent();
    });
    await Promise.race([ready, canceled]);
    const sdk = window.y8?.sdk();
    if (!sdk) throw new Error("Y8 SDK is missing");
    const ads = gameId ? { gameId, preloadAdBreaks: "on" as const } : undefined;
    await Promise.race([sdk.init({ appId, autoLogin: false }, ads), canceled]);
    result.lang = await Promise.race([sdk.getPlatformLocale(), canceled]).catch(() => "en");

    if (ads) result.rewarded = () => {
      if (adPending) return Promise.resolve(false);
      adPending = true;
      return new Promise<boolean>((resolve) => {
        let finished = false;
        let watched = false;
        let adTimer = setTimeout(finish, AD_OFFER_WAIT_MS);
        function resume() {
          adPaused = false;
          updatePause();
        }
        function finish() {
          if (finished) return;
          finished = true;
          clearTimeout(adTimer);
          adPending = false;
          resume();
          resolve(watched);
        }
        void sdk.showAd({
          type: "reward",
          name: "reward",
          beforeReward(show) {
            if (!finished) show();
          },
          beforeAd() {
            if (finished) return;
            clearTimeout(adTimer);
            adTimer = setTimeout(finish, AD_PLAY_WAIT_MS);
            adPaused = true;
            updatePause();
          },
          afterAd() {
            if (!finished) resume();
          },
          adViewed() {
            watched = true;
          },
          adBreakDone: finish,
        }).catch((error) => {
          console.warn("Y8 ad failed:", error);
          finish();
        });
      });
    };
  } catch (error) {
    console.warn("Y8 SDK unavailable, running without it:", error);
  } finally {
    clearTimeout(timer);
    loading.abort();
  }

  return result;
}
