import type { Platform, PlatformHooks } from "./index";

// CrazyGames HTML5 SDK v3 (https://docs.crazygames.com/sdk/intro/). Its script tag sits in index.html (vite.config.ts),
// where the portal's QA tool looks for it; on a host that is not CrazyGames (or localhost) the SDK reports `disabled`
// and its calls throw, so the game runs without the portal.
interface CrazySdk {
  init(): Promise<void>;
  environment: "local" | "crazygames" | "disabled";
  user?: { systemInfo?: { locale?: string } };
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

export async function initCrazyGames(signal: AbortSignal): Promise<Platform> {
  const sdk = window.CrazyGames?.SDK ?? await new Promise<CrazySdk>((resolve, reject) => {
    const script = document.getElementById("crazygames-sdk");
    const failed = () => reject(new Error("CrazyGames SDK did not load"));
    if (!script) return failed();
    script.addEventListener("load", () => {
      const sdk = window.CrazyGames?.SDK;
      if (sdk) resolve(sdk);
      else failed();
    }, { once: true, signal });
    script.addEventListener("error", failed, { once: true, signal });
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  });
  await sdk.init();
  signal.throwIfAborted();
  if (sdk.environment === "disabled") throw new Error("not on a CrazyGames host");
  sdk.game.loadingStart();
  // The portal has no pause events of its own: the game pauses itself around its ads (requirement of the video-ads
  // page), with the same hooks a portal's overlays would use.
  let hooks: PlatformHooks | null = null;
  return {
    lang: sdk.user?.systemInfo?.locale?.split("-")[0] || null,
    listen(h) {
      hooks = h;
    },
    // Off for the Basic Launch, where the portal serves no ads at all (`env/.env.crazygames`).
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
