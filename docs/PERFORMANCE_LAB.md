# Performance Lab

This branch contains development-only tools for finding Rebirth performance bottlenecks on real hardware.

## Quick laptop test

1. Run `npm install` once.
2. Run `npm run dev`.
3. Open the game in Chromium/Chrome/Edge.
4. The **Rebirth Performance Lab** appears in the bottom-right corner in DEV builds.
5. Move to the location/state you want to test.
6. Press **Start 15s** and perform one repeatable action during the capture.
7. Press **Copy JSON** and save the report with a descriptive name.

The panel records frame times (average/p50/p95/p99/max), approximate FPS, counts of slow frames, browser Long Tasks, JS heap information where Chromium exposes it, camera position and custom `performance.measure` entries.

## Recommended scenarios

Run each scenario at least three times after one warm-up run.

| Scenario | What to do | Main signal |
| --- | --- | --- |
| Idle city | Do not touch camera for 15 s | baseline frame p95, long tasks |
| Pan city | Continuously pan around a developed city | render/model pressure |
| Rotate/pitch | Rotate and tilt close to buildings/forest | Three.js/MapLibre GPU/CPU pressure |
| Zoom threshold | Repeatedly cross zoom 12.5 | terrain creation stalls/freezes |
| Terrain recenter | Pan far enough to rebuild custom terrain | terrain build/tile timings |
| Dense forest | Move/rotate in dense forest | vegetation cost |
| Water | Inspect coast/river/lake at close zoom | water layer cost |
| Fields | Inspect a developed farming area | field geometry/render cost |
| Fast simulation | Run highest game speed without moving camera | worker/snapshot pressure |
| Combined stress | highest speed + pan/zoom developed city | worst interactive case |

Use the same save, camera locations and browser zoom when comparing commits.

## DevTools API

The DEV build exposes:

```js
perfLab.start()
perfLab.summary()
perfLab.stop()
perfLab.clear()
```

`stop()` returns a JSON-friendly report. The existing `map` and `simClient` handles remain available.

## Instrumented components

The first instrumentation pass includes:

- requestAnimationFrame frame pacing;
- Long Tasks via PerformanceObserver where supported;
- Chromium JS heap counters where supported;
- Terrarium DEM tile fetch/decode as `terrain.dem.tile`;
- OpenFreeMap vector tile fetch/decode as `vector.tile.load`;
- all Performance API measures present during the capture.

More component timers should use the small `measure(name, fn)` helper in `src/perf/profiler.ts`. Prefer coarse meaningful spans (terrain rebuild, forest rebuild, model merge) rather than timing inner loops: profiling itself must not become the bottleneck.

## Reading results

Prioritize p95/p99 and long frames over average FPS. A smooth 60 FPS average can still hide visible 100-300 ms stalls.

- high frame p95 with few Long Tasks: investigate rendering/GPU/layout;
- Long Tasks aligned with `terrain.dem.tile` or terrain rebuild: investigate CPU decode/build;
- large vector tile timings: separate network time from parsing before optimizing;
- stable idle but bad pan/zoom: map/geometry rebuild path;
- stable camera but bad fast simulation: worker/snapshot/state update path;
- increasing heap across repeated identical scenarios: investigate retained caches/objects.

For deep investigation after this lab identifies a scenario, record that exact scenario in Chrome Performance and inspect the flame chart.

## Comparison discipline

Performance results are hardware-sensitive. Never compare one laptop's raw FPS to another as if it were a regression test. Compare before/after builds on the same machine and use repeated runs.

The toolkit intentionally lives on a profiling branch until its overhead and usefulness are understood.
