# Prototype implementation plan

Working title: **Rebirth** (rename freely).

## 1. Concept recap

The player arrives on an empty Earth where only terrain and nature remain. They pick
any point on the globe, name a settlement and grow it as an idle city builder. In
parallel they excavate the past: real buildings, streets and landmarks that existed
on that spot. Every find goes into a historical map and the player's notebook as a
real, sourced entry. No story, no explanation of why the world is empty. Light
"rebirth" tone.

Decisions already made:

- Web, 2D top-down map, TypeScript stack.
- Idle pacing: short sessions, progress accrues while offline.
- One city for now. No artificial radius: growth is limited by terrain and logistics.
- Notebook contains real facts only, with attribution.

## 2. Key design decision: no satellite imagery

Satellite photos show today's cities, which contradicts the empty world. The base map
is a "rewilded" Earth instead:

- hillshade and elevation tint from the terrain DEM;
- water, rivers, forests, wetlands, meadows from OpenStreetMap vector tiles;
- built-up land drawn as meadow; buildings, roads and labels hidden.

The same OSM tiles also contain the buildings, roads and street names. They stay
hidden and are revealed cell by cell when the player excavates. One data source
gives both the empty world and the buried past.

## 3. Data sources (all verified reachable from a browser, CORS `*`, no API key)

| Purpose | Source | Notes |
|---|---|---|
| Terrain (hillshade, elevation, slope) | AWS Terrain Tiles, Terrarium PNG: `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png` | Decode: `elev = R*256 + G + B/256 - 32768`. MapLibre `raster-dem` supports `encoding: "terrarium"` natively. |
| Nature + buried city | OpenFreeMap vector tiles, OpenMapTiles schema, TileJSON at `https://tiles.openfreemap.org/planet` | Max zoom 14. Layers used: `water`, `waterway`, `landcover`, `landuse`, `park` (nature); `building`, `transportation`, `transportation_name`, `poi`, `housenumber` (buried past). Tile URL is versioned: always read it from TileJSON. |
| Historical entries | Wikipedia API: `list=geosearch` (radius ≤ 10 km, ≤ 500 results) + `prop=extracts&exintro` | `origin=*` for CORS. Russian wiki first, English fallback. Store page URL for attribution (CC BY-SA). |

Attribution line on the map: © OpenStreetMap contributors, OpenFreeMap, OpenMapTiles,
Mapzen/AWS terrain sources; Wikipedia links in every notebook entry.

## 4. Stack

- **Vite + TypeScript** — build and dev server.
- **MapLibre GL JS v5** — map rendering, globe projection for picking the start point,
  all game layers (hex grid, buildings, roads, revealed ruins) as GeoJSON sources.
  No PixiJS: MapLibre layers are enough for 2D.
- **h3-js** — hexagonal grid: point → cell, neighbours, cell boundary. Resolution 9
  (~0.1 km², ~175 m edge, about a city block).
- **@mapbox/vector-tile + pbf** — decode vector tiles off-screen for cell
  classification and excavation, independent of what is rendered.
- **Preact + @preact/signals** — HUD, panels, notebook. Tiny and reactive.
- **Vitest** — unit tests for pure game logic.
- Save: `localStorage` (small JSON: cell ids and states only; geometry is re-derived
  from tiles). Tile/article cache in IndexedDB later if needed.

## 5. Architecture

```
src/
  main.ts                 bootstrap
  map/
    style.ts              rewilded MapLibre style (hillshade + nature layers)
    mapView.ts            map instance, game layers, click/hover → cell id
  world/
    tiles.ts              fetch + cache raw tiles (Terrarium PNG, vector PBF)
    terrain.ts            elevation and slope per cell
    landcover.ts          dominant land type per cell (point-in-polygon sampling)
    buried.ts             buildings / streets / POIs inside a cell from vector tiles
    cells.ts              CellInfo = terrain + landcover + buried density; cached
  game/
    defs.ts               building and resource definitions (data, not code)
    state.ts              GameState type, signals
    sim.ts                tick(state, dtSeconds); offline catch-up uses the same fn
    placement.ts          can-build rules (land type, water, road connection)
    roads.ts              road cost from slope, connectivity BFS from city centre
    excavation.ts         dig progress, reveal, rewards
    save.ts               serialize / load / versioning
  history/
    wiki.ts               geosearch prefetch, bucket articles by H3 cell, extracts
    notebook.ts           entries from articles + OSM finds
  ui/                     Preact components: Hud, BuildBar, CellPanel, Notebook, FoundCity
```

Rules:

- `game/` is pure and deterministic: no DOM, no fetch. Easy to unit-test and balance.
- `world/` and `history/` are the only modules that touch the network.
- One `tick()` function drives both live play and offline catch-up, so offline progress
  can never diverge from live progress.

## 6. Game rules for the prototype

**Resources:** food, wood, stone, population. Plus "knowledge", earned from finds.

**Cell types** (derived from data): water, forest, meadow, wetland, steep (slope above
threshold). Hidden attribute: buried density (number of OSM buildings / streets / POIs
in the cell).

**Buildings (5):**

| Building | Allowed on | Effect |
|---|---|---|
| Hut | meadow, forest edge | +population cap; needs water within 1–2 cells (river, lake or well) |
| Farm | meadow | +food |
| Lumber camp | forest | +wood |
| Quarry | steep | +stone |
| Well | any land | provides water to nearby cells |

Plus **Dig site** (assign population to excavate a cell) and **Road**.

**Natural growth limits (instead of a radius):**

- Every building needs a road connection to the centre.
- Road cost grows with slope; very steep cells are blocked early on.
- Water cells are impassable in the prototype (bridges come later).
- Clearing a forest cell before building costs time and gives wood.
- Housing only works near water.

**Excavation loop:**

1. A faint "anomaly" glow on cells with high buried density hints where to dig.
2. Assign diggers to a cell; progress accrues over time.
3. On completion: the cell's real building footprints and streets appear in a sepia
   "ruins" style; street names and POIs become finds; Wikipedia articles located in the
   cell become notebook entries.
4. Rewards: salvaged stone, knowledge, and a discount for building on old foundations.
   Revealed streets can be turned into roads cheaply.

**Sparse data fallback:** cells with no articles still yield OSM finds (street names,
named POIs, building counts). Cells with nothing buried get better resource yields,
so empty regions remain playable.

**Idle:** fixed-step simulation, catch-up on load from `lastSavedAt` (cap at 24 h for
the prototype). Autosave every few seconds and on `visibilitychange`.

## 7. Milestones

Each milestone ends with something runnable in the browser.

| # | Milestone | Done when |
|---|---|---|
| M0 | Scaffold + rewilded map | Map of any city shows terrain and nature only: no buildings, roads or labels. |
| M1 | Founding | Globe view → click a point → name the city → camera flies in, centre cell marked, saved and restored on reload. |
| M2 | World sampling | Hovering a hex shows its type, elevation and slope; classification looks right in 3 test places (river city, mountain town, forest village). Unit tests for Terrarium decode and slope. |
| M3 | Economy core | Place 5 building types with rules, resources tick, offline catch-up works after closing the tab. Unit tests for `tick` and catch-up equivalence. |
| M4 | Roads and expansion | Roads with slope cost, connectivity from centre, water blocks expansion. City visibly grows along valleys and rivers. |
| M5 | Excavation | Dig sites reveal real building footprints and streets in the cell, give salvage and foundation discounts. |
| M6 | Notebook and historical map | Real Wikipedia entries with links appear on excavation, anomaly hints, toggle for the historical layer. |
| M7 | Balance and playtest | 15 minutes of play plus an offline return feel rewarding in a big city and in a sparse village. |

Prototype is done when M0–M6 work end to end and M7 has had one balancing pass.

## 8. Out of scope for the prototype

Excavation depth by era, blueprints for restoring buildings, bridges, transport,
multiple settlements, the shared world archive, accounts and server saves, sound,
mobile layout polish.

## 9. Risks

- **Uneven data**: mitigated by OSM fallback finds and higher yields in empty cells.
- **Wikipedia rate limits**: fetch once per city (bucketed by cell), cache; send the
  `Api-User-Agent` header.
- **OpenFreeMap fair use**: cache tiles, never bulk-prefetch large areas.
- **Vector tiles stop at z14**: enough for footprints at city-block scale; overzoom
  for display.
- **Wikipedia geocoding quality**: some articles point to a district centre rather
  than an exact building. Acceptable for the prototype; shown as "nearby" finds.
- **Tile decoding cost**: move `world/` decoding into a Web Worker if the main thread
  stutters.
