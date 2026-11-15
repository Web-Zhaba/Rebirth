// The portal the game is published on, picked at build time: `vite build --mode <portal>` reads `env/.env.<portal>`.
// The core talks only to this module; a portal's SDK never reaches the standalone bundle (the branch below is a
// build-time constant, so Vite drops the other adapters; scripts/pack.mjs checks that no other portal's SDK ships).
export interface Platform {
  // The portal's interface language as an ISO 639-1 code ('ru', 'en', ...), or null when there is no portal.
  lang: string | null;
  // Loading is over and the player can act.
  ready(): void;
  // Active play started (true) or stopped (false): the clock runs, no menu or ad covers the game.
  gameplay(on: boolean): void;
  // What the portal may ask of the game, e.g. around its ads and overlays.
  listen(hooks: PlatformHooks): void;
  // Shows a rewarded ad; true once the player has earned the reward. Null where the portal has no such ads.
  rewarded: (() => Promise<boolean>) | null;
}

export interface PlatformHooks {
  pause(): void;
  resume(): void;
}

export const NO_PLATFORM: Platform = { lang: null, ready() {}, gameplay() {}, listen() {}, rewarded: null };

// Set once by initPlatform, before the game's modules load (boot.ts): the language is read from it at their start.
export let platform: Platform = NO_PLATFORM;

// A portal SDK that fails or never answers must not keep the game from starting: it then runs without the portal.
const INIT_WAIT_MS = 15_000;

export async function initPlatform(): Promise<void> {
  const init = await portalInit();
  if (!init) return;
  try {
    const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error("no answer")), INIT_WAIT_MS));
    platform = await Promise.race([init(), timeout]);
  } catch (e) {
    console.warn(`${import.meta.env.VITE_PLATFORM} SDK failed, running without it:`, e);
  }
}

async function portalInit(): Promise<(() => Promise<Platform>) | null> {
  if (import.meta.env.VITE_PLATFORM === "yandex") return (await import("./yandex")).initYandex;
  if (import.meta.env.VITE_PLATFORM === "crazygames") return (await import("./crazygames")).initCrazyGames;
  if (import.meta.env.VITE_PLATFORM === "poki") return (await import("./poki")).initPoki;
  if (import.meta.env.VITE_PLATFORM === "vk") return (await import("./vk")).initVk;
  if (import.meta.env.VITE_PLATFORM === "gamedistribution") return (await import("./gamedistribution")).initGameDistribution;
  if (import.meta.env.VITE_PLATFORM === "gamepix") return (await import("./gamepix")).initGamePix;
  return null;
}
