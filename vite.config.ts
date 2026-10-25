import Icons from "unplugin-icons/vite";
import { defineConfig } from "vite";

// `~icons/<set>/<name>` imports compile to Preact components at build time (only used icons ship). Those virtual
// .jsx modules are outside tsconfig, so esbuild needs the Preact JSX runtime spelled out here.
export default defineConfig({
  plugins: [Icons({ compiler: "jsx", jsx: "preact" })],
  esbuild: { jsx: "automatic", jsxImportSource: "preact" },
  // Agent worktrees under .claude/ hold other copies of src/.
  test: { exclude: ["**/node_modules/**", ".claude/**"] },
});
