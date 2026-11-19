import Icons from "unplugin-icons/vite";
import { readFileSync } from "node:fs";
import { defineConfig, type Plugin } from "vite";

const { version } = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as { version: string };

// Portal SDKs loaded by a script tag in index.html rather than by their adapter: CrazyGames' QA tool reports the SDK
// missing unless the tag is there (src/platform/crazygames.ts waits for the async script).
const HEAD_SDK: Record<string, string> = {
  crazygames: "https://sdk.crazygames.com/crazygames-sdk-v3.js",
};

function portalSdkTag(mode: string): Plugin {
  return {
    name: "portal-sdk-tag",
    transformIndexHtml: () => (HEAD_SDK[mode] ? [{ tag: "script", attrs: { id: `${mode}-sdk`, async: true, src: HEAD_SDK[mode] }, injectTo: "head-prepend" }] : []),
  };
}

// `~icons/<set>/<name>` imports compile to Preact components at build time (only used icons ship). Those virtual
// .jsx modules are outside tsconfig, so esbuild needs the Preact JSX runtime spelled out here.
export default defineConfig(({ mode }) => ({
  // Relative asset paths: portals serve the game from a subfolder inside their iframe.
  base: "./",
  // Per-portal settings: `vite build --mode <portal>` reads `env/.env.<portal>`.
  envDir: "env",
  // One release number on every portal; release-please bumps it in package.json.
  define: { __APP_VERSION__: JSON.stringify(version) },
  plugins: [Icons({ compiler: "jsx", jsx: "preact" }), portalSdkTag(mode)],
  esbuild: { jsx: "automatic", jsxImportSource: "preact" },
  // Agent worktrees under .claude/ hold other copies of src/.
  test: { exclude: ["**/node_modules/**", ".claude/**"] },
}));
