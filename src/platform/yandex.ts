import { NO_PLATFORM, type Platform } from "./index";

// Yandex Games SDK v2 (https://yandex.ru/dev/games/doc/ru/sdk/sdk-about). The portal serves `/sdk.js` next to the
// game; anywhere else (local preview) it is missing and the game runs without the portal.
interface YaSdk {
  environment: { i18n: { lang: string } };
  adv: {
    showRewardedVideo(opts: { callbacks: { onRewarded?(): void; onClose?(): void; onError?(e: unknown): void } }): void;
  };
  features: {
    LoadingAPI?: { ready(): void };
    GameplayAPI?: { start(): void; stop(): void };
  };
  on?(event: "game_api_pause" | "game_api_resume", cb: () => void): void;
}

declare global {
  interface Window {
    YaGames?: { init(): Promise<YaSdk> };
  }
}

const SDK_URL = "/sdk.js";

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`${src} did not load`));
    document.head.append(s);
  });
}

export async function initYandex(): Promise<Platform> {
  let ysdk: YaSdk;
  try {
    await loadScript(SDK_URL);
    if (!window.YaGames) throw new Error("YaGames is not defined");
    ysdk = await window.YaGames.init();
  } catch (e) {
    console.warn("Yandex Games SDK unavailable, running without it:", e);
    return NO_PLATFORM;
  }
  return {
    // Language auto-detection through the SDK, required by the portal (requirement 2.14).
    lang: ysdk.environment.i18n.lang,
    listen(hooks) {
      ysdk.on?.("game_api_pause", hooks.pause);
      ysdk.on?.("game_api_resume", hooks.resume);
    },
    // The portal pauses the game around the ad itself (game_api_pause / game_api_resume).
    rewarded: () =>
      new Promise((resolve) => {
        let earned = false;
        ysdk.adv.showRewardedVideo({
          callbacks: {
            onRewarded: () => (earned = true),
            onClose: () => resolve(earned),
            onError: (e) => {
              console.warn("Rewarded ad failed:", e);
              resolve(false);
            },
          },
        });
      }),
    ready: () => ysdk.features.LoadingAPI?.ready(),
    gameplay: (on) => (on ? ysdk.features.GameplayAPI?.start() : ysdk.features.GameplayAPI?.stop()),
  };
}
