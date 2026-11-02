// The portal the game is published on, picked at build time: `vite build --mode yandex` reads `.env.yandex`.
// The core talks only to this module; a portal's SDK never reaches the standalone bundle (the branch below is a
// build-time constant, so Vite drops the other adapter).
export interface Platform {
  // Loading is over and the player can act.
  ready(): void;
  // Active play started (true) or stopped (false): the clock runs, no menu or ad covers the game.
  gameplay(on: boolean): void;
}

// What the portal may ask of the game, e.g. around its ads and overlays.
export interface PlatformHooks {
  pause(): void;
  resume(): void;
}

export const NO_PLATFORM: Platform = { ready() {}, gameplay() {} };

export async function initPlatform(hooks: PlatformHooks): Promise<Platform> {
  if (import.meta.env.VITE_PLATFORM === "yandex") {
    const { initYandex } = await import("./yandex");
    return initYandex(hooks);
  }
  return NO_PLATFORM;
}
