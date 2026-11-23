// Build the real app with every node_modules package pulled into a chunk of its own, so the size each dependency
// adds to the bundle can be read off one build. Nothing here is the shipped build: the output goes to
// perf/bench/coldstart/analyze-dirs and the repository's vite.config.ts is only read, never changed.
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
      outDir: "perf/bench/coldstart/analyze-dirs",
      emptyOutDir: true,
      sourcemap: false,
      rollupOptions: {
        output: {
          manualChunks(id: string) {
            const p = pkgOf(id);
            if (p) return p.startsWith("@fontsource") ? "dep_fontsource" : "dep_" + p.replace(/[@/.]/g, "_");
            // App code: one chunk per layer folder under src/.
            const m = id.match(/[\/]src[\/]([^\/]+)[\/]/);
            if (m) return "app_" + m[1];
            const f = id.match(/[\/]src[\/]([^\/]+)$/);
            return f ? "app_root_" + f[1].replace(/[^a-z0-9]/gi, "_") : undefined;
          },
        },
      },
    },
    test: undefined,
  } as never;
});
