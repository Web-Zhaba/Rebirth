import bridge, { parseURLSearchParamsForGetLaunchParams } from "@vkontakte/vk-bridge";
import { NO_PLATFORM, type Platform, type PlatformHooks } from "./index";

// VK Games through VK Bridge (https://dev.vk.ru/ru/bridge/getting-started). The bridge is bundled, not fetched; outside
// VK (no iframe or webview around the page) the game runs without the portal.
export async function initVk(): Promise<Platform> {
  if (!bridge.isEmbedded()) return NO_PLATFORM;
  try {
    await bridge.send("VKWebAppInit");
  } catch (e) {
    console.warn("VK Bridge unavailable, running without it:", e);
    return NO_PLATFORM;
  }
  let hooks: PlatformHooks | null = null;
  // The app hidden (the player left for a chat, the app went to the background) is the portal's pause.
  bridge.subscribe(({ detail }) => {
    if (detail.type === "VKWebAppViewHide") hooks?.pause();
    else if (detail.type === "VKWebAppViewRestore") hooks?.resume();
  });
  return {
    lang: parseURLSearchParamsForGetLaunchParams(location.search).vk_language ?? null,
    listen(h) {
      hooks = h;
    },
    // The game pauses itself around the ad: the bridge says nothing while one plays.
    rewarded: async () => {
      try {
        const { result } = await bridge.send("VKWebAppCheckNativeAds", { ad_format: "reward" });
        if (!result) return false;
        hooks?.pause();
        return (await bridge.send("VKWebAppShowNativeAds", { ad_format: "reward" })).result;
      } catch (e) {
        console.warn("Rewarded ad failed:", e);
        return false;
      } finally {
        hooks?.resume();
      }
    },
    ready() {},
    gameplay() {},
  };
}
