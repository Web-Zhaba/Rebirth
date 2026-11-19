import bridge, { parseURLSearchParamsForGetLaunchParams } from "@vkontakte/vk-bridge";
import { NO_PLATFORM, type Platform, type PlatformHooks } from "./index";

// VK Games through VK Bridge (https://dev.vk.ru/ru/bridge/getting-started). The bridge is bundled, not fetched; outside
// VK (no iframe or webview around the page) the game runs without the portal.
export async function initVk(signal: AbortSignal): Promise<Platform> {
  if (!bridge.isEmbedded()) return NO_PLATFORM;
  try {
    await bridge.send("VKWebAppInit");
  } catch (e) {
    console.warn("VK Bridge unavailable, running without it:", e);
    return NO_PLATFORM;
  }
  signal.throwIfAborted();
  let hooks: PlatformHooks | null = null;
  let hidden = false;
  let ad = false;
  const setPause = (nextHidden: boolean, nextAd: boolean) => {
    const was = hidden || ad;
    hidden = nextHidden;
    ad = nextAd;
    if (!was && (hidden || ad)) hooks?.pause();
    else if (was && !hidden && !ad) hooks?.resume();
  };
  // The app hidden (the player left for a chat, the app went to the background) is the portal's pause.
  bridge.subscribe(({ detail }) => {
    if (detail.type === "VKWebAppViewHide") setPause(true, ad);
    else if (detail.type === "VKWebAppViewRestore") setPause(false, ad);
  });
  return {
    lang: parseURLSearchParamsForGetLaunchParams(location.search).vk_language ?? null,
    listen(h) {
      hooks = h;
      if (hidden || ad) hooks.pause();
    },
    // The game pauses itself around the ad: the bridge says nothing while one plays.
    rewarded: async () => {
      try {
        const { result } = await bridge.send("VKWebAppCheckNativeAds", { ad_format: "reward" });
        if (!result || ad) return false;
        setPause(hidden, true);
        try {
          return (await bridge.send("VKWebAppShowNativeAds", { ad_format: "reward" })).result;
        } finally {
          setPause(hidden, false);
        }
      } catch (e) {
        console.warn("Rewarded ad failed:", e);
        return false;
      }
    },
    ready() {},
    gameplay() {},
  };
}
