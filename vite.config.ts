import Icons from "unplugin-icons/vite";
import { readFileSync } from "node:fs";
import { defineConfig } from "vite";

const { version } = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as { version: string };

// `~icons/<set>/<name>` imports compile to Preact components at build time (only used icons ship). Those virtual
// .jsx modules are outside tsconfig, so esbuild needs the Preact JSX runtime spelled out here.
export default defineConfig({
  // Relative asset paths: portals serve the game from a subfolder inside their iframe.
  base: "./",
  // Per-portal settings: `vite build --mode <portal>` reads `env/.env.<portal>`.
  envDir: "env",
  // One release number on every portal; release-please bumps it in package.json.
  define: { __APP_VERSION__: JSON.stringify(version) },
  plugins: [Icons({ compiler: "jsx", jsx: "preact" })],
  esbuild: { jsx: "automatic", jsxImportSource: "preact" },
  // Agent worktrees under .claude/ hold other copies of src/.
  test: { exclude: ["**/node_modules/**", ".claude/**"] },
});
