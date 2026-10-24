# Rebirth — implementation plan

Working title: **Rebirth**.

## 1. Concept

The player arrives on an empty Earth where only terrain and nature remain. They pick
any point on the globe, name a settlement and grow it into a living town at **real
scale**: real distances, real building footprints, real terrain. The player plans
(roads, zones, public buildings); the town builds itself and its residents live their
own lives, also while the player is away. In parallel the player excavates the past:
real buildings, streets and landmarks that existed on that spot, recorded in a
notebook as real, sourced entries. No story, no explanation of why the world is empty.
Light "rebirth" tone.

Decisions:

- Web, top-down 2D/2.5D map, TypeScript.
- **Hybrid pacing**: active planning like Cities: Skylines, but the town keeps living
  offline; on return the player reads a chronicle of what happened.
- **Start in a pre-industrial village era**, progress through eras later (fits the
  rebirth tone and the excavation layers).
- **Free-form roads with snapping**, not a grid.
- **Every resident simulated individually** (name, age, family, home, job); target
  ceiling ~10–20k residents in the browser.
- One town for now. No artificial radius: growth is limited by terrain and logistics.
- Notebook contains real facts only, with attribution.

## 2. Base map: no satellite imagery

Satellite photos show today's cities. The base map is a "rewilded" Earth: hillshade
from the DEM, water, rivers, forests, wetlands and wild meadows from OpenStreetMap,
built-up land drawn as meadow. Landcover and water use tiles capped at z12, which
drops lawns, courtyards and park alleys so nothing traces the old city. The same OSM
tiles hold the buildings and streets that excavation reveals later.

## 3. Data sources (browser-reachable, CORS `*`, no key)

| Purpose | Source | Notes |
|---|---|---|
| Terrain | AWS Terrain Tiles, Terrarium PNG | Used at z11 only: higher zooms include building/canopy heights. Absolute heights in dense cities read 20–30 m high; slopes are fine. |
| Nature + buried city | OpenFreeMap vector tiles (OpenMapTiles schema), TileJSON `https://tiles.openfreemap.org/planet` | Nature from z12, waterways from z14, buildings/streets/POIs from z14 for excavation. |
| Historical entries | Wikipedia `list=geosearch` + `prop=extracts` | Russian first, English fallback; CC BY-SA attribution. |

## 4. Done so far (commits on `main`)

- **M0** rewilded MapLibre map with globe projection.
- **M1** founding: pick a spot, name it, saved and restored.
- **M2** world sampling: land type, elevation, slope and river proximity at any point
  (`src/world/`), shared class rules with the map style, unit-tested.
- **M3** hex-based idle economy. **Superseded** by the real-scale simulation below;
  its pure fixed-step simulation, offline catch-up, save validation and UI shell are
  the patterns to keep.

## 5. Architecture

- **Local metric frame.** All simulation geometry is in meters on a tangent plane
  (x east, y north) centred on the founding point. Convert to lng/lat only for
  rendering and world sampling. Distortion is negligible within tens of km.
- **Simulation in a Web Worker.** Deterministic, pure, fixed-step. The main thread
  sends commands (build road, zone, place building) and receives snapshots/diffs.
  Offline catch-up runs in the worker with progress reporting.
- **Two levels.**
  - *Macro (authoritative):* residents, households, buildings, goods flows, trips.
  - *Visual (cosmetic):* walkers and carts moving along roads, sampled from the macro
    trips. Never affects the outcome; skipped entirely while offline.
- **Time.** 1 real minute = 1 game hour, so a game day is 24 real minutes and a game
  year (360 days) is 6 real days. Base tick = 10 game minutes (production, flows,
  construction); life events once per game day. Offline catch-up capped at 24 real
  hours (60 game days).
- **Data layout.** Residents as struct-of-arrays (typed arrays) for speed; roads,
  lots and buildings as plain records keyed by id.
- **Rendering.** MapLibre: roads as lines at real width (meters → pixels by zoom),
  zone cells as fills, buildings as `fill-extrusion` with real heights, walkers as a
  circle layer. Move to a custom WebGL layer only if profiling demands it.
- **Saves.** Version 3 holds the town and the full simulation state; version 2 saves
  keep their city (name, location) and start a fresh village.

## 6. Simulation model (village era)

| Layer | Model |
|---|---|
| Land | Land type, slope, river at any point (from M2). Water unbuildable; forest must be cleared (gives logs); steep land limits roads and buildings. |
| Roads | Graph of nodes and straight segments, snapping to nodes and segments, splitting at intersections. Kinds: path, dirt road. Cost from length × slope × clearing. Capacity per kind. Bridges later. |
| Zones | Cities: Skylines style: zone cells 8 × 8 m along both sides of a road, up to 4 deep, blocked by water, steep land and other roads. Zone types: residential, crafts, trade. Fields are painted as separate areas owned by a farmstead. |
| Buildings | Templates with real footprints and heights (e.g. izba 6 × 8 m, 5 m high). Grow on zoned lots when demand exists; construction takes time and materials; levels improve with services and wealth; abandoned when unwanted. Public buildings are placed by the player. |
| Residents | Name, age, sex, household, home, workplace, education, health, happiness. Daily events: ageing, births, deaths, marriages and new households, moving out, immigration and emigration driven by attractiveness. |
| Economy | Chains with real historical magnitudes: field → grain → mill → bakery → market; forest → logs → sawpit → planks; quarry → stone. Seasonal harvests, storage, shortages. |
| Services | Well (water), market, chapel, school, healer. Coverage measured along the road network in meters, affects happiness and land value. |
| Transport | Daily home→work assignment by shortest path on the road graph; travel time; congestion as flow vs capacity; unreachable jobs mean unemployment. |
| Chronicle | Notable town events (first harvest, population milestones, shortages, new buildings), feeding the notebook alongside real history. |

## 7. Milestones

Each milestone ends with something playable in the browser.

| # | Milestone | Done when |
|---|---|---|
| S0 | New foundation | Local metric frame, game clock with day/night tint, worker-hosted sim with command/snapshot protocol, save v3 with migration from v2, M3 hex economy removed. Unit tests for frame conversion and the worker protocol. |
| S1 | Roads | Draw roads with snapping and intersection splitting, cost from terrain, rendered at real width; delete roads; graph persisted. Tests for graph editing and costs. |
| S2 | Zones | Zone cells generated along roads, blocked correctly by water/steep land/other roads; paint and unpaint zones; fields as areas. |
| S3 | Growth | Demand model, buildings grow on lots from templates, construction by the work party (labor only), 2.5D buildings at real size. **Done.** Population is a placeholder (houses assumed full, work party = 10 + 1 per house) until S4; materials move to S5. |
| S4 | Residents | Individual residents and households with life events, commuting, unemployment, migration; resident and household inspector. **Done.** Jobs by walking time on built roads (4 km/h, ≤ 45 min); jobless adults form the construction party; snapshots carry aggregates, the inspector queries the worker. Education, health and happiness come with S5–S6. |
| S5 | Production | Goods chains, storage, seasons, shortages affecting happiness; construction consumes materials (logs, planks, stone). |
| S6 | Services | Wells, market, chapel, school, healer; network-distance coverage; land value; info overlays. |
| S7 | Visible life | Walkers and carts on roads, night lights, overlays for traffic, coverage and happiness. |
| S8 | Idle and chronicle | Offline catch-up in the worker with progress, "while you were away" chronicle. |
| E1 | Excavation | Dig sites reveal real OSM footprints and streets at real scale; rebuild on old foundations; old streets suggest road alignments. |
| E2 | Notebook | Real Wikipedia entries tied to excavated places, plus the town chronicle. |

## 8. Out of scope for now

Later eras (manufactories, industry, modern utilities), bridges and water transport,
multiple towns, the shared world archive, accounts and server saves, sound, mobile
polish.

## 9. Risks

- **Scope.** A deep city sim is months of work; short playable milestones keep it
  moving.
- **Browser performance.** Ceiling ~10–20k residents and buildings. Profile from S4;
  rendering and offline catch-up are the hot spots.
- **Terrain resolution.** DEM at ~40–70 m per pixel is enough for road slopes, not
  for micro-relief under a single building.
- **Data unevenness.** Excavation depends on OSM/Wikipedia density; sparse places
  need fallback finds.
- **Tile fair use.** Cache tiles and sampled terrain; never bulk-prefetch.
