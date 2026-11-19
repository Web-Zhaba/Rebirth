// Builds the game for each portal and packs its zip: `release/<portal>/` checked by scripts/pack.mjs, then
// `release/rebirth-<portal>.zip`. Type-checks once first. Each portal build reads `env/.env.<portal>` (its adapter in
// src/platform); itch.io gets the standalone build. GameDistribution requires VITE_GD_GAME_ID in
// `env/.env.gamedistribution` or the environment and is skipped in all-portal builds without it.
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

const gd = loadEnv("gamedistribution", "env").VITE_GD_GAME_ID;
if (asked.includes("gamedistribution") && !gd) {
  console.error("gamedistribution: VITE_GD_GAME_ID is required");
  process.exit(2);
}

execFileSync("npx", ["tsc", "--noEmit"], { stdio: "inherit", shell: true });
for (const portal of asked.length ? asked : PORTALS) {
  if (portal === "gamedistribution" && !gd) {
    console.warn("gamedistribution: skipped, VITE_GD_GAME_ID is not set");
    continue;
  }
  const outDir = `release/${portal}`;
  await build({ mode: portal === "itch" ? "production" : portal, logLevel: "warn", build: { outDir, emptyOutDir: true } });
  execFileSync(process.execPath, ["scripts/pack.mjs", portal, outDir, `release/rebirth-${portal}.zip`], { stdio: "inherit" });
}
