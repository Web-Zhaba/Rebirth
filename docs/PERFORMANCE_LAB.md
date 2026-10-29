# Performance Lab

This branch contains development-only tools for finding Rebirth performance bottlenecks on real hardware.

## Quick laptop test

1. Run `npm install` once.
2. Run `npm run dev`.
3. Open the game in Chromium/Chrome/Edge.
4. The **Rebirth Performance Lab** appears in the bottom-right corner in DEV builds.
5. Move to the location/state you want to test.
6. For a single manual sample, press **Start 15s** and perform one repeatable action during the capture.
7. For diagnosis, prefer **Auto benchmark**. Keep the camera and game state unchanged while it runs.
8. When complete, the browser console receives a comparison table and the panel contains the full JSON report.
9. Press **Copy JSON** and save/send the report.

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


## Automatic benchmark suite

**Auto benchmark** runs a controlled A/B suite. Default timing is 2.5 s warm-up, 1.8 s settling after each setting change, then 7 s captured per case.

Cases:

1. current settings baseline;
2. relief off;
3. 3D forest off;
4. 3D water off;
5. 3D fields off;
6. smoke off;
7. decorative motion off;
8. clouds and cloud shadows off;
9. building/road 3D model layers off;
10. relief on with the tested 3D extras off;
11. relief and tested 3D extras off.

The suite restores the original graphics settings after completion or failure. It changes the in-memory signals rather than writing benchmark choices to localStorage.

Each case contains:

- FPS and frame-time avg/p50/p95/p99/max;
- frames over 16.7/33.3/50/100 ms;
- Long Task count/total/max;
- JS heap counters when available;
- grouped Performance API measures with count/avg/p95/max/total;
- optional layer diagnostics already exposed by the build (tree/model/water/field/cloud/shadow/landscape stats);
- delta from baseline for FPS, p95, p99 and >33 ms frames.

The final `ranking` orders variants by p95 improvement and then FPS gain. Treat a large improvement from one isolated "off" case as a strong lead, then reproduce that case with a manual 15 s run before changing production code.

### Interpretation of the two control cases

`Relief with 3D extras off` is especially important. If it remains slow while the fully flat case is fast, the terrain itself or MapLibre's terrain path is the likely bottleneck.

If relief with extras disabled becomes fast, but baseline is slow, one or more terrain-aware custom layers are responsible. Compare the individual forest/water/models/etc. cases.

The fully flat minimal case is a practical rendering floor for the same camera and save. It is not expected to match production visuals.

### Console API

In addition to the panel:

```js
await perfLab.suite()
```

returns the complete suite object. Use this when you want to save or process results directly in DevTools.
