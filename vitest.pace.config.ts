import { defineConfig } from "vitest/config";

// `npm run pace`: the pacing harness is kept out of the default test include.
export default defineConfig({ test: { include: ["src/pace/pace.run.ts"], testTimeout: 600_000 } });
