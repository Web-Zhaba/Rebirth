import { NO_PLATFORM, type Platform, type PlatformHooks } from "./index";
import { loadScript } from "./script";

// Poki SDK v2 (https://developers.poki.com/guide/sdk-html5). It tells no interface language: the game detects its own.
interface PokiSdk {
  init(): Promise<void>;
  gameLoadingFinished(): void;
  gameplayStart(): void;
  gameplayStop(): void;
  rewardedBreak(onStart?: () => void): Promise<boolean>;
}

declare global {
  interface Window {
    PokiSDK?: PokiSdk;
  }
}

const SDK_URL = "https://game-cdn.poki.com/scripts/v2/poki-sdk.js";

export async function initPoki(): Promise<Platform> {
  let sdk: PokiSdk;
  try {
    await loadScript(SDK_URL);
    if (!window.PokiSDK) throw new Error("PokiSDK is not defined");
    sdk = window.PokiSDK;
  } catch (e) {
    console.warn("Poki SDK unavailable, running without it:", e);
    return NO_PLATFORM;
  }
  // A failed init (an ad blocker, say) still leaves a working SDK without ads: the game loads anyway, as Poki asks.
  await sdk.init().catch((e: unknown) => console.warn("Poki SDK init failed:", e));
  let hooks: PlatformHooks | null = null;
  return {
    lang: null,
    listen(h) {
      hooks = h;
    },
    // The game is paused and silent during the break (Poki's rule); the start callback may never come, the end does.
    rewarded: async () => {
      try {
        return await sdk.rewardedBreak(() => hooks?.pause());
      } catch (e) {
        console.warn("Rewarded break failed:", e);
        return false;
      } finally {
        hooks?.resume();
      }
    },
    ready: () => sdk.gameLoadingFinished(),
    gameplay: (on) => (on ? sdk.gameplayStart() : sdk.gameplayStop()),
  };
}
