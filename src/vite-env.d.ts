interface ImportMetaEnv {
  // The portal build target (see src/platform); unset for the standalone site and itch.io.
  readonly VITE_PLATFORM?: "yandex" | "crazygames" | "poki" | "vk" | "gamedistribution" | "gamepix";
  // "off" drops the rewarded-ad offers where the portal serves no ads yet (CrazyGames Basic Launch).
  readonly VITE_REWARDED_ADS?: "off";
  // The game's id on GameDistribution (public, from its developer page).
  readonly VITE_GD_GAME_ID?: string;
}

// The release version from package.json (vite.config.ts), shown in «Об игре» so a report names its build.
declare const __APP_VERSION__: string;
