# Performance harness

Measurements behind `perf/reports/*.md`. Nothing here is part of the build or of the game: `perf/` is outside
`tsconfig` (`include: ["src"]`) and excluded from the default test include, so `npx vitest run` still runs the 158 source
files in seconds.

## Run

```bash
npx vitest run --config vitest.perf.config.ts                 # the whole harness, ~105 s
npx vitest run --config vitest.perf.config.ts perf/bench/sim  # one area
npx vitest run --config vitest.perf.config.ts perf/bench/gfx/labels.test.ts --reporter=verbose
```

Numbers are medians after a warm-up and are printed, not asserted (except `coldstart/dist-budget.test.ts`). The harness
needs default isolation: its files share module state otherwise, which is why it has its own config.

## Areas

| Dir | Reports | Measures |
|---|---|---|
| `bench/sim/` | `reports/sim.md` | `handler.tick` cost and its phases, the 00:00 daily chain, scaling to 2000 buildings, save/load, V8 self-time profile |
| `bench/ui/` | `reports/ui.md` | snapshot frequency and delivery path, every pure view model, `view/layers` rebuild, re-render frequency |
| `bench/gfx/` | `reports/gfx.md` | per-frame CPU budget of the engine, earcut/quadtree/mesh/label/ray micro-benchmarks, GPU-side counts read from code |
| `bench/map/` | `reports/map.md` | pointer-tool cost per event (stroke, road, land, place), road/field/tree meshes, hit index |
| `bench/coldstart/` | `reports/coldstart.md` | bundle sizes and gzip, fonts, `tsc`/`vite build` time, CDP cold start, worker and asset loading |

`bench/sim/out/` holds the raw output of the runs quoted in the reports.

`reports/wave1.md` is the outcome: the ten changes made from this profiling, each with its before/after from the same
harness.

## What it cannot measure

There is no browser, no GPU and no DOM in this environment: GPU time, Preact's diff cost and real paint/composite work are
**not** measured here. For those, the in-page harnesses already in the repo are the tool: `.claude/bench.js`
(`window.__bench` with `onFrame`/`onGpu` percentiles over named camera scenes) and `.claude/prof-snippet.js`
(`window.__prof()` with per-phase peaks, long tasks and frame gaps) run against `npm run dev`.

Machine was shared with other agents during these runs, so absolute values drift up to 1.5–2×; conclusions are drawn
from ratios, scaling curves and shares of a tick/frame.
