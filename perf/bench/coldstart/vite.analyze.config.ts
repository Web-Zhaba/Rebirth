// Build the real app with every node_modules package pulled into a chunk of its own, so the size each dependency
// adds to the bundle can be read off one build. Nothing here is the shipped build: the output goes to
// perf/bench/coldstart/analyze-out and the repository's vite.config.ts is only read, never changed.
// Run: npx vite build --config perf/bench/coldstart/vite.analyze.config.ts
import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
import base from "../../../vite.config";

const pkgOf = (id: string): string | null => {
  const m = id.match(/node_modules\/((?:@[^/]+\/)?[^/]+)/);
  return m ? m[1] : null;
};

export default defineConfig(async (env) => {
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  const cfg = typeof base === "function" ? await base({ ...env, mode: "production" }) : base;
  return {
    ...cfg,
    root,
    build: {
      outDir: "perf/bench/coldstart/analyze-out",
      emptyOutDir: true,
      sourcemap: false,
      rollupOptions: {
        output: {
          manualChunks(id: string) {
            const p = pkgOf(id);
            if (!p) return undefined; // app code stays in the entry graph
            if (p.startsWith("@fontsource")) return "dep_fontsource";
            return "dep_" + p.replace(/[@/.]/g, "_");
          },
        },
      },
    },
    test: undefined,
  } as never;
});
