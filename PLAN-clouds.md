# Rebirth — volumetric clouds plan

Replaces the shell clouds of `PLAN-weather.md` section 5 (`src/map/cloudLayer.ts`, `cloudTexture.ts`). Decisions
(user, 2026-10-26):

- **Truly volumetric clouds**, rendered with **three.js**. The three.js host is shared, so the planned replacement of
  the building primitives can reuse it later.
- **Look:** physically lit volumes (scattering, self-shadowing, silver lining), with colours graded to the paper
  atlas palette. They must not read as a photo laid over paper.
- **Extras:** cloud shadows on the ground at every zoom, rain and snow shafts under precipitating clouds, lightning
  flashes in storms.
- **Hardware:** 60 fps on a laptop with integrated graphics. Quality presets: medium by default, low on phones.

## 1. Why the current clouds look wrong

- **Flat texture:** six thin shells textured with the same 2D cover plus noise read as a picture on a sphere, not as
  volume. Nothing is shaded through the depth of the cloud.
- **Breaks:** the shells are one Web Mercator mesh pushed through `projectTileFor3D`, which is meant for single
  tiles. That causes several problems:
  - horizon clipping cuts triangles;
  - the antimeridian and pole rows tear;
  - the grid stops at ±85°, so the poles have holes;
  - cover is sampled from an equirectangular texture, which pinches at the poles.

The new design has no planet-wide mesh. Every pixel casts its own ray against analytic spheres, and the weather is
sampled from a cube map. Neither has a seam or a pole.

## 2. Coordinate frame

- **MapLibre frame:** in globe mode, `defaultProjectionData.mainMatrix` projects a unit-sphere planet to clip space,
  per its typings. MapLibre's shader places a point at `(sin lng·cos lat, sin lat, cos lng·cos lat)`, so y points
  north and z points to (0°E, 0°N).
- **Weather frame:** `weather.ts` `sunDirection` uses x to (0°E, 0°N), y to 90°E, z north. The conversion
  `(X, Y, Z) = (w.y, w.z, w.x)` lives in one pure, tested helper.
- **Rays:** from the inverse of `mainMatrix`, the near and far clip points of each pixel give a ray in planet units
  (radius 1 = 6 371 km).
- **Projection range:** clouds draw only in the globe range (zoom < 6.5). At those zooms `projectionTransition` is 1.
  The shadow layer handles both projections (section 6).

## 3. Architecture (`src/map/clouds/`)

| File | Role |
|---|---|
| `three.ts` | Shared three.js host for future custom layers. It holds one `WebGLRenderer` on MapLibre's own canvas and context, with `autoClear = false` and linear output colour space, so palette hex values match MapLibre. Each draw is bracketed by `resetState()`. It handles context loss and restore. It exposes the per-frame `mainMatrix` and its inverse. |
| `cloudLayer.ts` | The MapLibre custom layer, attached last. `prerender` ray-marches into a low-resolution render target, and only when needed (section 5). `render` composites that target over the map. It also owns the zoom fade, the toggle (`cloudsOn` / `toggleClouds` move here unchanged) and the quality settings. |
| `cloudShaders.ts` | GLSL3 sources: ray-march, lighting, precipitation shafts, lightning, composite. |
| `cloudWorker.ts` | Web Worker that builds the weather cube maps from `cloudField` and `climate`, plus the two noise volumes once per session. Nothing heavy runs on the main thread. |
| `weatherCube.ts` | Pure functions: cube texel ↔ direction ↔ lng/lat, channel packing, cloud-type derivation. |
| `noise3d.ts` | Pure functions: tileable 3D Perlin-Worley and Worley fbm. |
| `cloudShadows.ts` | A second custom layer, just under the night tint: ground shadows and overcast dimming at every zoom. |
| `cloudQuality.ts` | Presets, the stored choice and the device default. |

**Loading:** three.js (pinned `0.186.x`) is imported only by this folder, through a dynamic `import()`. It loads the
first time clouds or shadows are needed, so the main chunk does not grow; the clouds chunk adds about 150 KB gzip.

**Old code:** `src/map/cloudLayer.ts`, `cloudTexture.ts` and its test are removed. `LayerBar.tsx` and `main.ts`
switch their imports.

## 4. Data

**Weather cube** (A/B pair, as now): rebuilt every 30 game minutes and cross-faded in the shader. Six RGBA8 faces in
GL order (+X −X +Y −Y +Z −Z), in the MapLibre frame. Face size is 128 on low and 192 on medium and high.

| Channel | Meaning |
|---|---|
| R | Cover, 0..1, from `cloudField`. |
| G | Type, 0 = stratiform sheet, 1 = convective tower. It rises from `smoothstep(8, 22, sea-level climate mean)`, is raised by precipitation and lowered toward the poles. |
| B | Precipitation, as a share of `TUNING.precipMax`. |
| A | Sea-level climate temperature, `(T + 40) / 80`, used for the snow and rain tint. |

Uploaded as a three `CubeTexture` with `DataTexture` faces. Seamless cube filtering is always on in WebGL2.

**Noise volumes:** generated once in the worker, about 0.3 s.
- Base: 64³ RGBA8. R is Perlin-Worley; G, B and A are Worley fbm at three frequencies.
- Detail: 32³ RGBA8 Worley.
- Both are tileable, use `RepeatWrapping`, and are uploaded as `Data3DTexture`.

**Motion:**
- Fronts move through the cube cross-fade, which is the same field the simulation uses.
- Noise detail drifts with the zonal wind of `weather.ts` (`TUNING.windDeg`, `tradeDeg`, passed as uniforms). It is
  rotated about the polar axis in two phases that cross-fade every `layerDays`, the same trick as `field()`, so the
  shear never grows.

**Worker protocol:**
- Cube request: `{t: "cube", t0, seed, phase, size}` → `{t: "cube", t0, faces: ArrayBuffer[6]}`, transferred.
- Noise request: `{t: "noise"}` → `{t: "noise", base, detail}`.

## 5. Ray-march

**Cloud layer:**
- Spherical shell between cloud base and top.
- Real altitudes are 1–12 km, exaggerated ×4 (4–48 km) so the volume reads from orbit.
- Per-type height profile: sheets thin and low; towers tall with an anvil when type and precipitation are high.

**Density at a point:**
1. Cover from the cube, remapped by the base noise.
2. Times the height profile for the point's altitude in the shell.
3. Eroded at the edges by the detail noise; skipped on low quality.

**Steps:**
- The march is clipped to the shell intersection and stops where the ray hits the planet (radius 1).
- In empty air it takes coarse steps that read only the cube and the profile, then fine steps once inside a cloud.
- It exits early once transmittance falls below 0.02.
- Each pixel's start is jittered with interleaved gradient noise, so no asset is needed.

**Lighting:**
- Beer–Lambert extinction with the powder term.
- Two-lobe Henyey–Greenstein phase (g = 0.6 forward, −0.3 back) gives the silver lining.
- A short light march toward `sunDirection` gives self-shadowing.
- The planet's shadow is a ray–sphere test along the light ray; the terminator gets a soft warm band.
- Ambient light runs from a sky term at the top to a ground term at the bottom.

**Palette** (from `ui/palette.ts`):

| Part | Colour |
|---|---|
| Lit side | `paperRaised` |
| Self-shadow | ink-blue (`info` mixed toward `ink`, desaturated) |
| Night side | `dusk` |
| Terminator glow | `warn`, low intensity |
| Rain clouds | greyer (`pencil`) |
| Snow clouds and snow shafts | `mapIce`, cool tint |

**Precipitation shafts:** below the cloud base, where precipitation is above 0, a low-density, vertically stretched
noise column reaches the ground. It is grey for rain and white for snow. It is visible at the limb and in tilted
views.

**Lightning:**
- Storm texels (high type and high precipitation) get flashes from a hash of the cell and real time, not game time,
  so the flicker does not speed up at 4×.
- A flash adds emission around a random point in the cell, inside the cloud.
- It is strong on the night side and faint by day.

**Caching:** the march re-runs only on one of these triggers:
- the view matrix changed;
- the game clock moved more than 5 game minutes;
- a weather cube finished uploading;
- a lightning flash is active, then at most 30 fps.

Otherwise the last render target is only composited. While the camera is still, the cost is just the composite.

**Composite:** a full-screen triangle with a bilinear upsample and premultiplied alpha, which is MapLibre's custom
layer blend. The zoom fade (fully on below 5, off at 6.5) multiplies the alpha. Below the minimum opacity nothing
runs: no march, no cube requests.

**Presets:**

| Preset | Target scale | March steps (max) | Light steps | Detail noise | Cube face |
|---|---|---|---|---|---|
| low | 0.35 | 24 | 3 | off | 128 |
| medium | 0.5 | 48 | 5 | on | 192 |
| high | 0.75 | 80 | 6 | on | 192 |

Render target format: RGBA16F when `EXT_color_buffer_float` is available, else RGBA8.

## 6. Ground shadows (`cloudShadows.ts`)

- **Placement:** a custom layer right under the night tint, so it darkens terrain, roads and roofs, but not the
  lights or walkers.
- **Ground point** of each pixel:
  - globe: a ray against the unit sphere;
  - mercator (high zoom): the ray against the z = 0 plane of the current `mainMatrix`, converted to lng/lat.
- **Shadow lookup:** move the ground point toward the sun by `realAltitude / tan(sun elevation)`, then sample the
  cube cover and a 2D slice of the noise at kilometre scale. At town zoom, cumulus casts drifting patches about 1 km
  across, while a sheet dims the whole view evenly.
- **Strength:** multiply by a `dusk` tint at up to 0.25. Shadows fade out with sun elevation and are off at night.
- **Sync:** the cover over the town is the same `cloudField` the simulation reads, so «пасмурно» in the top bar and
  the dim map always agree.
- **Cost:** one cube sample and one or two noise samples per pixel; budget 0.4 ms at 1080p. The layer follows the
  same «Облака» toggle.

## 7. UI

- **Layer bar:** «Облака» stays as one toggle for clouds, shadows, shafts and lightning.
- **Settings:** a new row «Качество облаков: низкое / среднее / высокое», stored in localStorage
  `rebirth.cloudQuality`.
  - Default: low on phones (`pointer: coarse` and width ≤ 640), medium elsewhere.
  - Without WebGL2 or the float extension, high is not offered.

## 8. Budgets and checks

- **GPU budget, integrated GPU at 1080p:**
  - a medium re-march at most 4 ms;
  - composite at most 0.3 ms;
  - shadows at most 0.4 ms;
  - a still camera costs only the composite and the shadows.
- **Timing:** measured with `EXT_disjoint_timer_query_webgl2` in development builds and logged once per second
  while clouds draw.
- **Main thread:** no cloud work beyond texture uploads. The first cube and the noise volumes arrive asynchronously,
  and clouds fade in when they do.
- **Bundle:** the main chunk does not grow (the build output is checked).

## 9. Steps

0. **Spike** (go / no-go), small. Three.js shares MapLibre's context on the globe.
   - (a) Dots placed at known lng/lat through the unit-sphere frame line up with the coastlines while rotating and
     tilting.
   - (b) A render target filled in `prerender` and composited in `render` leaves MapLibre intact (labels, hillshade,
     fills, panning) with no GL errors.
   - (c) The ground point is recovered in mercator mode at zoom 15.
   - If (a) or (b) fails, the clouds use raw WebGL with the same shaders, and three.js waits for the buildings.
1. **In parallel after the spike, with the data contract of section 4 fixed:**
   - A: worker, `weatherCube.ts`, `noise3d.ts` and their tests.
   - B: ray-march layer, shaders, presets and the settings row. It starts on a synthetic cube until A lands.
   - C: ground shadows.
2. **Integration:**
   - remove the old layer;
   - tune the look in the preview;
   - measure budgets;
   - update `PLAN-weather.md` section 5 and the credits if needed.

**Pure-function tests:**
- cube texel ↔ direction ↔ lng/lat round trip, and continuity across face edges;
- the frame conversion and the sun direction;
- channel packing and type derivation;
- noise tiling (the value at 0 equals the value at N);
- the re-march decision;
- the lightning schedule is deterministic;
- the preset defaults.

**Visual checks in the preview, with screenshots:**
- the whole globe;
- the limb at pitch 60;
- the terminator;
- the antimeridian (lng 180) and both poles, with no seams;
- the fade at 5–6.5;
- storms at night;
- shadows at zoom 15 agreeing with the weather chip;
- each preset;
- the toggle;
- a clean console.

## 10. Risks

- **Shared GL state:** three.js and MapLibre each cache GL state. The `resetState()` discipline and drawing into
  our own target only in `prerender` keep them apart; the spike proves it.
- **Fill rate on weak GPUs:** mitigated by the low preset, the caching and the early exits. If medium misses 4 ms,
  the march goes to quarter resolution with a 4-tap upsample before any further look tuning.
- **Planet-scale noise:** the noise tiles are about 300 km (base) and 40 km (detail), so tiling could show from
  orbit. Rotating the second sample domain and the cover modulation should hide it; to be checked in the screenshots.

## 11. Implementation notes (as built)

- **Host and loading:**
  - three 0.186.1, with @types/three 0.186.0 (no 0.186.1 types exist).
  - `attach.ts` loads `cloudLayer` lazily and the shadows as an extra layer under `night-tint`.
  - three ships in a shared lazy chunk, so the main chunk did not grow.
- **Contracts measured by the spike:**
  - Globe `mainMatrix` maps the unit sphere to clip space.
  - Mercator `mainMatrix` maps mercator 0..1, with z in mercator units, to clip space.
  - Custom layers switch hard from one to the other at zoom 12. There is no blended zone.
  - Shadows use a double-precision ray basis on the globe and `mercatorLocalMatrix` from zoom 12.
- **Deviations from sections 4–6:**
  - `CLOUD_BASE_M` is 2000, which leaves room for the precipitation shafts.
  - Noise tiles are about 1270 km (base) and 160 km (detail), because the finer ones were sub-pixel from orbit.
  - The wind drift of the volume noise is scaled by 0.08; the shadows use a single drift rate.
  - The lightning schedule runs on the CPU (`lightning.ts`) and sends up to 6 active flashes to the shader.
  - From orbit (zoom < 2.6, blended out by 3.4) the density uses the Nubis remap of cover.
  - The composite is a 5-tap bilinear.
  - Night clouds are a muted grey near the paper value, because the map itself has no per-region night shading.
- **Weather model fixes found on the way:**
  - The trades-to-westerlies shear striped the cover at 24–36°. Fixed with `layerDays` 6, 3 layers and a broad `zonal` profile.
  - Subtropical highs were too cloudy. Fixed with a stronger wetness bias and a polar cloud floor, plus a retune of `precipMax` and `snowPerMm`.
- **Measured** on a dev GPU at 1084 × 694 (march GPU time):

  | Preset | March GPU |
  |---|---|
  | low | 0.10 ms |
  | medium | 0.23 ms |
  | high | 0.44 ms |

  The composite takes 0.013 ms and the shadows about 0.02 ms. Nothing has been measured on an integrated GPU yet.
