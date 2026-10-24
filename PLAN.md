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
| Residents | Name, age, sex, household, home, workplace, education, health, happiness. Daily events: ageing, births, deaths, marriages and new households, moving out, immigration driven by attractiveness and food outlook, emigration by low mood. |
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
| S5 | Production | Goods chains, storage, seasons, shortages affecting happiness; construction consumes materials (logs, planks, stone). **Done** (section 8). |
| S6 | Services | Wells, market, chapel, school, healer; network-distance coverage; land value; info overlays. **Done** (section 9). |
| S7 | Visible life | Walkers and carts on roads, night lights, overlays for traffic, coverage and happiness. **Done** (section 10). Worker posts a cosmetic `life` message per game day and on load (up to 300 walkers, carts per load capped at 6 per producer, traffic over all commuters, lights); nothing of it is in `SimState` or saves; the «движение» overlay joins the S6 switch. |
| S8 | Idle and chronicle | Offline catch-up in the worker with progress, "while you were away" chronicle. **Done** (section 11). Catch-up runs in one-day chunks with `progress` messages (commands queue until it ends); `SimState.chronicle` (cap 1000, `addChronicle` in `sim/chronicle.ts` for E1) is saved and sent in snapshots only when it grows; the `Away` summary is counted step by step in `sim/away.ts`; a full 24 h catch-up of ~165 people took ~0.6 s in Node. |
| E1 | Excavation | Dig sites reveal real OSM footprints and streets at real scale; rebuild on old foundations; old streets suggest road alignments. **Done** (section 12). The disc grows 40 m² × PACE = 160 m² per digger-hour from 15 to 120 m (about 8 days with 3 diggers); the main thread reports finds with `recordFinds` (saved in `SimState.finds`), and a rebuild on a foundation skips stone and saves 25 % labor. |
| E2 | Notebook | Real Wikipedia entries tied to excavated places, plus the town chronicle. |

## 8. S5 design: production

**Pace.** Construction and building materials run `PACE = 4` times faster than history
(already true for construction labor since S3), so a village grows within days of play.
Food, wares and seasons stay real: people eat real amounts, fields yield once a year.

**Stock.** One town-wide stock, no haulage yet (carts come in S7):

| Good | Unit | Storage |
|---|---|---|
| food (провизия) | kg of grain equivalent | 3 t at the camp + 30 t per barn; any surplus rots (event) |
| logs (брёвна) | m³ | unlimited (log piles) |
| planks (доски) | m³ | unlimited |
| stone (камень) | t | unlimited |
| wares (утварь) | pieces | unlimited |

Founders bring 1 750 kg of food (enough for 10 people until the first harvest) and 20 wares.
Immigrants bring 60 days of their own food.

**Player-placed buildings** (new category `placed`; lots beside built roads, w × d cells like
grown buildings; painted zone under them is cleared; never removed by zone changes, only
with their road or by demolition):

| Building | Footprint | Lot (cells) | Labor (person-h) | Jobs | Output (per worker-hour, 07–19) | Site |
|---|---|---|---|---|---|---|
| Гумно (farmstead) | 8 × 10 m | 1 × 2 | 120 | ⌈fields ha / 2.5⌉, ≤ 16 | works the fields assigned to it | fields within 400 m (centroid), nearest farmstead wins |
| Лесоруб (woodcutter) | 4 × 4 m | 1 × 1 | 40 | 2 | 0.25 m³ logs × PACE × forest share | forest ≥ 10 % within 150 m |
| Пильня (sawpit) | 6 × 4 m | 1 × 1 | 50 | 2 | 0.02 m³ planks × PACE, eats 1.6 m³ logs per m³ | — |
| Каменоломня (quarry) | 8 × 8 m | 1 × 2 | 70 | 3 | 0.15 t stone × PACE × (0.4 + 0.6 × rock/sand share) | not on water/wetland |
| Рыбак (fisher) | 4 × 4 m | 1 × 1 | 40 | 2 | 0.2 kg food, × 0.5 in winter | water ≥ 5 % within 100 m |
| Амбар (barn) | 6 × 6 m | 1 × 1 | 100 | 0 | +30 t food storage | — |

Site shares are sampled on the main thread when placing (as road labor is) and stored on
the building.

**Fields.** 400 kg/ha/year net of seed (rye, three-field rotation averaged). Sowing: any time
in spring, 50 h/ha; `sown` = done / needed. Harvest window: the first 45 days of autumn;
200 h/ha × sown, each farmer-hour reaps 2 kg into the stock; whatever is left at the end of
the window is lost. Farmers work only in these windows, and only while their gumno has work
left in the open window; otherwise they join the construction party.

**Workshops** (grown craft buildings) make wares: pottery 0.025 pcs/h (no input), smithy
0.015 pcs/h (0.05 m³ logs per piece, charcoal), carpentry 0.015 pcs/h (0.03 m³ planks per
piece). **Shops and taverns** hand wares out: households want 0.05 pcs per person per day;
each employed trade worker serves 12 households a day.

**Food.** Daily at 00:00: adults 0.7 kg, children 0.45 kg. A shortage feeds everyone the same
fraction. A household that emigrates takes its share of the food (food × members / population).

**Tents.** Households living in tents take no regular jobs: their adults are builders and put
up homes first. Once housed they take jobs normally.

**Mood** (per household, 0–100, starts at 60). Daily target = 10 + 45 × fed + 10 × wares
supplied + 10 × has a house + service terms (section 9); mood moves a quarter of the way to it. Households in houses with
mood < 35 leave (10 % a day). Immigration is scaled by the food outlook and by average mood.
S6 changed the mood target (section 9) and added the unemployment term below.

**Idle adults** (jobless, or farmers with no field work, while no construction work exists for them to join)
subsist: each gathers food for the town, 1.2 kg a day (0.4 in winter), added to the stock at the daily food step
(up to the barns' capacity) and shown in the HUD food line. They are unhappy: the household's mood target drops by
12 × (idle adults / adults). There is no idle-based emigration any more: a family leaves only at mood < 35
(10 % a day), and **founding households** (`Household.founder`, older saves: arrived at minute 0) never leave, so a
town cannot empty out.

**Food outlook** (a full-year horizon, so growth stops at a sustainable population). projected = stock + exactly
one harvest + (the fishers' current daily output + the idle adults' foraging) × 360; the harvest is this year's unreaped expected amount while
the harvest window (ends on day 225) is open (a field not sown yet counts in full, 400 kg/ha), otherwise next
year's: 400 kg/ha of every field a gumno works. need = today's consumption × 360. outlook = clamp((projected /
need − 0.9) / 0.3, 0, 1). The HUD food line says «на год не хватит» in red when outlook < 1.

**Minimum artel.** While construction work exists the artel has at least max(3, ⌈0.2 × adults⌉) hands (jobless +
idle farmers + workers of workshops without inputs). The shortfall is drafted from the employed: they keep their
jobs, but every workplace's output in that tick is scaled by 1 − drafted / employed. The HUD counts drafted
workers under «на стройке».

**Construction materials.** Taken from the stock when construction starts; any shortfall is
made by hand and added to the labor (per unit, already divided by PACE): logs 4 h/m³, planks
12 h/m³, stone 2 h/t.

| Template | Logs m³ | Planks m³ | Stone t |
|---|---|---|---|
| izba | 25 | 2 | 2 |
| izba5 | 40 | 4 | 3 |
| smithy | 10 | 1 | 5 |
| carpentry | 22 | 3 | 2 |
| pottery | 10 | 1 | 4 |
| shop | 14 | 2 | 1 |
| tavern | 90 | 10 | 8 |
| farmstead | 30 | 4 | 3 |
| woodcutter | 6 | 0.5 | 0 |
| sawpit | 5 | 1 | 0 |
| quarry | 4 | 0.5 | 0 |
| fisher | 6 | 1 | 0 |
| barn | 20 | 6 | 2 |

Deferred: the mill and bakery (households grind and bake at home in the village era), firewood,
hunting and foraging, clearing forest for logs.

## 9. S6 design: services

Services are placed buildings (same tool and lot rules as S5). Coverage is network distance
along built roads, from the service's lot front to a house's lot front (plus both offsets
to the nearest node), and counts only while the service is finished and, if it has jobs,
staffed by at least one worker.

| Service | Footprint | Lot | Jobs | Reach | Effect on covered households |
|---|---|---|---|---|---|
| Колодец (well) | 2 × 2 m | 1 × 1 | 0 | 150 m | water: mood +8 |
| Рынок (market) | 12 × 12 m | 2 × 2 | 4 | 800 m | +5 mood; each market worker hands out wares to 20 households a day |
| Часовня (chapel) | 6 × 8 m | 1 × 2 | 1 | 1000 m | +7 mood |
| Школа (school) | 8 × 10 m | 1 × 2 | 2 | 800 m | children 7–14 attend; a child who attended ≥ 2 years becomes literate at 15; +3 mood for families with children |
| Лекарь (healer) | 6 × 6 m | 1 × 1 | 1 | 1000 m | death rates × 0.6; +2 mood |

Labor and materials of the services (chosen like the S5 placed buildings; materials as in section 8):

| Service | Labor (person-h) | Logs m³ | Planks m³ | Stone t | Height |
|---|---|---|---|---|---|
| Колодец | 30 | 2 | 0.5 | 3 | 2 m |
| Рынок | 160 | 30 | 6 | 2 | 4 m |
| Часовня | 180 | 35 | 4 | 6 | 8 m |
| Школа | 150 | 40 | 5 | 3 | 5 m |
| Лекарь | 80 | 14 | 2 | 1 | 4 m |

Mood target becomes 10 + 45 × fed + 10 × wares + 10 × house + well 8 + market 5 + chapel 7
+ school 3 + healer 2 (max 100). Emigration below 35 stays.

**Land value** of a house lot (0–100): 20 + 8 per covered service + 0.3 × (mood of the
households within 100 m − 50), clamped. **House upgrade:** an izba whose land value ≥ 70 and
whose household mood ≥ 75 for 20 days in a row rebuilds into level 2 (+2 residents, +1.5 m
height; 60 h labor, 10 m³ logs, 2 m³ planks, taken like construction).

**Literacy:** residents get `literate`; the HUD shows the literate share of adults. Literate
workers make workshops and shops 20 % more productive.

**Implementation notes (S6).**

- Coverage (`coverage.ts`, `computeCoverage`) is a bit mask per finished house (bit order well, market, chapel,
  school, healer) kept in `SimState.coverage`, with `landValue`; both are rebuilt at the end of the daily chain
  (after moods and jobs), on load, and after road or demolish commands. The daily order is economy, people,
  services, so the mood and the healer factor of a day use the coverage of the day before.
- Market: its workers hand wares only to households whose house the market covers, after the shops' slots,
  starting from a different household each day. Literate shop workers serve 12 × 1.2 households; literate
  workshop workers count as 1.2 workers (`SERVICE.literateBoost`).
- School: a child aged 7 to 14 whose house is covered by a staffed school gains one `school` day; the school
  mood term applies to households with such children. Attendance stops at 15, `literate` is set on the first day at
  15 or later with 720 days. The HUD share counts adults (16–59) only, so the first literate cohort shows at 16.
- Upgrade: only the izba; the house stays `active` with an `upgrade { labor, done, paid }`, so the family keeps
  its home. The artel serves it like a building under construction (`payMaterials`, `advanceBuildings`); on
  completion `level` = 2 and the height grows 1.5 m. `Building.streak` counts the good days.
- Blocked workshops: sawpit, smithy and carpentry whose input stock is empty and which made nothing yesterday
  count their workers as builders (`idleWorkplaces`); such workers are not "unemployed" when nothing is built.
- Saves: `level` 1 / `streak` 0 / `literate` false / `school` 0 by default, coverage and land value rebuilt on load.

**Overlays:** a map overlay switch (none, water, market, chapel, school, healer, land value,
mood) tints houses by coverage (yes/no) or value (gradient); the reach of a hovered or
selected service is drawn as its covered road edges.

## 10. S7 design: visible life

- **Walkers:** once per game day the worker picks up to 300 commuters and sends their walking
  paths (polylines in local meters along built roads, home ↔ work). The main thread animates
  dots at 4 km/h of game time: to work departing 06:00–07:00, home 19:00–20:00, so each
  arrives on time for 07–19.
- **Carts:** every producer sends one cart per load (logs 5 m³, planks 2 m³, stone 3 t, food
  500 kg, wares 20 pcs) to the camp along the road network; visual only, drawn as a larger
  dot.
- **Night lights:** when daylight < 0.4, occupied houses glow (blurred warm circle at the
  footprint centre); workshops glow until 21:00.
- **Overlays:** traffic (commuters per road edge per day, line width and colour) joins the
  S6 overlay switch.
- Everything visual is skipped while the tab is hidden and never touches the simulation.

## 11. S8 design: idle and chronicle

- **Catch-up with progress:** on load the worker advances in chunks of one game day and posts
  progress between chunks; the UI shows "Пока вас не было…" with a progress bar; commands
  wait until catch-up ends.
- **Chronicle:** `SimState.chronicle` keeps notable entries forever (cap 1000): population
  milestones (25, 50, 100, 250, 500, 1000), first house, first finished building of each
  template, each harvest with tonnes, famines (food ran out / ended), new year, first
  literate resident, excavation finds (E1).
- **While you were away:** on return the notice lists: game time passed, population change
  with births, deaths, arrivals and departures, buildings finished, goods produced, and the
  chronicle entries of that period.

## 12. E1 design: excavation

- **Dig site (Раскоп):** placed building, 6 × 6 m, lot 1 × 1, 3 diggers. The revealed disc
  grows by 40 m² × PACE = 160 m² per digger-hour from 15 m up to 120 m radius around the dig.
  The simulation only knows the discs (centre, radius).
- **Old world data:** the main thread reads OpenFreeMap z14 tiles (`building`,
  `transportation`, `transportation_name`, `poi`) and keeps the features inside revealed
  discs: building footprints as foundations, street lines clipped to the discs, named streets
  and POIs.
- **Rendering:** foundations as low grey-stone walls (0.6 m fill-extrusion outlines), old
  streets as faint dashed lines with their names, POI names as small labels.
- **Finds:** the main thread reports newly revealed foundations and POIs to the worker
  (`recordFinds`); each foundation yields salvaged stone (0.05 t per m² of footprint,
  capped at 20 t each). Recorded finds are saved so the notebook and rewards never repeat.
- **Rebuild on old foundations:** a building whose footprint overlaps a recorded foundation
  needs no stone and 25 % less labor.
- **Old streets suggest roads:** the road tool also snaps to revealed old street lines
  (vertices and nearest point), shown as guides.

## 13. E2 design: notebook

- A "Записная книжка" panel with three tabs:
  - **Находки:** named POIs and streets found, counts of foundations per dig, with the date.
  - **История:** Wikipedia articles unlocked when their coordinates fall inside a revealed
    disc (+ 50 m). Query `list=geosearch` around each dig (radius = disc + 300 m) in ru, en as
    fallback, then `prop=extracts` (intro, plain text). Each entry keeps title, extract (≤ 800
    chars), link, language, coordinates, and shows "Википедия, CC BY-SA 4.0" with the link.
    Unlocked entries are saved with the town so they stay offline.
  - **Летопись:** the chronicle (S8).
- New entries raise a small badge on the notebook button.

## 14. Out of scope for now

Later eras (manufactories, industry, modern utilities), bridges and water transport,
multiple towns, the shared world archive, accounts and server saves, sound, mobile
polish.

## 15. Risks

- **Scope.** A deep city sim is months of work; short playable milestones keep it
  moving.
- **Browser performance.** Ceiling ~10–20k residents and buildings. Profile from S4;
  rendering and offline catch-up are the hot spots.
- **Terrain resolution.** DEM at ~40–70 m per pixel is enough for road slopes, not
  for micro-relief under a single building.
- **Data unevenness.** Excavation depends on OSM/Wikipedia density; sparse places
  need fallback finds.
- **Tile fair use.** Cache tiles and sampled terrain; never bulk-prefetch.
