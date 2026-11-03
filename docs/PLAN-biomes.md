# Rebirth — biomes plan

The planet seen from orbit is one green: every biome of the real Earth should read on it (desert, mountains, jungle,
savanna, tundra, broadleaf and conifer forest, taiga, steppe and meadow, swamp, ice), in the atlas palette.

## 1. Why the planet is green

- The terrain colour is the drape (`engine/bake/drape.ts paintDrape`): it fills the page with `C.meadow`, then paints
  OpenMapTiles landcover polygons over it.
- OpenMapTiles landcover is sparse at low zooms and only covers patches between towns and fields even at z12. The
  orbit view draws z0–z5 pages, which are almost all base fill, so almost everything is `C.meadow`.
- The shader's height/slope albedo (`terrain.wgsl fs`, green → dry uplands → rock → snow) is used only where no drape
  page exists; a drape page overwrites it. Mountains therefore get no rock or snow line either.

## 2. Approach

Two independent layers, each where its invariant belongs:

1. **Horizontal: where each biome is** — a small global class raster from real data, sampled by the drape bake as the
   base fill instead of `C.meadow`. Landcover polygons, water and the cover ids are painted over it as today.
2. **Vertical: mountains** — treeline, snowline and steep rock applied in the terrain shader on top of the drape
   colour, from the height pages it already reads. This works at every zoom and needs no data.

Nothing changes in the game rules, the cover ids (tree scatter, tool highlight) or the water mask.

## 3. Data: RESOLVE Ecoregions 2017

- Dinerstein et al. 2017, 846 ecoregions grouped into 14 biomes plus "Rock and Ice". It is **potential natural
  vegetation** (no cropland or cities), which matches the rewilded world. Licence CC BY 4.0: credit in `CREDITS.md`
  and the About dialog.
- Rejected alternatives: Köppen–Geiger (climate, not vegetation; no wetlands or mangroves); MODIS/ESA land cover
  (today's cropland and cities); a procedural climate model from latitude and coast distance (wrong in exactly the
  places a player would check: Gobi, Atacama, Namib, Congo vs Sahel).

Game classes (ids stored in the raster, 0 = no data):

| id | class | RESOLVE biome | far colour (orbit) | open colour (between polygons) |
|---|---|---|---|---|
| 1 | rainforest (jungle) | 1 Tropical moist broadleaf | dark canopy `#1f3a1c` | lush grass `#4a6a35` |
| 2 | dry tropical forest | 2, 3 Tropical dry broadleaf / conifer | `#3d4a26` | `#6a6a3c` |
| 3 | savanna | 7 Tropical grassland, savanna | tawny `#7a7140` | `#857a48` |
| 4 | broadleaf and mixed forest | 4 Temperate broadleaf and mixed | `#33482a` | `#55663f` |
| 5 | temperate conifer forest | 5 Temperate conifer | `#26362a` | `#4e5a42` |
| 6 | taiga | 6 Boreal forest | `#263224` | mossy `#56604a` |
| 7 | steppe and prairie | 8 Temperate grassland | `#77754a` | `#7d7a4e` |
| 8 | swamp and floodplain | 9 Flooded grassland | `#3f5236` | `#4a5a3c` |
| 9 | mountain meadow | 10 Montane grassland, shrubland | `#6b6a4d` | `#6e6c50` |
| 10 | tundra | 11 Tundra | `#6a6a55` | `#6e6d58` |
| 11 | Mediterranean scrub | 12 Mediterranean woodland, scrub | `#5d6040` | `#6c6a45` |
| 12 | desert | 13 Desert and xeric shrubland | hot `#a08a5c` / cold `#8a806a` by latitude | same |
| 13 | mangrove | 14 Mangroves | `#2b4028` | `#3f5236` |
| 14 | ice | Rock and Ice | `C.ice` | `C.ice` |

The colours are starting values, muted to sit with `ui/palette.ts`; they are tuned from screenshots in step 5. Each
class also gets a second tone, mixed in by low-frequency noise, so a biome is not one flat colour (sand and rock
patches in the desert, darker and lighter canopy).

## 4. Steps

### Step 1. Bake the raster (`scripts/bake-biomes.mjs`, `src/world/biomes.png`) — done

- Input: the official `Ecoregions2017` shapefile, path given as an argument (the dataset is not committed). The
  shapefile, dBase and PNG formats are read and written by the script itself, no dependency. "Rock and Ice" is the
  ecoregion of that name (its BIOME_NUM is 11, BIOME_NAME N/A).
- Rasterise `BIOME_NUM` mapped to the table above onto an equirectangular 4096 × 2048 grid (~10 km per pixel at the
  equator): scanline, even-odd, texel centres inside, like `rasterCover`.
- **Fill the sea with the nearest land class** (jump flood or repeated dilation). The drape's coastline comes from
  OSM and the raster's from RESOLVE; without the fill, land between the two coastlines would have no biome. Water
  stays decided by the drape alone.
- Output: 8-bit greyscale PNG, class id per pixel, 119 KB. It sits next to its module and is loaded with
  `new URL("./biomes.png", import.meta.url)`, so Vite emits it for the worker under the relative base.
- Credits: RESOLVE Ecoregions 2017 (CC BY 4.0) in `CREDITS.md` and `src/ui/AboutDialog.tsx`.

### Step 2. Biome field (`src/world/biomes.ts`) — done

Shared by the bake worker and tests, pure apart from loading:

- the class table (id, key, far/open colours, second tone);
- `loadBiomeMap()`: fetch and decode `biomes.png` once with `world/pngDecoder.ts` (byte-exact, greyscale added);
- `biomeAt(lng, lat)`: nearest class, for tests and the terrain inspector later;
- `biomeColour(lng, lat, near)`: the colour at a point. The sample point is domain-warped by fractal value noise in
  world space (seeded by the unit-sphere position, so no antimeridian or page seam), and the four neighbouring
  classes are blended bilinearly: borders become ragged ecotones, not 10 km pixels. `near` (0..1) blends the far
  colour into the open colour.

Tests: known points give the expected class (Sahara 23°N 13°E desert, Amazon 3°S 60°W rainforest, Serengeti 2.3°S
34.8°E savanna, Germany 50°N 10°E broadleaf, Siberia 62°N 100°E taiga, Yamal 70°N 70°E tundra, Kansas 38°N 98°W
steppe, Tibet 33°N 88°E mountain meadow, Pantanal 17°S 57°W swamp, Greenland 72°N 40°W ice); the same point gives the
same colour from two neighbouring pages.

### Step 3. Drape base fill (`engine/bake/drape.ts`, `drapeWorker.ts`) — done

- `paintDrape` takes the page's base fill as an `ImageData` instead of filling `C.meadow` (`biomeBase`): the field
  is sampled on a 65 × 65 grid from page edge to page edge (neighbouring pages share their edge samples, so no seam)
  and spread bilinearly over the 256² texels. Landcover, forest edge, shore, water and rivers are
  painted over it unchanged.
- `near = smoothstep(7, 11, z)`. Far pages show how the biome reads from orbit (a jungle is canopy); near pages show
  open ground, so the ground around a town between the OSM forest polygons is never forest-coloured without trees.
  Neighbouring zooms differ by a quarter of the range, so a page swap does not pop.
- The worker loads the biome map once before its first page; a page waits for it.
- Cost: about 1.1 ms per page for the grid (per texel it was ~30 ms), plus the bilinear spread. If the map fails to
  load, pages fall back to the meadow fill.

### Step 4. Mountains in the terrain shader (`engine/terrain/terrain.wgsl`) — done

After the drape colour, on land only (weighted by `1 - water`), from the real height `h`, the slope and the latitude
(`up.z`):

- **treeline(lat)**: ~3 900 m up to 20°, ~2 000 m at 45°, 0 at 70°. Above it the colour blends over 300 m into an
  alpine meadow / fell tone.
- **snowline(lat)**, every 10°: 5 000, 5 200, 5 600, 5 800, 4 400, 2 800, 2 000, 1 300, 400 m, 0 at the pole —
  highest in the dry subtropics (Tibet stays mostly bare), ~3 400 m in the Alps. Above it, permanent snow
  (`SNOW_GAIN`), held off slopes over ~45°.
- **steep rock**: slopes over ~35° blend into the rock tone at every altitude.
- The no-drape fallback albedo (green → uplands → rock → snow at fixed heights) is replaced by the same function, so
  a node with and without a drape page agree.
- The breakpoints live in the shader (nothing on the CPU reads them); the belt colours (`C.fell`, `C.rock`, `C.ice`)
  are injected as linear constants like `WOOD` and `WET_LO`.
- Weather snow (`groundWeather`) still lies on top; permanent snow does not depend on the season.

### Step 5. Verify and tune — first pass done

- Screenshot tour from orbit: Africa, South America, Eurasia, North America, Australia, Antarctica; close-ups of the
  Alps, Himalaya, Andes; a founded town before and after (the near ground must not change character).
- `npm test`; drape bake time before/after.
- Tune the colours against each other and the palette from the screenshots.

## 5. Not in this plan

- **Game rules.** `world/landcover.ts landAt` still answers "meadow" wherever OSM has no polygon. With biomes, a town
  in the Sahara would look like desert while its rules say meadow. Mapping the biome into that fallback (desert →
  sand, swamp → wetland, ice → ice) is a separate decision with balance consequences.
- **Tree kinds by biome.** The scatter picks conifers and birches by latitude (`forestMix.ts coniferShare`). Jungle
  and savanna trees need new models (palms, acacias): its own plan.
- **Seasons** (autumn colours, the dry season in the savanna).
