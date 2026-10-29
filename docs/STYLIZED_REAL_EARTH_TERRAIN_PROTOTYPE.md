# Prototype: Stylized Real-Earth Terrain and Biomes

## Purpose

Build a **small but production-shaped prototype** of a new Rebirth world renderer that makes the close-range map read as a coherent game world instead of a GIS map, while preserving real-world geography.

The prototype must:

- preserve real terrain shape from the existing Terrarium DEM;
- preserve real water, forest, wetland, sand, rock, ice and other available natural land-cover data;
- add a **global climate-biome layer** so the fallback ground is not always meadow;
- render a coherent stylized / low-poly terrain surface;
- eliminate visually empty or rectangular-looking areas where modern cities, lawns, parks, roads or agricultural polygons have been intentionally removed from the rewilded world;
- keep player buildings, roads, fields, clearings, water and other terrain-seated objects aligned with the same terrain surface;
- be deterministic: the same coordinates must always produce the same appearance;
- remain responsive when entering custom terrain mode around zoom 12.5;
- be tested by the implementing agent without requiring manual guidance from the user.

This document is an implementation brief, not a visual mood board. The implementing agent is expected to inspect the repository, adapt exact file placement to the current code, implement the prototype, run automated checks, launch the game, inspect representative locations, and fix obvious visual or integration defects before considering the task complete.

---

## Important semantic rule: this is game-world reconstruction, not historical truth

Rebirth starts after modern civilization is gone. Modern roads, buildings and urban land-use polygons are intentionally hidden, but their data may still be used by archaeology and other historical systems.

When modern human-made surface information is absent from the visible world, the renderer must fill that area with a **deterministic naturalized game surface** derived from:

1. climate biome;
2. real terrain/elevation/slope;
3. available surrounding natural land cover;
4. deterministic procedural variation.

Do **not** describe or implement this as a scientifically reconstructed historical landscape. We do not have enough data to know exactly what stood under every modern city or farm before settlement. It is a plausible game-world naturalization whose purpose is to remove cartographic holes while keeping the large-scale geography authentic.

The original modern-world data must not be destroyed or rewritten merely to make the terrain look natural. Archaeology/history systems may still need it.

---

## Existing architecture that must be preserved

Before changing code, inspect the current implementations on this branch, especially:

- `src/map/landscape.ts`
- `src/map/landscapeLayer.ts`
- `src/map/terrainSurface.ts`
- `src/map/relief.ts`
- `src/map/waterLayer.ts` if present
- `src/map/buildingLayer.ts`
- `src/map/fieldLayer.ts`
- road / clearing / zone terrain integration
- `src/world/landcover.ts`
- `src/world/nature.ts`
- `src/world/tiles.ts`
- `src/map/style.ts`
- `src/ui/palette.ts`
- terrain diagnostic switches and the existing zoom-12.5 freeze investigation

Current useful properties that should be evolved rather than replaced:

- custom Three.js DEM terrain already exists;
- terrain comes from Terrarium;
- natural vector data already comes from OpenFreeMap / OpenMapTiles;
- modern built-up detail is intentionally omitted from the rewilded map;
- `terrainSurfaceAt()` is the shared terrain query for terrain-seated game objects;
- terrain generation already yields to the browser in batches;
- the terrain has fine and outer patches;
- water is rendered separately and the terrain below water is treated as seabed;
- slope, rock and high-elevation styling already exist in some form.

Do not rewrite the renderer from scratch unless a concrete blocker is found and documented.

---

# Core design

## 1. Separate three concepts

The prototype must explicitly distinguish:

### A. Physical source data

Examples:

- DEM elevation;
- OSM/OpenFreeMap water polygons;
- natural land-cover polygons;
- climate classification.

These answer **what is known about the real location**.

### B. Game-world surface classification

Create a stable internal classification representing how Rebirth interprets the location.

Recommended broad biome set:

- `tropical_rainforest`
- `tropical_seasonal`
- `savanna`
- `hot_desert`
- `cold_desert`
- `steppe`
- `temperate_grassland`
- `temperate_forest`
- `boreal_forest`
- `tundra`
- `alpine`
- `ice`

This list may be adjusted slightly if the current architecture makes another grouping substantially cleaner, but avoid dozens of visual biomes in this prototype.

Local surface modifiers remain separate, for example:

- water;
- forest/wood;
- wetland;
- sand/beach;
- rock/scree;
- ice/glacier.

This distinction is important. `grass` in Estonia, Kenya and northern Scandinavia must not render identically.

### C. Render style

The visual layer decides:

- terrain base colours;
- colour variation;
- low-poly face shading;
- vegetation family;
- vegetation density;
- dryness;
- exposed rock;
- snow/ice treatment;
- transition appearance.

Do not spread climate-specific colour decisions throughout unrelated renderer files. Prefer one biome/profile module that can be queried by terrain and vegetation systems.

---

## 2. Global climate biome source

The current custom terrain falls back to meadow when no retained natural polygon covers a point. This is one reason former cities and other removed human land-use areas can become generic green ground.

Add a real global climate classification source.

### Prototype source

Use the historical **Köppen-Geiger 1991-2020** classification from Beck et al. (2023):

- paper/data description: https://www.nature.com/articles/s41597-023-02549-6
- data are published at multiple resolutions, including ~1 km and ~11 km.

For this prototype, prefer the **0.1° (~11 km) historical 1991-2020 product**, preprocessed into a compact static asset suitable for direct browser lookup.

Why 0.1° for the prototype:

- climate zones change at much larger scales than local OSM land cover;
- a global 0.1° lookup is compact enough for the browser;
- fine local structure still comes from OSM/OpenFreeMap and the DEM;
- it avoids introducing remote climate API calls during rendering.

### Requirements

- No per-frame or per-vertex network request for climate.
- Load the compact climate asset once and cache it.
- Lookup by longitude/latitude must be O(1) or effectively O(1).
- The renderer must have a deterministic fallback if the climate asset fails to load.
- Keep data-loading code separate from biome interpretation.
- Record the upstream source and preprocessing steps in the repository.
- Update `CREDITS.md` and the in-game About attribution if the final implementation ships the dataset.

A generated asset is acceptable, but include a reproducible conversion script or clear generation instructions. Do not commit the full upstream GeoTIFF archive.

### Suggested broad mapping

The exact mapping may be tuned visually, but the implementing agent should start from a simple deterministic mapping such as:

- `Af`, `Am` -> tropical rainforest / tropical wet;
- `Aw`, `As` -> savanna / tropical seasonal;
- `BWh` -> hot desert;
- `BWk` -> cold desert;
- `BSh`, `BSk` -> dry steppe;
- `C*` -> temperate base biome;
- `D*` -> continental/boreal base biome;
- `ET` -> tundra;
- `EF` -> permanent ice.

Then combine the climate base with actual local natural land cover:

- real `wood` in a C climate -> temperate forest;
- real `wood` in a D climate -> boreal forest;
- real grass/open cover in Aw/As -> savanna;
- missing/removed human land use in BWh -> desert rather than meadow;
- missing/removed human land use in ET -> tundra rather than meadow.

Do not use latitude alone as the primary biome model. Latitude/elevation may be fallback or modifier only.

---

## 3. Local land cover remains authoritative where it is meaningful

Existing OpenFreeMap/OpenMapTiles natural geometry remains valuable and should continue to define local details such as:

- water;
- forest;
- wetland;
- sand;
- exposed rock;
- ice;
- wild grass/scrub/heath/fell/tundra where available.

Climate biome is the **base ecological context**, not a replacement for local land cover.

Priority should be conceptually:

```text
water / ice / explicit natural cover
        ↓
local OSM/OpenFreeMap natural class
        ↓
climate biome
        ↓
deterministic procedural surface variation
```

Modern built-up areas, lawns, gardens, sports grounds, roads and similar modern geometry should remain excluded from the visible rewilded surface.

Modern farmland should not automatically appear as a modern agricultural field before the player creates agriculture. Where the visible rewilded renderer intentionally ignores modern farmland, use the climate-biome naturalization instead of a hard-coded meadow.

Player-created fields remain real game objects and must continue to render through the existing field system.

---

# Terrain appearance

## 4. Preserve real relief, stylize the surface

The new terrain must still be based on the real Terrarium DEM.

The desired visual result is **simplified, readable and faceted**, not a different fictional heightmap.

Target qualities:

- clearly readable hills and valleys;
- visible triangular/faceted low-poly character at gameplay zoom;
- no noisy photorealistic micro-detail;
- no large flat square patches caused by missing classification data;
- consistent visual language across terrain, vegetation, water and player city.

The current custom terrain already uses a grid mesh and per-face-like shader shading. Evolve this instead of replacing it with a texture-only effect.

### Critical invariant: one rendered surface

Do **not** introduce a terrain transform that only the landscape mesh knows about.

If visual height is stylized/exaggerated, all terrain-seated objects must query the exact same effective surface.

In other words:

```text
DEM
  ↓
shared terrain height / stylization
  ├── landscape mesh
  ├── terrainSurfaceAt()
  ├── buildings
  ├── roads
  ├── fields
  ├── clearings
  └── vegetation / other world objects
```

The simulation may retain raw real elevation separately for gameplay calculations, but the renderer must not place the town on one surface while drawing terrain on another.

Existing `reliefScale` behaviour may be retained if it already satisfies this invariant.

---

## 5. Low-poly treatment

Prototype goals:

- use the existing triangulated DEM mesh;
- preserve flat/faceted lighting or make it more legible;
- use a limited cohesive palette rather than photorealistic satellite colours;
- keep subtle deterministic face/ground variation to avoid perfectly uniform polygons;
- avoid visible square tile boundaries;
- avoid random noise that shimmers when moving the camera.

Do not create per-frame random values. Procedural variation must be a function of stable world/local coordinates.

If changing triangle orientation or mesh resolution, ensure adjacent patches remain watertight and `terrainSurfaceAt()` still corresponds to the rendered triangles.

---

## 6. Terrain colouring is biome + landcover + slope + elevation

Replace the idea of one universal meadow fallback with a profile-based colour decision.

A useful model is:

```text
climate biome
    +
local land cover
    +
slope / rock exposure
    +
elevation / alpine modifier
    +
stable low-amplitude world noise
    =
terrain colour
```

Examples:

- hot desert + no explicit cover -> sand/ochre dry ground;
- savanna + open cover -> dry yellow-green grass;
- temperate + meadow -> richer muted green;
- boreal + open ground -> colder desaturated green/brown;
- tundra -> grey-green / ochre / lichen-like ground;
- steep slope -> progressively expose rock;
- high mountain -> alpine rock and eventually ice/snow where appropriate;
- wetland -> retain wetland identity, tinted consistently with the climate profile.

Do not make biome transitions by changing only one global hue. Each profile can control multiple parameters: base ground, dry ground, vegetation colours, rock tint and variation amplitude.

---

# Naturalization of former human areas

## 7. No empty city-shaped or farmland-shaped holes

The rendered rewilded world must not reveal modern urban footprints merely because those features were filtered out.

For terrain classification, absence of an accepted natural polygon must mean:

> "use the ecological base surface here"

not:

> "paint universal meadow here."

This alone should remove many former-city green blocks.

For additional continuity, blend/infer from nearby retained natural cover where useful, but never reconstruct detailed historical vegetation with false certainty.

### Recommended prototype method

For each terrain sample:

1. determine climate biome;
2. check explicit natural land-cover hit;
3. apply explicit natural modifiers if present;
4. otherwise use the biome's natural open-ground profile;
5. optionally mix a small contribution from nearby natural classes;
6. apply deterministic world-space variation.

This method must work inside modern city footprints and modern agricultural areas without needing those human polygons to be rendered.

---

# Transitions

## 8. Remove hard GIS-looking borders

A game world should not show every vegetation polygon as an exact cartographic cut line.

The prototype should soften the visual transition between compatible natural surfaces, especially:

- forest <-> open ground;
- meadow/grass <-> steppe;
- steppe <-> desert;
- tundra <-> boreal;
- wetland <-> open ground;
- sand/shore <-> inland ground.

Do not move or destroy source geometry. Soften only the rendered interpretation.

### Acceptable prototype techniques

One or a combination of:

- sample the classifier at several nearby world-space offsets and blend weights;
- compute a small neighbourhood vote at mesh vertices;
- use stable world-coordinate dither/noise near boundaries;
- use vegetation density falloff to make forest edges gradual.

Constraints:

- no visible tile seams;
- no frame-to-frame shimmer;
- no expensive neighbourhood scan for every fragment;
- transition width should be world-space based, not screen-space based;
- water boundaries remain authoritative enough that shorelines do not become geographically wrong.

---

# Vegetation

## 9. Make forests belong to their biome

If the existing vegetation system already creates real forest geometry, keep real forest boundaries but vary the visual profile by biome.

Minimum prototype differentiation:

- tropical forest;
- temperate forest;
- boreal/taiga forest;
- sparse dry/savanna trees;
- tundra: effectively no normal forest, low scrub/ground treatment instead.

Do not require dozens of tree models. A few low-poly families with palette/scale/density variation are enough for the prototype.

Trees and vegetation must use the same terrain surface query as the rest of the 3D world.

If implementing biome-specific vegetation would make the terrain prototype too large, implement at least:
1. biome-aware ground colour now;
2. a clean `VegetationProfile` interface/data structure;
3. two visibly different forest families (temperate vs boreal);
4. leave tropical/savanna model refinement as a clearly marked follow-up.

---

# Water and shore

## 10. Water must remain geographically authoritative

Do not let climate-biome blending smear land into real water.

Preserve:

- existing real water polygons;
- river handling;
- current custom water rendering;
- seabed handling under water;
- terrain/water depth ordering.

Shore styling may be adjusted to fit the new palette, but geography should not move.

Check coastlines and inland lakes after terrain colour blending is added.

---

# City integration

## 11. The city must look planted into the world, not drawn over it

The implementing agent must test the prototype with an actual settlement, not only an empty terrain view.

Verify at minimum:

- active buildings;
- planned building footprints;
- roads;
- player-created farm fields;
- clearings;
- zones/overlays that are intended to appear in close terrain mode;
- trees/forest around the settlement;
- water near the settlement if the test location provides it.

Acceptance criteria:

- no building floats above terrain;
- no building foundation is obviously buried by the terrain;
- roads do not cut through slopes because they still use a sea-level 2D layer;
- fields follow the terrain and do not z-fight badly;
- clearings are aligned with the surface;
- terrain does not cover player objects unexpectedly;
- object placement stays correct while panning/zooming and when terrain mesh recentres;
- city readability remains good against every tested biome palette.

Do not "fix" alignment by adding arbitrary per-object vertical offsets unless the underlying shared-surface relationship is already correct.

---

# Scope control

## 12. What is in this prototype

Implement:

1. climate-biome source and lookup;
2. internal biome/profile representation;
3. climate-aware fallback surface;
4. biome-aware terrain palette;
5. improved low-poly terrain readability;
6. soft natural transitions;
7. removal of universal-meadow holes in filtered human areas;
8. enough vegetation adaptation to demonstrate that biomes can affect forests;
9. integration with existing city/fields/water;
10. developer diagnostics useful for validating classification and performance;
11. automated tests for pure classification/mapping logic.

## 13. What is explicitly not required

Do not turn this task into a complete Earth ecology simulator.

Not required for the prototype:

- seasonal biome migration;
- dynamically changing climate;
- exact palaeoecological reconstruction;
- exact historical pre-city vegetation;
- worldwide ESA WorldCover 10 m ingestion;
- satellite textures;
- procedural erosion;
- new gameplay rules for biome productivity;
- rewriting archaeology;
- replacing MapLibre;
- replacing the entire Three.js rendering architecture;
- photorealistic tree assets.

ESA WorldCover may be evaluated later if OSM-derived local land cover proves insufficient. It is a global 10 m land-cover product and is much larger than needed for this prototype; do not add it as a dependency merely to solve climate-biome classification.

---

# Suggested implementation structure

Exact names may change after repository inspection, but keep responsibilities separate.

A reasonable structure is:

```text
src/world/biome.ts
  GameBiome
  climate-class -> GameBiome mapping
  combine climate + local landcover + elevation/slope

src/world/climate.ts
  compact Köppen-Geiger asset loading
  lookupClimateClass(lng, lat)
  caching / fallback

src/world/surface.ts (optional)
  unified surface classification/profile query
  no rendering code

src/map/biomeProfiles.ts
  palette and rendering parameters per biome

src/map/landscapeLayer.ts
  consumes classification/profile
  builds geometry
  does not own climate-data parsing
```

If existing architecture suggests better locations, adapt them, but avoid making `landscapeLayer.ts` responsible for data downloading, climate parsing, biome policy and rendering all at once.

---

# Data preprocessing deliverable

If the Köppen-Geiger raster is converted into a custom compact asset:

- add a script under a clearly named `scripts/` or `tools/` path;
- document the exact upstream file/period/resolution;
- document class encoding;
- make generation deterministic;
- do not require the conversion script at runtime;
- commit only the compact runtime asset, not the full source archive;
- include attribution/license notes as appropriate.

The browser-side runtime should perform only a cheap coordinate-to-cell lookup.

---

# Developer diagnostics

Add lightweight DEV-only diagnostics so the agent and future developers can inspect the result.

At minimum provide a way to inspect at the map center or cursor:

- longitude / latitude;
- raw DEM elevation;
- effective rendered terrain height;
- climate class;
- GameBiome;
- local land-cover class/subclass;
- final surface classification;
- terrain mesh stats if already available.

Prefer extending existing `window.*Stats()` / diagnostics patterns instead of building a permanent UI panel.

No production-visible debug overlay is required.

---

# Performance constraints

This branch has already required investigation of a browser freeze around the transition into custom terrain mode at zoom 12.5.

Therefore:

- do not add synchronous global raster parsing on the zoom event;
- do not classify millions of vertices in one uninterrupted task;
- preserve/extend existing yielding and cancellation in terrain mesh generation;
- climate lookup must be local memory access after initial load;
- cache repeated tile/classification work;
- avoid allocating large temporary objects per terrain vertex;
- no climate fetches in the render loop;
- no unbounded cache growth.

The implementing agent must specifically test repeated transitions across the custom-terrain threshold.

A visually better world that reintroduces the zoom 12.5 freeze is not an acceptable prototype.

---

# Autonomous implementation sequence

The programming agent should execute this task in the following order.

## Phase 0 - Baseline

1. Read the files listed under "Existing architecture".
2. Run `npm install` if dependencies are not present.
3. Run:
   - `npm run build`
   - `npm test`
4. Launch the current app.
5. Capture or otherwise record baseline observations at representative locations.
6. Confirm how to found/load a settlement for visual testing.
7. Confirm current terrain diagnostics and the zoom-12.5 behaviour.

Do not begin by replacing working terrain infrastructure.

## Phase 1 - Climate lookup

1. Add the compact Köppen-Geiger runtime asset.
2. Add deterministic coordinate lookup.
3. Add tests for known climate classes at several locations.
4. Ensure asset load failure has a safe fallback.
5. Ensure no render-loop network activity.

## Phase 2 - Game biome classification

1. Add `GameBiome`.
2. Map climate classes to broad game biomes.
3. Combine climate with explicit natural land cover.
4. Add elevation/slope alpine override carefully.
5. Unit-test pure mapping logic.

## Phase 3 - Terrain palette and holes

1. Replace universal meadow fallback with climate-biome base surface.
2. Add biome profiles/palette.
3. Keep explicit water/wetland/sand/rock/ice behaviour.
4. Check modern city and farmland areas: no obvious rectangular meadow holes.
5. Keep output deterministic.

## Phase 4 - Low-poly readability and transitions

1. Tune face shading, controlled variation and terrain palette.
2. Add soft natural boundary treatment.
3. Ensure no tile seams.
4. Ensure shoreline remains correct.
5. Ensure mesh generation still yields/cancels correctly.

## Phase 5 - Vegetation demonstration

1. Feed GameBiome into vegetation styling.
2. Demonstrate at least temperate vs boreal forest distinction.
3. Prefer additional tropical/savanna treatment if existing vegetation architecture makes it cheap.
4. Keep real forest geometry.

## Phase 6 - Settlement integration

1. Load/create a settlement in the new terrain.
2. Inspect buildings, planned buildings, roads, fields and clearings.
3. Fix surface mismatches through the shared terrain system, not arbitrary one-off offsets.
4. Test near water and on noticeable slope.

## Phase 7 - Regression and final validation

1. `npm run build`
2. `npm test`
3. Run any terrain-specific tests added by the implementation.
4. Repeatedly cross zoom 12.5 in both directions.
5. Pan far enough to force terrain mesh recenter/rebuild.
6. Check browser console for exceptions and WebGL warnings.
7. Inspect representative global biome locations.
8. Inspect a real settlement.
9. Update credits/documentation for any shipped external data.
10. Summarize implementation, known limitations and follow-up work in the final commit/PR description.

---

# Required visual test locations

Use fixed representative locations so regressions can be compared later. Exact camera position may be adjusted slightly to avoid ocean or inaccessible geometry, but document any change.

The goal is not to prove scientific perfection at one coordinate; it is to catch global-style failures.

### A. Northern Europe / existing-city naturalization

**Tallinn, Estonia**  
Approx. `59.437, 24.754`

Check:

- modern city footprint does not become a generic rectangular meadow;
- temperate/boreal-transition ground reads plausibly;
- coastline/water works;
- a settlement can be displayed on the terrain;
- buildings/fields/roads align with the surface.

### B. Hot desert

**Central Sahara**  
Use a safe inland coordinate in the Sahara chosen by the agent and record it.

Check:

- base terrain is desert, not meadow;
- no green fallback patches in missing landcover areas;
- rock/sand/slope modifiers remain visible.

### C. Savanna / tropical seasonal climate

**East Africa**  
Choose and record a representative inland savanna coordinate.

Check:

- not rendered like northern European grassland;
- dry/open palette is distinct from desert and temperate grass.

### D. Tropical wet climate

**Amazon or Congo Basin**  
Choose and record one representative coordinate.

Check:

- tropical climate ground/forest profile is visually distinct;
- dense forest does not use boreal colours.

### E. Tundra

**Northern Scandinavia or another clear ET zone**  
Choose and record the coordinate.

Check:

- tundra fallback is not green meadow;
- ordinary dense temperate forest treatment is absent where inappropriate.

### F. Mountain/alpine

**Alps**  
Choose and record a coordinate with substantial relief.

Check:

- DEM shape remains recognizable;
- slopes expose rock appropriately;
- low-poly facets are readable;
- terrain mesh has no cracks;
- camera does not collide/freeze.

---

# Minimum automated tests

Add tests for logic that can be tested without WebGL.

At minimum:

1. climate-grid coordinate indexing, including:
   - negative longitude;
   - longitude near +/-180;
   - latitude bounds;
2. Köppen class -> GameBiome mapping;
3. explicit land-cover overrides;
4. desert fallback when no local natural polygon exists;
5. tundra fallback when no local natural polygon exists;
6. deterministic result for identical inputs;
7. no accidental universal-meadow fallback in the classifier.

Do not try to unit-test visual quality with brittle pixel snapshots unless the current test infrastructure already supports this well.

---

# Definition of done

The prototype is done only when all of the following are true:

- [ ] Real DEM remains the source of terrain shape.
- [ ] Global climate biome data influences the world.
- [ ] Sahara-like locations are not rendered as meadow.
- [ ] Tundra locations are not rendered as meadow.
- [ ] Tropical/savanna/temperate/boreal/desert/tundra environments are visually distinguishable.
- [ ] Real natural land-cover polygons still matter locally.
- [ ] Former modern city/farmland areas no longer reveal large generic meadow rectangles merely because human geometry was filtered out.
- [ ] Terrain has a coherent stylized low-poly appearance.
- [ ] Surface transitions are less GIS-like and remain deterministic.
- [ ] Water geography remains correct.
- [ ] Player buildings, roads, fields and clearings align with the custom terrain.
- [ ] A real settlement has been visually inspected in the new world.
- [ ] Terrain rebuild/recenter has been tested.
- [ ] Repeated zoom transitions across 12.5 do not reproduce a browser freeze.
- [ ] `npm run build` passes.
- [ ] `npm test` passes.
- [ ] New pure-classification tests pass.
- [ ] External dataset attribution/preprocessing is documented.
- [ ] No known severe console/WebGL errors remain.

---

# Expected final report from the implementing agent

When implementation is complete, report:

1. files added/changed;
2. exact climate dataset file and resolution used;
3. final GameBiome mapping;
4. how former-city/farmland fallback works;
5. how terrain transitions are softened;
6. how vegetation changes by biome;
7. how `terrainSurfaceAt()` remains aligned with the rendered mesh;
8. performance observations at zoom 12.5;
9. test commands and results;
10. representative locations inspected;
11. screenshots or concise visual observations for:
    - Tallinn with a settlement;
    - desert;
    - savanna;
    - tropical wet;
    - tundra;
    - alpine;
12. remaining limitations and the next highest-value visual improvement.

Do not claim the prototype is complete if only the terrain shader was changed. The task is specifically about a coherent **real-Earth game world** and must include global biome context plus settlement integration.
