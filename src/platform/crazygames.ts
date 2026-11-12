import { NO_PLATFORM, type Platform, type PlatformHooks } from "./index";
import { loadScript } from "./script";

// CrazyGames HTML5 SDK v3 (https://docs.crazygames.com/sdk/intro/). Served from the portal's CDN; on a host that is
// not CrazyGames (or localhost) the SDK reports `disabled` and its calls throw, so the game runs without the portal.
interface CrazySdk {
  init(): Promise<void>;
  environment: "local" | "crazygames" | "disabled";
  user: { systemInfo: { locale: string } };
  game: { loadingStart(): void; loadingStop(): void; gameplayStart(): void; gameplayStop(): void };
  ad: {
    requestAd(
      type: "rewarded",
      callbacks: { adStarted?(): void; adFinished?(): void; adError?(e: { code: string; message: string }): void },
    ): void;
  };
}

declare global {
  interface Window {
    CrazyGames?: { SDK: CrazySdk };
  }
}

const SDK_URL = "https://sdk.crazygames.com/crazygames-sdk-v3.js";

export async function initCrazyGames(): Promise<Platform> {
  let sdk: CrazySdk;
  try {
    await loadScript(SDK_URL);
    if (!window.CrazyGames) throw new Error("CrazyGames SDK is not defined");
    sdk = window.CrazyGames.SDK;
    await sdk.init();
    if (sdk.environment === "disabled") throw new Error("not on a CrazyGames host");
  } catch (e) {
    console.warn("CrazyGames SDK unavailable, running without it:", e);
    return NO_PLATFORM;
  }
  sdk.game.loadingStart();
  // The portal has no pause events of its own: the game pauses itself around its ads (requirement of the video-ads
  // page), with the same hooks a portal's overlays would use.
  let hooks: PlatformHooks | null = null;
  return {
    lang: sdk.user.systemInfo.locale.split("-")[0] || null,
    listen(h) {
      hooks = h;
    },
    // Off for the Basic Launch, where the portal serves no ads at all (`.env.crazygames`).
    rewarded:
      import.meta.env.VITE_REWARDED_ADS === "off"
        ? null
        : () =>
            new Promise((resolve) => {
              sdk.ad.requestAd("rewarded", {
                adStarted: () => hooks?.pause(),
                adFinished: () => {
                  hooks?.resume();
                  resolve(true);
                },
                adError: (e) => {
                  console.warn("Rewarded ad failed:", e);
                  hooks?.resume();
                  resolve(false);
                },
              });
            }),
    ready: () => sdk.game.loadingStop(),
    gameplay: (on) => (on ? sdk.game.gameplayStart() : sdk.game.gameplayStop()),
  };
}
