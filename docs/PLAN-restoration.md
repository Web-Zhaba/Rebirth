# Rebirth — restoration-first gameplay (design record)

> Status: approved design (decided 2026-11-10). RB1-RB4 done (2026-11-10/11); see the notes under each section and section 7.
> Replaces for implementation: the restore order with "monument / working" modes (`src/sim/restore.ts`,
> PLAN-research.ru.md §4 item 4 and §7) and the template-size fit of foundation lots (`src/sim/foundationLots.ts`,
> PLAN.md §12). Everything else in those documents stands.

## 1. Direction

The core of the game is **bringing back the old look of the place and learning its history through that**. Simulation
and city-building give restoration its purpose and its consequences; they are not a separate game.

Rejected while deciding (do not reopen without a new reason):

- A colony sim with a few pawns (RimWorld scale) instead of a town.
- Named specialists as a second people system next to the residents: two games in one.
- Shorter game days for "dynamics": it only raises actions per second.
- Random events, on digs or elsewhere: events were cut from the game.
- A knowledge meter fed by Wikidata or other external data: most villages have nothing but footprints and streets.
- Invented historical depth layers ("the 18th-century layer"): the data has one layer, today's, and factual claims
  must stay traceable. Gameplay depth only (foundation, cellar).
- Limits by building material alone: a large wooden warehouse that still stands at its real place must be restorable.

## 2. A building on a foundation: the foundation sets the size

Today a template has a fixed footprint and a foundation must be 0.4–4× of it ("the foundation is too large for this").
Reversed:

- **Any purpose on any foundation** at or above `FOUNDATION_LOT.minArea`, except open-ground templates (garden, quarry,
  woodcutter, …). The player picks only the purpose; the building takes the ring as it is, at full size.
- **Restoration is ordinary construction.** Putting a building on an old foundation *is* restoring it. The separate
  restore order, its panel and the "monument / working" modes go; **monument** becomes one of the purposes. Notable
  foundations take the same path.
- **"As it was"**: the purpose matches the foundation's known old kind (`cls`). It brings the full bonus, the real name
  where the data has one, and a chronicle line. Any other purpose is allowed, without that bonus.
- Cost (labor, materials) stays proportional to floor area, as `scale` already does. A site still takes at most 16 hands
  (`siteCrew`), so a big building takes long in calendar time.
- Save migration: `scale` is no longer capped by `fitMaxOf`; restored buildings with `restoreMode` map to a purpose
  (monument or their working template).

### 2.1 Floors from the real height

- **Every** foundation keeps its height from the tiles (today only typed ones do, `src/map/excavation.ts:69`).
  Floors = round(height / 3 m), at least 1; no height = 1 floor.
  *Done with 3.66 m, not 3 m:* the tile height is OpenMapTiles `render_height` = levels x 3.66 (rounded up), or 5 m when
  the building has no levels; on sampled tiles the values are 4, 5, 8, 11, 15, 19, 33. With 3 m every unknown building
  (5 m, over 90 % of a village) would get two floors; with 3.66 m it gets one and tagged levels come back exactly.
  Known foundations of old saves get their height when the client reports them again; a building on one learns its floors.
- **Floor area = footprint × floors.** It drives capacity, cost and heating.
- **Housing**: about one family per 50 m² of floor area, no fixed family cap. A five-storey block of 600 m² holds about
  60 families, a one-storey village house of 80 m² one or two.
- Floors not yet allowed by technology (2.2) are built later as an **upgrade of the existing building** (add a floor),
  not a new button. Capacity counts built floors only. "As it was" is complete once the building reaches its old height.

### 2.2 Size limits by purpose, not by material

Long and large wooden buildings existed where no heating was needed. Limits apply where people live and work in heat.

| Purpose class | Footprint | Floors |
|---|---|---|
| Unheated storage and farm buildings (barn, warehouse, timber and stone yards, market sheds) | any, wooden, from the start | 1; 2 with «Просторное жильё» |
| Heated housing and workshops | start ~150 m², «Просторное жильё» ~250 m², «Работа с камнем» + «Просторное жильё» ~600 m², «Стропильные фермы» (era II) any | 1 / 2 / 3 / 5 |
| Public halls (temple, school, town hall) | a large hall needs «Стропильные фермы» or stone masonry | as housing |

- **"As it was" lifts the limits** when the old kind is known: the old building shows it could be built.
- A foundation above the current limit stays on the map with a hint ("needs stone masonry"): a goal, not an error.
- The numbers are starting values. Before fixing them, measure the common foundation areas of real villages, so the
  wooden limit does not cut off ordinary village houses.
  *Measured (2026-11-10), OpenFreeMap z14, buildings of 20 m2 and more:* villages (Вятское, Ферапонтово, Кукобой, Кимжа,
  Варзуга, Мстёра, Палех, Кидекша, Половинное and three rural tiles) have a median of 95-210 m2, a 90th percentile of
  190-430 m2; 14-70 % (typically a third) are over 150 m2, 4-28 % (typically a tenth) over 250 m2. Small towns (Мышкин,
  Суздаль, Кириллов, Старица): median 110-160 m2, 90th percentile 340-570 m2. Hence the limits in code: heated
  250 / 400 (housing) / 1000 (housing + stonework) / any (trusses), floors 1 / 2 / 3 / 5; halls 250, 1000 with stonework,
  any with trusses; stores any size, one floor, two with housing (`sim/foundationLots.ts` STAGES).
- «Стропильные фермы» today only lengthen bridges; large roofs fit them. The «Свод» insight fits stone halls.

### 2.3 Capacity by purpose

- Housing: by floor area (2.1).
- Workplaces: jobs grow slower than area (about the square root) and have a cap, so one huge workshop does not swallow
  every free worker. *Done:* round(jobs x sqrt(floor area / template footprint)), at most 3x the template's.
- Storage: capacity linear in floor area (storage does not drive growth).
- Services: reach does not grow with size.
- **Heating by floor area, only while the house has at least one resident.** An empty house burns nothing; a large
  half-filled house costs the whole area. Building ahead of arrivals is a conscious trade-off.
  *Done:* the weather's firewood rate is that of 72 m2 (one family's room in a house of the old kind); a regular house and
  a tent burn it per family as before, a house on a foundation its floor area shared by the families in it.
- Immigration stays flow-limited (b93c238, `src/sim/attraction.ts`: 2–5 families a day): a big house fills over time,
  it does not pull families at once. The old 1000 → 3000 jump in an hour came from one family per free home.

## 3. Three tiers of old buildings

1. **Ordinary** (houses, sheds, everything without a kind): the bulk. Restoring gives the function and counts toward
   recognisability (section 4). No research bonus, no limit.
2. **Typical** (shops, banks, pharmacies, department stores, malls, wholesale): restorable with a matching purpose
   (a shop works as a trading stall). Small, local bonus; each further one of a kind counts less (`REPEAT`, already in
   `heritage.ts`). These kinds come back from `LEGACY_DOMAIN`.
3. **Unique** (one of its kind): an insight, a chronicle chapter, the monument effect.

Telling unique from typical, from data already loaded:

- POI class: commerce is typical; worship, museum, castle, station, school are candidates for unique (exists).
- A proper name: a nameless building is never unique.
- **Name repetition**: the same name several times in the revealed area means a chain, so typical (new, simple).
- **A matching Wikipedia article** next to the ring with the same title: the strongest sign (articles are already
  loaded per dig; they need matching to foundations).

## 4. Rewards by share, not by count

- Each foundation already has its `digId`. **Recognisability of a dig** = restored share of its old foundations by area.
- Thresholds 25 / 50 / 75 / 100 % give one reward each: an insight, a chronicle line or a lasting mood bonus for the
  district. The number of rewards is bounded by the number of digs, not buildings.
- A street restored in full (its houses on their foundations, the road on the old line) gets its real name back and a
  chronicle line.
- **Monument mood does not stack**: a house takes the best monument in reach, not the sum (land value already has a cap).
- Restoring many pays; the rewards go to finishing places, which is the goal of bringing the old look back.

## 5. Excavation in two stages

Proposed in the discussion; it is what lets finds point to places not yet open (section 6).

- **Survey**: wide, fast, cheap. Reveals the old plan: street lines and ghost outlines of buildings.
- **Dig a foundation**: the player clicks a ghost outline; diggers clear that one. Result: a buildable foundation, old
  stone (`DIG.stonePerM2`, exists) and finds. A queue "dig the whole street" keeps clicks low.
- **The moment of discovery**: the outline draws itself while the work goes; a unique building opens with a card (name,
  kind, article if any) and the camera flies to it. Ordinary houses open quietly.

## 6. Finds and the museum

### 6.1 Every find comes from a real object in the data

One real feature gives exactly one find; the object may be typical, its place and name are real (attributed, OSM /
Wikipedia). Game wording stays neutral, as today: the game never claims the object existed.

| Find | Source (OpenMapTiles z14 unless noted) | Belongs to |
|---|---|---|
| Sign with a name | named POI | its building |
| Typical object of the place, with the real name ("postmark of the «Бабушкино» office", "station bell") | POI class/subclass → 1–3 object types | its building |
| Street sign | `transportation_name` | its street |
| House numbers | `housenumber` layer (not loaded yet) | a **counter per street**, not items: "Садовая: 9 of 12 houses" |
| Household of a street | ordinary houses dug | a **collection per street**, not items |
| Seeds of old varieties | `landcover` orchard / allotments / garden | farming |
| Machine parts, tools | `landuse` industrial | crafts |
| Rails, spikes, track signs | `transportation` class rail | metal / a railway theme |
| Bucket, windlass | drinking water / well POIs | its well |
| Archive page | Wikipedia articles already unlocked by digs | the place it describes |

- **Finds lead to places.** Digging a foundation turns up finds of its surroundings, including places not yet dug.
  A found sign of an unopened school marks its approximate spot: the next survey has a target.
- **Before building**: sample real tiles of several villages and towns to see which POI subclasses and land uses
  actually occur; fill the object tables for the common ones first.
  *Sampled (2026-11-10), OpenFreeMap z14, 3x3 tiles around 4 small towns, 5 villages and a city:* POIs most often are
  gates, parking, bus stops, playgrounds, cafes, christian places of worship (255), convenience shops (216), clothes
  (215), pharmacies (210), supermarkets (202), attractions, parks, restaurants, lodging, museums (143), government
  offices, kindergartens, car repair (97), banks (95), schools (83), town halls (80), post offices (62), drinking water
  (74), libraries, colleges, theatres; railway stations are rare (1), halts a few. Land: wood, grass and farmland
  dominate; commercial and industrial land uses (84 tiles' worth) and allotments (79) are common, orchards rare; every
  town tile has a housenumber layer. Object types were written for: post, railway, school, college, library, place of
  worship, pharmacy, hospital, bank, town hall, bakery, fire station, museum, theatre; other named places give a sign.

### 6.2 Three fates of a find

- **Return to its place**: the restored building or street gets its real name, "as it was" counts in full.
- **Exhibit** in a museum (6.3).
- **Put to use**: seeds raise a garden's or field's yield; a machine part studied gives craft research; a rail melted
  gives metal and is gone from the museum for good. The same keep-or-use choice as with foundations.

### 6.3 Museum: exhibitions, not storage

- **A museum is a purpose**, available on any restored building (section 2). A found old museum restored "as it was"
  as a museum gets a higher bonus; it is not required. A place without museums loses nothing.
- Halls by floor area. Each hall holds **one themed exhibition**: a street, the railway, crafts, gardens, a building.
  Themes come from shared tags of finds (place, street, domain).
- A complete exhibition gives research in its domain and attractiveness. There are fewer halls than themes, so the
  player picks what to show and changes it as finds come.

## 7. Milestones

| # | Milestone | Done when |
|---|---|---|
| RB1 (done) | Foundation sets the building | any purpose on any foundation; size from the ring; floors from height for all foundations; limits by purpose class and technology; add-a-floor upgrade; capacity rules (2.3); heating by occupied floor area; the restore order merged into construction, monument as a purpose; save migration. Tests and a pace run on a large foundation, plus a hands-on check. |
| RB2 (done) | Tiers and rewards | typical kinds back; unique detection (name, repetition, article match); recognisability per dig with thresholds; complete streets; monument mood takes the best, not the sum. |
| RB3 (done) | Two-stage excavation | survey reveals the old plan; digging per foundation and per street; the discovery moment. |
| RB4 (done) | Finds and museum | data sampling first; finds from real features; finds leading to places; return / exhibit / use; museum as a purpose with themed halls. |

RB4 notes: the catalogue of finds is derived, never stored: named places recorded by the survey (a typical object
when its class has one, else a sign), the named streets (street signs), the real features the client now reports with
the finds (garden land cover: seeds; industrial land use: machine parts; railways: rails; drinking water: a bucket;
named places in the band beyond the discs: a sign pointing there; house numbers: counted per street), and the
notebook's articles titled with a building's name (archive pages). A find is found once a dug foundation's centroid lies
within 60 m of it (of its line, for a street sign) or its own foundation is dug; a dig's notice lists what it turned up,
and a find beyond the survey says so and marks its spot on the map (the hint markers). Only the fates are stored:
returned (its building stands on its foundation, its street is restored in full, a well stands within 30 m) gives the
building its real name and lifts a typical restoration as it was to full weight; used: seeds +2 % field yield each (up to
5), machine parts +0.2 craft research weight, rails +5 tools and gone. The museum is a purpose of the «Прошлое»
category, on a foundation only (an old museum's as it was): a hall per 100 m2 of floor area (1-8), a theme per hall,
one hall per theme in the town; a complete exhibition (every known find of its theme shown, at least 3) gives 0.5
research weight in its domain and 5 % attraction (x1.5 for a museum as it was, up to 25 %), recomputed daily. The
notebook got a «Находки» tab (by theme, with return and use), the museum's panel its halls, the town panel's streets
their house numbers and household. The pace harness places a dig: the faster survey of RB3 frees its diggers sooner, so
its timeline shifted (era II day 147 instead of 132; population 100 still on day 70).

RB3 notes: the dig site is the survey, four times faster than the old dig and up to 160 m; what it records is a ghost
outline (`FoundFoundation.ghost`): dashed on the map, its kind and name hidden, no lot, still reserved ground. Digging an
outline is a site of the artel on the old ring (template `excavation`, 8 person-hours per 100 m2, the crews and levers of
construction); finished, the site goes, the foundation is dug and gives its old stone (no longer given by the survey). A
unique old building opens with a "discovery" event: the camera flies there and its card (the heritage panel) opens; a
typical one gets a short notice; an ordinary house opens quietly. Clicking an outline (with the old city shown) opens its
panel: «Раскопать», and «Всю улицу (N)» for the outlines of its old street still to order. Saves from before keep every
foundation dug.

RB2 notes: typical kinds come back as kinds of their own (shops of any class, a mall, a department store, a market, a
bank, a pharmacy, a doctor's office, a car workshop, a halt, a bus station); unlike the candidates they are no reserved
ground: zones grow on them, and a zone of the matching purpose brings them back "as it was" by itself. Tiers are derived,
never stored: a candidate is unique unless nameless or its name is carried by more than one named place of the revealed
area, and an article of the notebook with its name makes it unique whatever the count. A typical building "as it was"
adds a quarter of the research weight and no idea or chronicle chapter; a unique one becomes a landmark: a monument of
mood +2 besides its purpose (a plain monument +1; the best in reach counts). Recognisability rewards: 25 % district mood
+1, 50 % an idea, 75 % district mood +2, 100 % an idea and a chronicle chapter; the district is the dig's disc. Streets:
the client reports each named street's line (all its pieces, again when it grew); a street's houses are the foundations
whose centroid lies within 25 m of its line and no nearer another street's; done when they all carry a finished building
and built roads cover 80 % of the line (within 6 m). Its name then shows on the map with the town, outside the ruins
layer. The town panel has a "Места" tab with both. Found in the browser on Мстёра: an old street's axis runs 1-2 m from
its houses, so a road on the old line blocked their foundations; a road now blocks a foundation only with its axis
(within 0.5 m), its verge may touch the old walls.

RB1 notes: a monument is the «Памятник» tool of the «Прошлое» category (on a foundation only); the heritage panel keeps
the facts of a notable site and one button, «Восстановить как было», which places its matching purpose like any other
building. Restorations of old saves (`siteId`, `restoreMode`) load as buildings "as it was" on their foundation; a house
of an old save that holds more families than its floor area now does gets a second floor. Pace run (`PACE_WEATHER=1
PACE_FOUNDATION=1 npm run pace`, two 240 m2 foundations by the first houses, one of five floors): population 50 on day 10
(26 without them), 100 on day 66 (70); each big house fills in 1-4 days at the immigration flow. Both runs starve in
winter past ~100 residents: the bot's 12 fields are its ceiling, not the foundations.

## 7a. Checklist (2026-11-11)

Every point of sections 2-6 against the code (`src/`) and the tests that hold it. "Read as" marks an interpretation;
"departs" a value the data made different from the text above.

| § | Point | Where | Proof |
|---|---|---|---|
| 2 | any purpose on any foundation >= minArea, open ground excluded | `sim/foundationLots.ts` lotCheck, OPEN_GROUND | foundationLots.test "the player puts any purpose" |
| 2 | restoration is ordinary construction; order, panel modes gone; monument a purpose | `sim/growth.ts` placeOnFoundation, `sim/restore.ts`, tool «Памятник» | restore.test "is ordinary construction", "a monument stands only on an old foundation" |
| 2 | "as it was": full bonus, real name, chronicle line | foundationLots isAsItWas, restore.ts completeRestorations | restore.test "completion" |
| 2 | cost by floor area, at most 16 hands | foundationBuilding, buildings.ts siteCrew | foundationLots.test "a big foundation" |
| 2 | save migration (scale uncapped, restoreMode to a purpose) | `sim/save.ts` parseBuildings | restore.test "migrates a restoration ordered apart", foundationLots.test "a save from before floors" |
| 2.1 | every foundation keeps its height; old saves learn it | `map/excavation.ts`, excavation.ts recordFinds | browser: 82/82 foundations with height (Мстёра) |
| 2.1 | floors from height (departs: 3.66 m, see 2.1 note) | buildings.ts floorsOf | foundationLots.test "floors come from the old height" |
| 2.1 | floor area drives capacity, cost, heating; 50 m2 a family, no cap | buildings.ts floorArea, homesOf; production.ts heatShares | foundationLots.test (homes 10/14, heating) |
| 2.1 | missing floors as an upgrade; capacity of built floors; old height completes "as it was" | coverage.ts dailyServices, floorBlocker | foundationLots.test "regains its floors", "floors come from" |
| 2.2 | limits by purpose class and tech (departs: measured 250/400/1000, see note) | foundationLots.ts STAGES | foundationLots.test "limits the size" |
| 2.2 | "as it was" lifts the limits | sizeBlocker, plannedFloors | restore.test "another purpose keeps the size limits" |
| 2.2 | a foundation over the limit stays, with a hint | zones skip it, reserved ground; the hint on hover and in the dug foundation's panel | digging.test "a dug foundation's panel", foundationLots.test zone growth |
| 2.2 | trusses for large roofs; «Свод» fits stone halls | trusses stage; read as: a note on naming, nothing to build | — |
| 2.3 | jobs ~sqrt with a cap; storage linear; reach unchanged; heating only while lived in | buildings.ts scaledJobs, storeRoom; heatShares | foundationLots.test |
| 2.3 | immigration flow-limited, a big house fills over time | attraction.ts (unchanged) | pace run PACE_FOUNDATION: 1-4 days to fill |
| 3 | ordinary: function and recognisability | recognition.ts digShares | recognition.test |
| 3 | typical kinds back; matching purpose; small, local bonus; REPEAT | heritage.ts TYPICAL_*, WORK_TEMPLATE; restore.ts TYPICAL_SHARE; monuments.ts TYPICAL_LOCAL (land +2 within 100 m) | recognition.test "rewards by tier", "a typical building as it was makes the land … dearer" |
| 3 | unique: insight, chronicle chapter, monument effect | restore.ts landmark | recognition.test "a unique one is a landmark" |
| 3 | class, proper name, name repetition, article next to the ring | heritage.ts tierOf, articleNear (400 m; title alone for older saves) | recognition.test "tiers", "an article counts only next to the ring" |
| 4 | recognisability by area; 25/50/75/100 % rewards (mood, idea, chronicle) | recognition.ts recognise, districtMood | recognition.test "each quarter brings its reward once" |
| 4 | a street restored in full gets its name and a chronicle line | streets.ts restoreStreets; town labels | recognition.test "streets restored in full"; browser (Пионерский переулок) |
| 4 | monument mood takes the best in reach | monuments.ts monumentMoodAt | recognition.test |
| 5 | survey wide, fast, cheap: streets and ghost outlines | excavation.ts DIG, ghost flag; ruins.ts ruinGhosts | excavation.test; browser |
| 5 | dig one outline (read as: by the artel, "diggers" being the people who dig); stone, finds | digging.ts orderDig, completeExcavations | digging.test |
| 5 | dig the whole street in one go | digging.ts orderStreetDig | digging.test "a whole street" |
| 5 | discovery: outline draws itself; unique opens with a card and the camera flies; ordinary quietly | ruins.ts partialRing; toastStore discovered; Toasts.tsx | digging.test "a unique old building opens"; browser |
| 6.1 | one find per real feature, attributed, neutral wording; all ten kinds of the table | items.ts catalogue; oldworld.ts features; placesModel (numbers, household) | items.test "the catalogue", "records and counters" |
| 6.1 | finds lead to places; a sign beyond the survey marks a target | items.ts beyondSurvey; ruins.ts ruinHints | items.test "a find is found once …" |
| 6.1 | sample real tiles first | 6.1 note | — |
| 6.2 | return (real name; "as it was" in full), exhibit, use (seeds, parts, rails: read as tools, the game has no metal) | items.ts returnFind, useFind; museum.ts | items.test "fates" |
| 6.3 | museum a purpose; old museum as it was better; no loss without one | museum template, MUSEUM.asItWas | items.test "the museum" |
| 6.3 | halls by floor area, one theme each; complete exhibition: research and attraction | museum.ts hallsOf, setExhibition, exhibitionEffects, museumDaily | items.test "shows one theme a hall" |

Not done by design: section 8 (trade stays as it is until it is redesigned).

## 8. Open

- Trade: to be redesigned within this frame later; today's daily swap at the market stays until then.
