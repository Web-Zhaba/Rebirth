# Rebirth — object shadows plan

Adds sun shadows cast and received by scene objects (terrain, buildings, forest, fields) to the WebGPU engine
(`src/engine/`). Decisions (2026-11-03):

- **One local shadow map around the camera**, not a full-scene cascade: the scene spans from a town to the whole
  globe, and object shadows are only readable at town scale (up to ~2–4 km from the camera). Beyond that the
  existing cloud shading (`cloudShade`, `src/engine/sky/weather.wgsl`) already darkens the ground.
- **Look:** soft PCF shadows that multiply only the direct sun term, never the ambient/sky term, so shadows stay
  coloured and never go black. Palette stays the paper atlas one; shadowed areas read as ink-blue, like the cloud
  self-shadow in `PLAN-clouds.md`.
- **Hardware:** 60 fps on a laptop with integrated graphics. The shadow pass re-renders only when the sun, the
  terrain chunks or the town change — a still camera costs nothing.

## 1. What exists today

- **Lighting:** one directional sun in `frame.sun` (`src/engine/frame/frameUniforms.ts`), Lambert
  `max(dot(n, sun), 0)` per shader (`terrain.wgsl`, `townMesh.wgsl`, `forest.wgsl`, `fields.wgsl`), night is a
  `NIGHT` multiplier. No object casts or receives a shadow.
- **Cloud shadows:** `cloudShade(rel, up, foot)` in `weather.wgsl` — kilometre-scale patches, not object shadows.
- **Render pipeline:** one pass with MSAA×4, reversed-Z `depth32float`; occluders (terrain + townMesh) → Hi-Z →
  the rest. All positions are camera-relative ECEF.
- **Objects:** terrain (instanced quadtree), townMesh (buildings/roads/ruins/figures, `occluder = true`), forest
  (meshes + impostors from the compute scatter, up to 80k trees), fields, dots, smoke, precip, sky, clouds.

## 2. Architecture

| File | Role |
|---|---|
| `src/engine/shadow/shadowMap.ts` | Owns the depth texture, the sun orthographic camera (texel-snapped), the render version counter and the `castsShadow` pass. |
| `src/engine/shadow/shadow.wgsl` | Shared WGSL chunk registered like `atmosphere`/`weather`: `fn sunShadow(rel: vec3f) -> f32`, PCF 3×3 over a comparison sampler. |
| `src/engine/frame/frameUniforms.ts` | Gains `shadowProj` (sun view-proj × world), texel size, fade range and the shadow map version. |
| `src/engine/engine.ts` | Runs the shadow pass between the occluders and Hi-Z when the version says it is stale. |

Each drawable gets `castsShadow?: boolean` and `drawShadow(pass)`. Casters: terrain (near nodes), townMesh
(buildings and ruins, not the flat roads), forest (near meshes; impostors cast a quad with the tree-atlas alpha
test). Receivers: terrain, townMesh, forest, fields. No shadows for dots, smoke, precip, sky, clouds, overlay —
they are transparent, camera-facing cards or sky, where a shadow is unreadable or meaningless.

## 3. The shadow map

- **Texture:** one `depth32float`, 2048², no MSAA.
- **Projection:** orthographic along `frame.sun`, centred on the camera target, snapped to world-space texels so
  the map does not shimmer while the camera moves.
- **Radius:** ~300–500 m — covers the town and the near forest. One cascade; shadows dissolve with
  `smoothstep` over `eyeAboveGround` as the camera rises, handing over to the cloud shading.
- **Sampling:** `sampler_comparison` with `depthCompare: "less"` (reversed-Z), PCF 3×3 (9 taps). The result
  multiplies only the direct-sun term in each receiver shader.
- **Self-shadowing:** depth bias plus a normal offset, scaled by slope, so the terrain does not stripe.

## 4. Optimisations

1. **One cascade + fade by camera height** — no CSM complexity; shadows exist only where they are visible.
2. **Versioned re-render, not every frame:** static geometry (buildings, terrain) is baked into the map and
   re-rendered only when the sun moves (game clock), terrain chunks stream in, or the town is rebuilt. The version
   counter works like `hiz.version`. Dynamic casters (walker figures, tree sway) either use a cheap separate layer
   or do not cast at all.
3. **Frustum- and Hi-Z-culled casters:** the forest already has the occlusion-filtered scatter — the shadow pass
   draws the same filtered near-LOD instance set, with no new scatter.
4. **Half-resolution option:** a quality preset drops the map to 1024² with a wider PCF kernel.

## 5. Steps

0. **Spike** (go / no-go), small: render the town mesh alone into a depth texture from the sun and reproject it in
   the terrain shader. If the reprojection is off or the depth precision stripes, fix the frame maths before any
   integration.
1. `shadow.wgsl` + frame uniforms + comparison sampler; terrain receives.
2. Shadow pass for townMesh; buildings cast on the ground and on each other.
3. Forest: meshes receive, then near meshes cast; impostors receive only.
4. Fields receive; version caching, camera-height fade, the quality preset row in settings.
5. Budgets and bias polish; screenshots at several sun elevations and camera heights.

**Pure-function tests:**
- sun orthographic matrix: a known world point lands at the expected texel, and texel snapping is stable under
  small camera moves;
- the version counter invalidates on sun/terrain/town changes and on nothing else;
- the fade curve over `eyeAboveGround`.

**Visual checks in the preview, with screenshots:**
- a town at low, noon and high sun;
- the fade while zooming out (no pop);
- forest edge shadows on the ground and on the crowns;
- slopes without acne stripes;
- a still camera costs no shadow pass;
- each quality preset;
- a clean console.

## 6. Budgets and risks

- **GPU budget, integrated GPU at 1080p:** the shadow pass at most 1 ms when it runs, and zero when the camera is
  still and nothing changed. Sampling adds at most 0.3 ms across the receivers.
- **Acne / stripes on terrain:** treated with the normal offset and slope-scaled bias; verified on steep slopes in
  the screenshots.
- **Shimmer while moving:** texel snapping; verified by dragging the camera slowly.
- **f32 precision:** all shadow maths stay in camera-relative coordinates, like the rest of the engine.

## 7. Status (2026-11-03): done

Steps 0–5 are in. Where the build departs from the text above:

- **Pass order:** the shadow pass runs first in the frame, before the occluders, so every receiver (terrain and town
  in the occluders pass included) samples this frame's map. The forest casts the instances its scatter made the
  frame before, moved to this frame's eye (`forest.shift`); its `shadowVersion` bumps one frame after they change.
- **Radius:** 200 / 400 / 800 m by the eye's distance to the target (a tilted view sees ground well past its
  height), in steps so the texel grid holds while zooming; the shadows fade out over the map's last 20 %.
- **Depth:** plain (0 nearest the sun), not reversed — the projection is linear. All bias is on the receiver
  (normal offset scaled by the sun's grazing angle, plus a push towards the sun), in metres of texel.
- **Casters culled on the CPU:** terrain draws only the nodes whose bounding sphere reaches the map's box, in runs of
  instances (`firstInstance`). Buildings and ruins cast; roads and figures only receive; impostors only receive.
- **Re-render key** (`ShadowCache`): the stepped sun (0.002 rad), the snapped frame, the eye and view direction (the
  casters are culled for the camera) and the casters' versions. A paused game with a still camera: no shadow pass.
- **Sun easing:** the game clock arrives in snapshot steps, so `view/engine/mount.ts` eases the sun's clock after it
  (τ 400 ms); without it the shadows jumped once a second.
- **Settings:** «Тени» — off / low (1024²) / high (2048²), low by default on phones.
- **Measured** on the dev machine's GPU at the town view: sampling +0.07 ms, a shadow pass +0.07 ms (the GPU timer
  now spans the shadow pass). Not yet measured on an integrated GPU.
