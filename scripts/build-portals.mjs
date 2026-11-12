// Builds the game for each portal and packs its zip: `dist-<portal>/` checked by scripts/pack.mjs, then
// `rebirth-<portal>.zip` at the root. Type-checks once first. Each portal build reads `.env.<portal>` (its adapter in
// src/platform); itch.io gets the standalone build. GameDistribution is skipped until its game id is known
// (VITE_GD_GAME_ID in `.env.gamedistribution` or the environment): its SDK cannot start without one.
// Usage: node scripts/build-portals.mjs [portal ...]   (no names: every portal)
import { execFileSync } from "node:child_process";
import { build, loadEnv } from "vite";

const PORTALS = ["yandex", "crazygames", "poki", "vk", "gamedistribution", "gamepix", "itch"];

const asked = process.argv.slice(2);
const unknown = asked.filter((p) => !PORTALS.includes(p));
if (unknown.length) {
  console.error(`unknown portal: ${unknown.join(", ")} (known: ${PORTALS.join(", ")})`);
  process.exit(2);
}

execFileSync("npx", ["tsc", "--noEmit"], { stdio: "inherit", shell: true });
for (const portal of asked.length ? asked : PORTALS) {
  if (portal === "gamedistribution" && !loadEnv(portal, process.cwd()).VITE_GD_GAME_ID) {
    console.warn("gamedistribution: skipped, VITE_GD_GAME_ID is not set");
    continue;
  }
  const outDir = `dist-${portal}`;
  await build({ mode: portal === "itch" ? "production" : portal, logLevel: "warn", build: { outDir, emptyOutDir: true } });
  execFileSync(process.execPath, ["scripts/pack.mjs", portal, outDir, `rebirth-${portal}.zip`], { stdio: "inherit" });
}
