import { defineConfig } from "vitest/config";

// `npx vitest run --config vitest.perf.config.ts`: the performance harness is kept out of the default test include
// (`test.exclude` in vite.config.ts) and run on its own. It prints measurements rather than asserting behaviour, is
// slow on purpose (thousands of ticks, hundreds of buildings) and needs default isolation: its files share module
// state otherwise, as the default suite deliberately does.
export default defineConfig({ test: { include: ["perf/bench/**/*.test.ts"], testTimeout: 600_000, hookTimeout: 600_000 } });
