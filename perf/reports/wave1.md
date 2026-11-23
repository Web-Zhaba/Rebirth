# Wave 1: what was changed and what it bought

Ten changes from the plan in `reports/*.md`, all measured with the same harness, on the same towns. Numbers are medians;
the machine was shared with other agents, so ratios matter more than absolutes.

## 1. The clock left TopBar — `src/ui/Clock.tsx`, `clockFace.ts`, `useGameMinutes.ts`, `TopBar.tsx`

`useGameMinutes` used to `setState` a whole minute inside TopBar every frame, so the largest HUD subtree re-rendered
7-22 times a second (a game minute every 139 ms at 1x, every 45 ms at 4x, and every frame at 4x by night).

| speed | TopBar re-renders/s before | after (snapshots only) |
|---|---|---|
| 1x | 7 | 0.72 |
| 2x | 8 | 0.80 |
| 4x | 22 | 1.92 |

One rAF loop now feeds a single `gameMinute` signal, and only the clock leaves subscribe to it. `clockFace.test.ts`
compares the new pure function with the old inline formula over ~6900 minutes (a year and a half of game time), so the
format, the phase marks and the night boost are unchanged.

## 2. `streetFoundations` / `streetProgress` cached — `src/sim/foundationLots.ts`, `streets.ts`, `digging.ts`

Two full passes per card and `Object.values(buildings)` per street became one pass, kept by the identity of the state
parts (copy-on-write, `sim/memo.ts`).

| probe | before | after |
|---|---|---|
| `streetFoundations`, 120 foundations x 40 streets | 1.48-1.81 ms | 0.10-0.51 cold, **0.0004** cached |
| `streetOf` + `digBlocker` + `streetDigs` for one card | 2.91-4.73 ms | **0.001** |
| `buildOutlineView`, one card | 2.99-4.15 ms | **0.008-0.009** warm, 0.10 when the finds just changed |
| `buildOutlineView` over all 120 foundations | ~360 ms | **0.55 ms** |
| `streetProgress` x 40 streets | 1.56-2.25 ms | **0.010** |
| `digBlocker` x 120 foundations | 0.15-0.27 ms | **0.005** |

## 3. `placesView`: the nearest street once per feature — `src/ui/placesModel.ts`

`nearestStreet` ran inside the loop over streets, so the whole view was quadratic.

| town | before | after |
|---|---|---|
| the fixture (40 streets, 80 features) | 3.27-4.35 ms | **0.13-0.20 ms** |
| 40 x 80 | 8.2-10.3 ms | **0.18-0.29 ms** |
| 80 x 160 | 75.8-83.8 ms | **0.54-0.84 ms** |

## 4. `buildingItems` kept per building — `src/view/layers/buildings.ts`, `itemMemo.ts`

Every snapshot rebuilt 481 `ModelItem`s and their signature strings. Snapshots carry only the buildings that changed
(`sim/delta.ts`), so an untouched building is the same object; its item is now kept by that identity, and the finds are
indexed by id instead of scanned per heritage building.

| probe | before | after |
|---|---|---|
| `buildingItems`, per snapshot | 0.17-0.33 ms | **0.090 ms** |
| all of `view/layers`, per snapshot | 0.18-0.34 ms | **0.103 ms** (max 0.472) |

## 5. `roadTool`: one validation per frame, and none twice — `src/map/roadTool.ts`

`addRoad` costs 5.4-10.5 ms on a bent preview, and it ran on every `pointermove` (a 125 Hz mouse fires twice a frame).
Moves are now coalesced into one rAF, a repeat at the same pixel is dropped, and a path within a metre of the last one on
the same road graph reuses its verdict instead of validating again (~2x fewer validations, none for a still pointer).
Not measurable in Node: the win is in event handling, not in the validation itself.

## 6. `planStroke`: the town prepared once per plan — `src/sim/stroke.ts`, `growth.ts`

`canPlace` rebuilt the cell map and the occupancy hash for every candidate. A prepared context does it once; each
accepted lot is added as it is placed.

| buildings | 60 m | 300 m | 900 m |
|---|---|---|---|
| 102 | 0.84 -> **0.09** | 3.13 -> **0.27** | 4.92 -> **0.27** |
| 300 | 0.85 -> **0.06** | 5.42 -> **0.22** | 11.36 -> **0.37** |
| 600 | 2.62 -> **0.11** | 8.80 -> **0.30** | 18.28 -> **0.53** |

The drag frame (`spansAlong` + `planStroke`, 300 m) went 1.96 / 4.33 / 10.89 -> **0.17 / 0.29 / 0.60** ms and no longer
grows with the size of the town. `sim/stroke.test.ts` compares the new plan with a verbatim copy of the old one on seven
fixtures; two mutations of the new code were checked to fail it.

## 7. `forest`: no work for an unchanged frame — `src/engine/scene/forest.ts`, `forest.test.ts`

`prepare` (tile walk, `blockShares`, `thinReach`, sort, job table) and the job-table hash ran every frame although only
camera movement changes their result. A frame key (eye, `viewProj`, frustum parameters, viewport, terrain page version,
drape stream state, tiling epoch) now gates both; the uniform and look writes stay per-frame, so nothing observable
moves. ~0.25-0.30 ms lifted off every still frame, up to ~2 ms when z15 pages cover the view.

## 8. `pickLabels`: a grid instead of every pair — `src/view/engine/labelLayout.ts`

| boxes | before | after |
|---|---|---|
| 300 | 0.114 ms | **0.058 ms** |
| 1000 | 0.842 ms | **0.266 ms** |

Two label layers a frame, so ~1.2 ms come off a zoomed-out peak. `labelLayout.test.ts` compares the grid with a
reference pairwise implementation on the same boxes: equal coordinates, equal priorities, a touch exactly on the pad
edge, a box across many cells, one overloaded cell, grid overflow, and 6000 random sets in a one-off fuzz (0
differences).

## 9. Fonts: woff2 only, no Golos 500 — `src/ui/tokens.css`

| | files | KiB |
|---|---|---|
| before | 24 | 321.5 (woff2 145.6 + woff 175.8) |
| after | **10** | **127.0** (woff2 only) |

The 12 `.woff` files were downloaded by nobody. Cyrillic was checked in Chrome over CDP: 10 faces, all loaded, Bitter 800
"ЖЖЖ" 102.9 px (86.0 for the serif fallback), the same as before. `.stat-delta` (`topbar.css`) asked for the removed
weight 500 and silently got 400; it now asks for 400.

## 10. The sim worker comes up on first use — `src/simClient.ts`

It was constructed when the module was imported, before the engine and before the first frame. Now `load()` creates it:
~100 kB gzip (350 kB raw, 360 kB gzip of the 951 kB main chunk's sibling) leaves the critical path, a browser without
WebGPU never starts it, and tests that import `simClient` no longer spawn a worker.

## Checks

| | |
|---|---|
| `npx tsc --noEmit` | 0 errors, 8.0 s |
| `npx vitest run` | **163 files / 1534 tests** green, 5.8 s (was 158 / 1486) |
| `npx vite build` | 5.7 s; dist **1721 kB raw / 795 kB gzip** (was 1910 / 986), main 951.4 kB / 352 gz (was 945.2 / 349.5) |
| harness, `--config vitest.perf.config.ts` | 23 files / 69 tests green |

The main chunk grew by ~6 kB: the frame key, the label grid, the clock leaves and the memo tests are new code. The
handwritten bundle lost 189 kB overall, all of it fonts.

## Needs a look in the browser

- The forest gate is correct only in what it compares; a still camera must look identical, and the shadow must step
  when the sun, the tiles or the trees change. `forest.test.ts` covers the key, not the picture.
- The clock leaves: no DOM in this environment, so re-render frequency is measured by construction, not by Preact.
- The pointer coalescing delays the road preview by at most one frame.

---

# Also before the release

The cheapest and safest items from the release triage, plus the antialiasing setting.

## Window resize: the MSAA targets wait for the size to settle — `src/engine/engine.ts`

`fitCanvas` ran on every frame and a change of size destroyed and recreated both MSAA targets. A window drag changes the
canvas size on every frame: at dpr 2 on a large window that is two textures of about 90 MB each, 60 times a second, plus
a Hi-Z refit. Now the canvas keeps its backing size while the CSS size is still moving — the browser stretches the last
frame, which is what native windows do — and the targets are made once the size has held for `RESIZE_SETTLE_MS` (120 ms).
A single change (fullscreen, a rotated phone) is sharp one settle later; a canvas mounted before layout (1x1) is not gated.

## Bounded answers in the tile scheduler — `src/engine/stream/scheduler.ts`

`missing` and `gaveUp` grew for the whole session: every tile a flight crossed that answered 404 or ran out of retries
stayed in memory. Both sets are capped (`rememberedCap`, 4096) and the oldest answer is forgotten first; a forgotten tile
is simply asked for again if the view returns. Tests use a cap of 8 so they stay instant.

## The forest tile cache forgets its oldest quarter — `src/engine/scene/forest.ts`

`tiles.clear()` at 20 000 height ranges threw the whole cache away and rebuilt it, which cost a frame. `dropOldest` drops
the oldest quarter instead, and a cache hit re-inserts its tile, so the cache is LRU.

## Settings: antialiasing, off or 4x — `map/graphicsSettings.ts`, `ui/SettingsDialog.tsx`, `engine/engine.ts`, `engine/frame/hiz.ts`, `view/engine/mount.ts`

A "Сглаживание" row with the note that the choice applies after a reload; stored under `rebirth.antialias`; passed to
`Engine.create(canvas, samples)` and from there into `RenderTarget.sampleCount`, which every pipeline and both targets
already read.

WebGPU builds multisampled textures at **four samples or one**, and nothing in between: a first version of this setting
offered 2x, created a texture the device refused to validate, and the canvas went black under a live interface. The
modes are therefore off (1) and 4x, and the engine clamps whatever it is given (`samples >= 4 ? 4 : 1`), so a value from
an older build or a hand-edited storage cannot black the screen again.

Off is not just "no MSAA texture": the main pass draws straight into the canvas, with no resolve, and the Hi-Z pass —
which the forest's GPU culling reads — binds a plain depth texture instead of a multisampled one. `hiz.ts` derives that
variant with `singleSample()`, three line replacements of the same WGSL (binding type, sample count, the load), and
`hiz.test.ts` pins them: the three changed lines, and every other line byte for byte, so the shader and the transform
cannot drift apart.

Why a reload: the sample count is baked into the twelve pipelines of the main pass and into the depth texture above.
Switching it live means rebuilding every pipeline; that waits for the browser measurement pass, together with the dpr
cap.

## Checks

| | |
|---|---|
| `npx tsc --noEmit` | 0 errors |
| `npx vitest run` | **165 files / 1552 tests** green, 4.2 s |
| `npx vite build` | 4.4 s; dist **1725 kB raw / 796 kB gzip** (was 1721 / 795) |
| harness: `gfx/framePaths`, `gfx/labels`, `coldstart/dist-budget` | green |

One flake surfaced and was removed: the first version of the eviction test made 4200 requests and pushed the existing
budget test `sim/life.test.ts` (2000 residents routed under 100 ms) over its limit when files run in parallel. The cap is
now a scheduler option and the test uses 8.
