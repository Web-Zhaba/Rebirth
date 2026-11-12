interface ImportMetaEnv {
  // The portal build target (see src/platform); unset for the standalone site and itch.io.
  readonly VITE_PLATFORM?: "yandex" | "crazygames";
  // "off" drops the rewarded-ad offers where the portal serves no ads yet (CrazyGames Basic Launch).
  readonly VITE_REWARDED_ADS?: "off";
}

// The release version from package.json (vite.config.ts), shown in «Об игре» so a report names its build.
declare const __APP_VERSION__: string;
