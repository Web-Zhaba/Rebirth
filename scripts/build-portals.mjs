// Builds the game for each portal and packs its zip: `release/<portal>/` checked by scripts/pack.mjs, then
// `release/rebirth-<portal>.zip`. Type-checks once first. Each portal build reads `env/.env.<portal>` (its adapter in
// src/platform); itch.io gets the standalone build. Targets that need an ID are skipped in all-portal builds
// until the ID is available in the corresponding Vite env file or process environment.
// Usage: node scripts/build-portals.mjs [portal ...]   (no names: every portal)
import { execFileSync } from "node:child_process";
import { build, loadEnv } from "vite";

const PORTALS = ["yandex", "crazygames", "crazygames-full", "poki", "vk", "gamedistribution", "gamepix", "gamemonetize", "y8", "itch"];
const REQUIRED_IDS = {
  gamedistribution: "VITE_GD_GAME_ID",
  gamemonetize: "VITE_GM_GAME_ID",
  y8: "VITE_Y8_APP_ID",
};

const asked = process.argv.slice(2);
const unknown = asked.filter((p) => !PORTALS.includes(p));
if (unknown.length) {
  console.error(`unknown portal: ${unknown.join(", ")} (known: ${PORTALS.join(", ")})`);
  process.exit(2);
}

const buildable = [];
for (const portal of asked.length ? asked : PORTALS) {
  const id = REQUIRED_IDS[portal];
  if (id && !loadEnv(portal, "env")[id]?.trim()) {
    const message = `${portal}: ${id} is required`;
    if (asked.length) {
      console.error(message);
      process.exit(2);
    }
    console.warn(`${message}, skipping build`);
    continue;
  }
  buildable.push(portal);
}

execFileSync("npx", ["tsc", "--noEmit"], { stdio: "inherit", shell: true });
for (const portal of buildable) {
  const outDir = `release/${portal}`;
  await build({ mode: portal === "itch" ? "production" : portal, logLevel: "warn", build: { outDir, emptyOutDir: true } });
  const archiveRules = portal === "crazygames-full" ? "crazygames" : portal;
  execFileSync(process.execPath, ["scripts/pack.mjs", archiveRules, outDir, `release/rebirth-${portal}.zip`], { stdio: "inherit" });
}
