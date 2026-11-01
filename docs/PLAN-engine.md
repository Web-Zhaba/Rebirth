# Own render engine (replacing MapLibre)

Status: proposal, 2026-11-01. Nothing here is implemented yet.

## 1. Goal

Replace MapLibre (and the three.js host that rides on its GL context) with an engine built for this game:

- terrain LOD tuned to the game, not to a slippy map;
- only the geometry the camera needs is resident;
- floating origin / camera-relative rendering, exact from orbit to street level;
- our own globe ↔ local transition;
- one depth buffer for everything;
- ground, water, forest and buildings that know about each other;
- GPU culling (frustum + LOD) and occlusion culling;
- a far world that costs a fraction of the near one;
- no map-style zoom levels in game logic.

The simulation (worker, `src/sim/`), world sampling (`src/world/`) and the Preact UI are not part of this work,
except where they talk to the map (section 4, N1).

## 2. What MapLibre does for us today

Inventory (2026-11-01) of what has to exist in the new engine before MapLibre can go.

| Area | Today | Where |
|---|---|---|
| Globe, globe→mercator blend | style `projection: globe`, `projectionTransition` in custom layers | `style.ts`, `three/host.ts`, `modelLayer.ts:33-62` |
| Camera + input | flyTo/jumpTo/fitBounds, default drag/scroll/touch handlers, own trackpad handler | `motion.ts`, `trackpadGestures.ts`, `PlaceSearch.tsx` |
| Terrain | `setTerrain` (raster-dem terrarium z11, ×1.6), hillshade layer, `setSky` | `relief.ts`, `style.ts:90-152` |
| Nature base | native fill/line layers from OpenFreeMap (landcover, water, waterway, shore, forest edge) | `style.ts`, `contextLayer.ts` |
| Game 2D overlays | ~15 GeoJSON sources: zones, roads (lines), building fills, ruins, life walkers/lights, traffic, reach, night tint, weather fills, tool previews | `zoneLayer.ts`, `roadLayer.ts`, `buildingLayer.ts`, `ruinsLayer.ts`, `lifeLayer.ts`, `weatherLayer.ts`, `nightLayer.ts`, tools |
| 3D (three.js custom layers) | models + lamps, trees (3 LODs, impostors), water, fields, smoke, clouds (ray-march to low-res RT), cloud shadows | `modelLayer.ts`, `treeLayer.ts`, `waterLayer.ts`, `fieldLayer.ts`, `smokeLayer.ts`, `clouds/` |
| Text | symbol layers with OpenFreeMap glyph PBFs: place labels, ruin names, zone labels | `style.ts:196-215`, `ruinsLayer.ts:347-390`, `zoneLayer.ts` |
| DOM anchored to the map | `Marker` (badges, articles, founding pin, builder tasks), tool cursor labels | `badgeLayer.ts`, `articleMarkerLayer.ts`, `FoundCity.tsx`, tools |
| Picking | `project`, `queryRenderedFeatures(["water"])`, layer click on walkers; buildings already hit-tested by our own index | `zoneTool.ts:369`, `FoundCity.tsx:61`, `lifeLayer.ts:151`, `buildingHitIndex.ts` |
| Tiles | fetch, cache, worker decode for style sources; our own MVT/DEM decode on the main thread | MapLibre worker, `world/tiles.ts` |
| Attribution | compact AttributionControl (OSM / OpenFreeMap / terrain credits — legally required) | `mapView.ts:18-22` |

Zoom as game logic (all of it has to move to camera distance / metres-per-pixel): tool gates
(`MIN_ZONE_ZOOM`, `MIN_ROAD_ZOOM`, `FIELD_MIN_ZOOM`), brush and snap sizes, layer `minzoom`/`maxzoom`,
zoom-exponential line widths, `TREES_FROM_ZOOM`, `WATER_FROM_ZOOM`, `FIELD_FROM_ZOOM`, `SMOKE_FROM_ZOOM`,
cloud fades, fly-to zoom floors in the UI. Full list in the inventory report; grep `getZoom|minzoom|_ZOOM`.

Known pains the engine should remove by construction:

- every vertex stored twice (globe frame + mercator frame) to survive the projection blend (`modelBuffers.ts`);
- our layers are not terrain-aware: heights re-sampled on the CPU to match MapLibre's mesh, with a 0.3–0.5 m plinth to
  hide the mismatch (`groundSeat.ts`);
- the night tint and weather fills are draped on the terrain only, so models tint themselves and roofs get no snow;
- layer-order juggling so MapLibre's terrain render-to-texture cache keeps working (`relief.ts reliefOrder`);
- relief costs ~40 % of the frame on the far globe view (144 → 88 fps in the stage-1 check);
- cloud shadows assume a z = 0 ground (parallax on high terrain);
- private internals: `defaultProjectionData`, `transform.fov`, MapLibre blend/state assumptions in `three/host.ts`.

## 3. Key decisions

### 3.1 API: WebGPU only

GPU culling and Hi-Z occlusion need compute shaders and indirect draws. WebGL2 has neither; a WebGL2 fallback would
mean a second, CPU-culled renderer. WebGPU ships in Chrome/Edge (desktop + Android), Safari 26 (macOS/iOS) and
Firefox on Windows and Apple-silicon macOS. Linux Firefox is the main gap. Decision: **WebGPU only**, with a clear
"browser not supported" screen. (Product call — confirm.)

Not in core WebGPU: multi-draw-indirect, bindless. Design for one `drawIndexedIndirect` per (mesh, LOD) bucket and
vertex pulling from storage buffers, not for one draw per object.

### 3.2 Language: TypeScript engine, Rust only where profiling proves it

Decided 2026-11-01: the engine is **TypeScript on raw WebGPU, without three.js**. Keep Rust as an option for one
isolated module (the tile/mesh baker in workers) if measurements show the CPU side is the bottleneck.

Why not a Rust (wgpu → WASM) engine:

- The listed goals are GPU-architecture goals. With GPU-driven culling the per-frame CPU work is a few hundred
  `setBindGroup`/`drawIndirect` calls and a small chunk-table upload; the host language barely shows up in the frame.
  What is expensive (terrain, overdraw, trees, clouds) runs in WGSL either way.
- Every WebGPU call from wgpu-on-web crosses WASM → JS, and wgpu validates on top of the browser's own validation.
  It is not faster than calling WebGPU from TS.
- The CPU-heavy, already-tested builders stay usable: `roadModels`, `roadJunctions`, `modelGeometry`, `townModels`,
  `waterMesh`, `fieldMesh`, `treeScatter`, `groundSeat`, `curve`. A Rust engine means rewriting them and their tests,
  and `src/world/terrain.ts` (the height the rules use) would exist twice and drift.
- One language, Vite HMR and vitest for engine logic. The project's own measurement (`docs/forest-optimization.md` §6)
  already found JS↔WASM marshalling comparable to the cost it would save.
- All current shaders are hand-written GLSL in `ShaderMaterial`s; three.js is only a thin host. Dropping it is cheap,
  and the GLSL → WGSL port is needed in both languages.

What would flip the decision to Rust + wgpu: a **native desktop/mobile client** as a real goal (wgpu runs natively,
one engine for web and native). If that is on the roadmap, the plan below keeps the same milestones; N2–N7 are written
in Rust, the TS side keeps a thin `view` facade (N1), and the geometry builders are ported with their tests.

### 3.3 Threading

- Render on the **main thread** (DOM markers, tool previews and the canvas must agree on the camera in the same
  frame; an OffscreenCanvas worker adds a frame of lag between them).
- Everything heavy off the main thread: a **baker worker pool** fetches DEM and vector tiles, decodes, triangulates,
  scatters, builds meshes, and returns transferable `ArrayBuffer`s. Main thread only uploads into GPU pools within a
  per-frame budget. (Today MVT/DEM decode runs on the main thread, `world/tiles.ts`.)
- The sim worker is untouched; its snapshots feed the content builders as now.

### 3.4 World space, floating origin, precision

- One world: Earth as WGS84 ellipsoid, positions as **ECEF float64 on the CPU**. No mercator, no projection blend:
  the globe view and the street view are the same 3D scene seen from different heights. This retires the
  globe/mercator double vertices.
- Every resident piece of geometry (terrain node, content chunk, instance block) has an **f64 origin** and an
  orientation (local ENU at that origin); its vertices are f32 metres relative to that origin.
- Each frame the CPU writes a **chunk table**: per chunk `origin − camera` (computed in f64, stored f32) plus its
  rotation. Shaders work in camera-relative metres only. A few thousand chunks × 64 B is < 0.5 MB/frame.
  This is the floating origin: the camera is always at (0,0,0), so precision is best where the eye is, globally.
- The town's tangent-plane frame (`src/world/frame.ts`) stays the sim's frame. The engine maps town metres → lat/lng →
  ECEF per chunk origin; inside a 200 m chunk the tangent/curved difference is < 1 mm. (At 10 km the plane is
  7.8 m above the ellipsoid — which is why we never use one plane for the whole town.)
- Depth: **reversed-Z, `depth32float`, infinite far plane**, near plane adaptive (≈ 0.1 m at street level, scaled with
  camera height). One depth buffer from orbit to street.

### 3.5 Camera without zoom

- Camera state: target point (lat, lng, h), distance to target, heading, pitch, fov. Controllers: *orbit* (far:
  rotate the globe under the cursor), *ground* (near: grab-pan on the terrain, tilt, rotate), blended by distance —
  this is the "globe/local transition", a control and LOD change, not a projection change.
- Game rules use `metersPerPixel(screenPoint)` and camera distance. A `zoomLike()` helper (log2 of mpp) exists only to
  migrate old thresholds in N1, then goes away.
- LOD everywhere is **screen-space error** (projected size / geometric error in pixels), not a level number.

## 4. Architecture

```
src/view/          engine-neutral facade the game talks to (N1): camera, pick, project, overlays, markers
src/engine/
  gpu/             device, pools (slab allocators in big GPU buffers), pipelines, WGSL modules with #include
  frame/           frame graph: passes, transient targets, per-frame uniforms, chunk table
  camera/          controllers, input (pointer, wheel, trackpad, touch, inertia), fly animations
  stream/          request scheduler (priority = screen-space error / distance, per-frame budgets, LRU, hysteresis)
  bake/            worker pool + jobs: DEM, MVT decode, drape raster, water/field/road meshes, tree scatter
  terrain/         globe quadtree (CDLOD), height atlas, game-area exact heights, terrain edits
  drape/           per-terrain-node overlay textures (landcover, zones, far roads, fields, snow masks)
  scene/           content kinds: models, roads, water, trees, fields, ruins, smoke, life
  cull/            compute: frustum + LOD + Hi-Z, compaction, indirect args
  light/           sun/moon, time of day, atmosphere LUTs, fog, night, weather material params
  sky/             atmosphere, clouds (ray-march), precipitation
  text/            MSDF glyph atlas (Cyrillic + Latin), label placement + collision
  pick/            CPU ray vs height field; GPU id buffer for objects
```

Frame (one depth buffer throughout):

1. CPU: input → camera; stream scheduler; chunk table upload; per-frame uniforms.
2. Compute: cull phase 1 — last frame's visible set, frustum + LOD → indirect args.
3. Opaque pass: terrain (with drape textures), models, roads, trees (full + impostors), fields, ruins. Object ids into
   an `r32uint` target only when a pick is pending.
4. Compute: Hi-Z pyramid from depth; cull phase 2 — previously culled candidates vs Hi-Z → draw the newly visible.
5. Water (reads opaque depth for shore foam/depth tint/refraction), then transparents (smoke, precip), clouds
   composite (low-res ray-march as today), aerial perspective, tone/output.
6. Overlays that must sit on everything: tool previews as depth-tested decals, labels (MSDF), DOM markers via
   `project()`.

Ground, water, forest, buildings — how they interact:

- **Heights:** one height source. In the game area (town radius + margin) terrain uses the exact z11 DEM grid and the
  same bilinear sample as `src/world/terrain.ts` (manual bilinear in WGSL on an `r32float` page, texel-aligned), so
  what the rules see is what is drawn; the plinth fudge goes. Outside, coarser pages by screen-space error.
- **Terrain edits:** a per-node edit texture from game state — building pads (flatten), road cuts/fills, excavation
  pits, quarry. Terrain, roads and models all read the edited height.
- **Water:** water polygons rasterised into the drape as a mask; terrain under water is lowered; the water surface is
  its own mesh at water level; shore effects come from the depth difference against terrain, not from per-vertex
  shore distances.
- **Forest:** trees are scattered from the landcover mask *minus* a game clearing mask (roads, lots, fields, water)
  rasterised on the GPU — replaces CPU blocker tests in `treeScatter`. Far forest is drape colour + a canopy
  normal/height term on the terrain, not geometry.
- **Light and weather:** one shading model for every surface: sun/moon, sky ambient, cloud shadow lookup at the real
  world position, night, snow/wetness as material parameters. The night-tint and weather fill layers disappear;
  roofs get snow.

Far world:

- Terrain nodes far away use low-res pages and a **baked albedo** (landcover/water/forest colour rasterised once per
  node from OMT ≤ z12) — no per-feature geometry beyond a radius.
- Atmosphere / aerial perspective LUTs (Hillaire-style) hide the far detail and give the horizon.
- Globe view: a few dozen nodes + global low-res textures. Far content can update at a lower rate.

## 5. Milestones

The new engine is built **next to** the current map, behind `?engine=next`, on its own canvas. MapLibre stays the
default until N8. Each milestone ends with tests green, a benchmark run and a short "done" note in this file.

**N0. Benchmarks and spike (go / no-go).**
- Benchmark harness on the current game: three scripted scenes — forest fly-over at 75° pitch, town at 75° pitch,
  far globe — recording frame time (median / p95), GPU time where available, JS heap.
- Spike: WebGPU device, reversed-Z, globe quadtree terrain from terrarium tiles, orbit + ground camera, chunk table
  precision test (no visible jitter at street level at lng ±179°, lat 60°).
- Exit: spike terrain at least as fast as MapLibre relief on the same scenes; precision test passes.

Done (2026-11-01). Decision: **go**.

- Scenes: `src/bench/scenes.ts` (engine-neutral camera: target, distance, heading, pitch; MapLibre gets it via
  `toMapLibre`). MapLibre runner `src/bench/maplibreBench.ts` (`/?bench=all|<scene>&variant=full|base`, or
  `runBench()` in devtools; wraps the private `map._render` for timing). Spike runner `/next.html?bench=all`.
  Keep the Browser pane in front while measuring — background tabs throttle rAF.
- Spike: `next.html` + `src/engine/` (gpu, geo, camera, frame/chunk table, terrain quadtree, DEM worker + page pool,
  sky/atmosphere, debug cube). Entry is a separate page instead of `?engine=next`; it becomes the switch in N2.
- Results, AMD RDNA4, 1280×720 buffer, ms median / p95 (spike GPU via timestamp queries, 65 µs quantum; MapLibre GPU
  via `EXT_disjoint_timer_query_webgl2`; "base" = MapLibre without our layers: base style, hillshade, 3D relief):

  | scene | MapLibre base GPU | MapLibre base CPU | MapLibre full CPU | spike GPU | spike CPU |
  |---|---|---|---|---|---|
  | globe | 1.26 / 3.66 | 2.0 / 2.6 | 3.1 / 4.0 | 0.07 / 0.13 | 0.2 / 0.4 |
  | mountains 75° | 1.96 / 4.17 | 3.1 / 4.0 | 6.0 / 9.0 | 0.33 / 0.46 | 1.5 / 2.3 |
  | forest 75° | 1.36 / 2.94 | 2.3 / 3.1 | 6.0 / 8.7 | 0.20 / 0.26 | 0.8 / 1.3 |

  Not like for like: the spike draws terrain + sky only (no landcover, water, labels). It leaves a wide margin for
  them. On this GPU MapLibre is CPU-bound, not GPU-bound.
- Precision (`frame/chunkTable.test.ts`, the shader's exact f32 order): points 1–100 m from the eye at lat 60 lng 179.99
  and at 0,0 — worst 0.01–0.07 mm for an eye 2–300 m up, 0.46 mm at 4 km. Visual: 1 m checker cube 5–20 m from the
  eye, orbiting — no jitter; no seam at the antimeridian.
- How the spike does it (carry into N2): quadtree over web-mercator z0..z17, pages to z11 (z12+ reuse the z11 page
  with a uv sub-rectangle); one instanced `drawIndexed` with vertex pulling, 33×33 grid; vertices built on the CPU in
  f64 relative to the node's tile-centre origin, stored f32 in a 1024-slot slab (lat/lng→ECEF in f32 in the shader is
  ~0.5 m off, so it is not done there); chunk table 48 B/node; refine while a cell > 8 px, merge below 0.75× (hysteresis);
  frustum + horizon tests with per-page 16×16 min/max blocks; DEM pages r32float 258×258 in a texture array with a
  1-texel border patched from resident neighbours; WGSL `pageHeight` mirrors `bake/terrarium.ts samplePage`;
  near plane max(0.1 m, 2 % of eye height above ground).

Carry-over for N2:
- Node origin at the node's mid-height, not at h = 0 (error grows with eye height today).
- Rules and visuals still disagree by half a DEM pixel: `src/world/terrain.ts` clamps inside the half-pixel band along
  z11 tile edges, `src/map/relief.ts groundAt` uses a corner convention. Switch `terrain.ts` to the spike's cross-tile
  sampling so all three agree.
- `terrain.update` is ~1–1.5 ms in the mountain orbit: cache per-node trig, make selection incremental, build node
  vertices in the worker.
- CDLOD morphing (LOD pops today; skirts hide cracks), MSAA, inertia/touch/fly in the controller, retry for failed
  tiles, polar caps (nothing above 85.05° — the sky pass shows sea there).
- Land/sea colour is `height ≤ 0` until the water mask (N3); Terrarium coasts are blocky.

**N1. The `view` seam (in the current app, still on MapLibre).**
- `src/view/`: camera (target/distance/heading/pitch, `flyTo`), `project`/`unproject`/`pickGround`,
  `metersPerPixel`, marker registry, overlay registry (game GeoJSON-like overlays by id), pointer events in world
  coordinates, layer visibility, attribution.
- MapLibre implements it. Tools, UI and `main.ts` stop importing `maplibre-gl`; all zoom thresholds become
  mpp/distance thresholds.
- Exit: `grep maplibre` only matches `src/view/maplibre/` and the old layer files; game behaviour unchanged.
- Worth doing even if the engine stops later: it decouples the game from the map library.

Done (2026-11-01).

- `src/view/view.ts` is the seam: camera as target/distance/heading/pitch, goals by `distance` or `mpp`,
  `metersPerPixel`, `project`, `isWaterAt`, pointer/camera events, markers, `setPanEnabled` /
  `setDoubleClickZoomEnabled` (drawing tools own the drag), and overlays by id (`road-preview`, `road-hover`,
  `road-snap`, `place-lot`, `place-radius`, `reveal-disc`, `follow-target`). The game owns overlay data; the backend
  owns how they look.
- MapLibre backend: `src/view/maplibre/` — `view.ts`, `overlays.ts` (layer specs moved out of the tools and
  FollowCamera; added on first data, re-added on `styledata`), `mount.ts` (map construction, all renderer `attach*`
  wiring, DEV handles and the bench hook), `zoom.ts` (zoom ↔ distance ↔ mpp; the bench re-exports it).
- UI, `main.ts` and the five tool files no longer import `maplibre-gl`. Renderer files in `src/map/` still do, as
  planned; visual `minzoom`/line-width stops inside them stay until they are replaced.
- Game thresholds are metres per CSS pixel, `mppAtZoom(z)` at a reference latitude of 55° (`src/view/scale.ts`, tool
  gates in `src/map/tools.ts`, PlaceSearch, TerrainInspector, `articleMapModel`). Behaviour change: the zoom at which
  a tool opens now varies slightly with latitude (at 59° the zone gate opens at ~z14.83 instead of z15); brush and
  snap sizes use the scale at the camera target instead of the cursor's latitude.
- The zone brush is not an overlay: `zoneLayer` draws it from the `hoverKeys` / `paintPreview` signals; it moves with
  the zone layer in N4.

**N2. Engine core.** gpu pools, frame graph, WGSL module system, stream scheduler, baker workers, camera and input
(parity with today's drag/scroll/touch/trackpad, inertia, fly), atmosphere/sky, lighting from the game clock, terrain
CDLOD with exact game-area heights, picking. `view` implemented by the engine: you can found a town and look around.

Done (2026-11-01). `/?engine=next` runs the game on the engine (remembered in localStorage, `?engine=maplibre` goes
back; falls back to MapLibre without WebGPU).

- Core: `src/engine/engine.ts` — frame loop, 4× MSAA, one reversed-Z depth, `Drawable`s, `pick` (march + bisect,
  `camera/pick.ts`), `project`, `onBeforeFrame`/`onFrame`, `light` provider. A generic baker pool, gpu pools and a
  frame graph are not built yet: they arrive with the first content that needs them (N3 vector tiles).
- Camera (`camera/controller.ts`, implements `camera/cameraControl.ts`): grab-pan that keeps the ground point under
  the cursor, wheel/dblclick/pinch zoom about the cursor, rotate/pitch, trackpad (reuses `src/map/trackpadModel.ts` —
  move it into `src/engine/camera/` before N8), touch, keyboard, MapLibre-like inertia, van Wijk–Nuij `flyTo`,
  `fitBounds`. Gaps: no touch zoom/rotate inertia or double-tap; touch pitch heuristic simpler than MapLibre's.
- Terrain: CDLOD geomorphing (vertex target = midpoint on the parent grid, factor from the vertex's own screen-space
  error; split/merge never pop), node origin at mid-height (worst error 0.02 mm 1–100 m from the eye at any eye
  height), allocation-free selection (`terrain.update` 1.3 → 0.3 ms in the mountain orbit), stream scheduler with
  backoff, misses and cancellation (`stream/scheduler.ts`), polar caps (cone to the mean edge height).
- Rules heights: `src/world/terrain.ts` samples across z11 tile edges with the engine's texel convention (3×3 block,
  neighbours loaded only near edges); points > 2.5 px from an edge are unchanged.
- View backend `src/view/engine/`: events from DOM + pick, DOM markers moved every frame, `isWaterAt` = ground ≤ 0
  until the water mask (N3), overlays keep data only (drawn in N4), terrain credits.
- Lighting: the sun of the game clock (`sim/weather.ts sunDirection`, already in ECEF axes) via the mount's `light`
  option; before founding the fixed mid-morning sun; a dim night ambient on the terrain.
- Bench (RDNA4, 1280×720, ms median): GPU globe 0.33, mountains 0.98, forest 0.79 — ~3× N0, most likely the MSAA +
  full-screen sky added after N0 (morphing on/off measures the same); CPU 0.1 / 0.5 / 0.3, 2.5–3× lower than N0.
- Known: an orbit needs ~980 DEM pages against a 512-layer pool and S3 serves ~54 pages/s, so wide orbits keep
  streaming; the night is dark-blue only (no moon direction, stars or lights yet).

**N3. Nature base.** drape baker (landcover, water mask, waterways, shore, forest tint), water surface (port
`waterLayer` shading to WGSL, shore from depth), MSDF text (place labels), markers, attribution.

Done (2026-11-01).

- Drape: `bake/drape.ts` + `bake/drapeWorker.ts` rasterise OpenMapTiles landcover, forest edge, shore band, water and
  rivers with Canvas2D into 256² RGBA pages (alpha = water coverage), in the palette of `src/world/biome.ts` (shared
  with the MapLibre style, so both draw the same atlas). Pages exist to z16; deeper than z12 they redraw a square of
  the z12 tile (sharp edges near the camera, ~2.4 m/texel at 60°), sources cached in the worker. Empty tiles (open
  ocean) report missing, so the ancestor page with the ocean polygon stands in. Pool `terrain/drapePages.ts`
  (rgba8unorm-srgb array, 256 layers = 64 MB, LRU, z0–z2 pinned, CPU water masks for queries). DEM and drape share
  `stream/demStream.ts TileStream`.
- Terrain shading: drape colour × `DRAPE_GAIN` (the flat palette back under sun + sky + tone map), water flattens the
  normal, sun glint and a Schlick sheen; ground aerial perspective thinned (`GROUND_AIR`) to keep the near view crisp.
- `isWaterAt` reads the drape's water mask (sea level only where no page covers the point yet).
- Place names: DOM labels instead of MSDF text (`src/view/engine/placeLabels.ts`, pure layout in `labelLayout.ts`):
  OpenMapTiles `place` from the 5×5 tiles around the target at the zoom a web map would show, projected every frame,
  greedy collision by rank, the old layer's look. The on/off switch moved to `src/view/placeNames.ts` for both
  renderers. A GPU text path waits until there are many labels (N4 zone/ruin names may need it).
- Credits: terrain + OpenFreeMap / OpenMapTiles / OpenStreetMap.
- Not done here, moved to N4/N7: a separate water surface at water level with the old `waterLayer` look (ripples,
  flow, foam, shore from depth) — water is drape-shaded for now; small streams (OpenMapTiles has them from z14 only,
  the drape reads z12). Labels are not occluded by hills.

**N4. Game content.** models + lamps (builders kept, output re-anchored to chunk origins, single vertex set), roads
(3D ribbons near, drape far), zones, building fills, fields, ruins and excavation, tool previews as decals, life
walkers/lights, traffic, badges, terrain edits. All tools work on the new engine.

Done (2026-11-01), except terrain edits, 3D ruin walls, map text of ruins/zones/clearings and fill patterns.

- Data/style split: what the game draws on the map lives in renderer-neutral modules `src/view/layers/` (zones,
  fields, clearings, roads, building footprints, camp, service reach, traffic, ruins, badges, article markers);
  MapLibre layers only style that data, the engine draws the same signals. Picking (buildings, clearings, old
  buildings, walkers) goes through the View; `main.ts` attaches it with the tools.
- Overlay raster (`engine/overlay/`): the 2D map is rasterised on the GPU into three squares of web mercator around
  the camera (1.5, 6 and 24 camera distances, 2048² each, redrawn on data change or a real camera step): fills as
  triangles, lines and circles as antialiased distance fields with dashes, scale gates like the old `minzoom`. The
  terrain samples the finest level covering a fragment through the node's own mercator uv (computed in the fragment
  from the node index — the 16 inter-stage locations ran out). Drawings keep their palette colours over the lit
  ground (a map, as before) and dim only to 45 % at night, so tool previews stay readable; the road preview has a
  paper halo. Engine styles: `src/view/engine/gameLayers.ts`, `overlayStyles.ts`.
- Models (`engine/scene/townMesh.ts` + `.wgsl`): buildings, sites, restored buildings, roads, bridges, aprons from
  the same builders (`src/map/modelItems.ts`, three-free, with the `debug3dModels` demo set), seated on the engine's
  ground, projected in f64 into the town origin's east/north/up frame and cached per item. Facades, road surfaces,
  snow and window lights ported to WGSL; roads drawn first without depth writes and a small depth bias; nights dim to
  the old dusk blue.
- Life (`engine/scene/dots.ts`): walkers and carts as screen-sized discs, evening glows as ground discs, ~20 updates a
  second; a click near a walker follows the resident.
- Sun: the sim's sun stands over Greenwich at noon, but the game clock is the town's time (night/day follow
  `daylight(hour)`); the engine turns it to the town's meridian. The old three.js models still use the Greenwich sun.
- Verified on a test town: founding, road preview/ordering, zone gate, lot/radius previews, reveal disc, models in day
  and night, walkers/glows, both renderers start clean. Frame on the town: ~0.4 ms CPU, ~0.3 ms GPU (RDNA4).
- Left for later: terrain edits (pads, cuts, pits), 3D ruin walls (flat fills now), text of ruins, zones and clearings,
  hatch patterns of zones/fields, smoke and 3D fields (N7 with weather), forest (N5).

**N5. GPU-driven rendering.** instance pools and compute frustum + LOD culling with indirect draws for trees, models,
smoke; tree scatter on the GPU from landcover + clearing masks; impostor atlas reused from `treeImpostor`.

**N6. Occlusion culling.** two-phase Hi-Z (terrain ridges and buildings as occluders), stats overlay for culled counts.

**N7. Sky and weather.** clouds ray-march + composite (port `clouds/`), cloud shadows in the shading model,
precipitation, snow/wet materials on all surfaces, night lights, smoke.

**N8. Switch.** engine default; parity checklist against section 2; delete MapLibre, three.js, the old layers, the
`maplibre` `view` backend, `reliefOrder`, dual-frame model buffers.

**N9 (later).** Sun shadow maps (cascades) for buildings and trees; higher-res visual terrain detail beyond z11 that
does not affect rules.

Rough size: N1 is the smallest; N2–N4 are the bulk; N5–N7 each a solid milestone. Content-only map
features should go through `view` during the rewrite, or wait, so the two renderers do not drift.

## 6. Performance budgets (to fix in N0 with real numbers)

- Main-thread CPU per frame ≤ 2 ms at 4× game speed in a 10k-resident town.
- GPU frame ≤ 8 ms on the reference desktop GPU; ≤ 16 ms on an integrated GPU (Iris Xe-class) at "medium".
- Upload budget ≤ 4 MB/frame; tile bake latency for the view centre ≤ 300 ms after the camera stops.
- Far globe view ≥ 2× cheaper than today's MapLibre relief.

## 7. Testing

- Pure logic in vitest as now: quadtree selection, screen-space error, chunk-table precision, stream priorities,
  label collision, camera controllers, mpp conversions, all existing geometry builders.
- WGSL: compile every module in CI-like `npm test` via a headless WebGPU (Chrome `--enable-unsafe-webgpu` in a
  vitest browser project) — at least creation of all pipelines without validation errors.
- Golden screenshots for the three benchmark scenes (tolerant diff), compared old vs new until N8.

## 8. Risks

- **Size.** This is the largest piece of work in the project and stalls visible game features while it runs. N1 is
  the cut-off point: if the engine is paused, N1 still pays off.
- **WebGPU reach.** Linux Firefox and older devices lose the game.
- **Text.** MapLibre's label placement is good; ours starts simpler (few labels: places, ruins, zones).
- **Tile usage.** OpenFreeMap / AWS terrain fair use: keep caching and request budgets at least as strict as MapLibre's.
- **Poles.** Terrarium tiles are web-mercator, undefined above ~85°; terrain there is a cap from the last row. The
  game can refuse founding above ~80°.
- **Parity drift** while both renderers live: freeze new map layers outside `view` during N2–N8.

## 9. Open questions

1. WebGPU-only acceptable (no Linux Firefox)?
2. Reference hardware for the budgets (which GPU is "medium")?

Resolved: language — TypeScript + WebGPU (3.2).
