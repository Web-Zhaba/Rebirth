// The portal the game is published on, picked at build time: `vite build --mode yandex` reads `.env.yandex`.
// The core talks only to this module; a portal's SDK never reaches the standalone bundle (the branch below is a
// build-time constant, so Vite drops the other adapter).
export interface Platform {
  // The portal's interface language as an ISO 639-1 code ('ru', 'en', ...), or null when there is no portal.
  lang: string | null;
  // Loading is over and the player can act.
  ready(): void;
  // Active play started (true) or stopped (false): the clock runs, no menu or ad covers the game.
  gameplay(on: boolean): void;
  // What the portal may ask of the game, e.g. around its ads and overlays.
  listen(hooks: PlatformHooks): void;
}

export interface PlatformHooks {
  pause(): void;
  resume(): void;
}

export const NO_PLATFORM: Platform = { lang: null, ready() {}, gameplay() {}, listen() {} };

// Set once by initPlatform, before the game's modules load (boot.ts): the language is read from it at their start.
export let platform: Platform = NO_PLATFORM;

export async function initPlatform(): Promise<void> {
  if (import.meta.env.VITE_PLATFORM === "yandex") {
    const { initYandex } = await import("./yandex");
    platform = await initYandex();
  }
}
