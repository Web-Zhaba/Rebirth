import { NO_PLATFORM, type Platform } from "./index";
import { loadScript } from "./script";

// GamePix SDK v3 (https://partners.gamepix.com/sdk/doc/javascript), manual lifecycle: the game says itself when it has
// loaded and when play starts.
interface GamePixSdk {
  lang(): string;
  lifecycle: { loaded(): Promise<unknown>; gameStart(): boolean };
  events: { on(name: "pause" | "resume", cb: () => void): () => void };
  ads: { reward(): Promise<{ success: boolean; message?: string }> };
}

declare global {
  interface Window {
    GamePixConfig?: { lifecycle: "manual" };
    GamePix?: GamePixSdk;
  }
}

const SDK_URL = "https://integration.gamepix.com/sdk/v3/gamepix.sdk.js";

export async function initGamePix(): Promise<Platform> {
  let sdk: GamePixSdk;
  try {
    window.GamePixConfig = { lifecycle: "manual" };
    await loadScript(SDK_URL);
    if (!window.GamePix) throw new Error("GamePix is not defined");
    sdk = window.GamePix;
  } catch (e) {
    console.warn("GamePix SDK unavailable, running without it:", e);
    return NO_PLATFORM;
  }
  // Ads wait for the loaded signal (the SDK refuses them before it).
  let loaded: Promise<unknown> | null = null;
  return {
    lang: sdk.lang(),
    // The SDK calls these around its ads itself; both are safe to repeat (main.ts keeps the speed once).
    listen(hooks) {
      sdk.events.on("pause", hooks.pause);
      sdk.events.on("resume", hooks.resume);
    },
    rewarded: async () => {
      try {
        await loaded;
        return (await sdk.ads.reward()).success;
      } catch (e) {
        console.warn("Rewarded ad failed:", e);
        return false;
      }
    },
    ready() {
      loaded ??= sdk.lifecycle.loaded();
    },
    // Only the first start counts on GamePix; its stop ends the session, so a paused town does not send it.
    gameplay(on) {
      if (on) sdk.lifecycle.gameStart();
    },
  };
}
