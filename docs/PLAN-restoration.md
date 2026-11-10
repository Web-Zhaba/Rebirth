# Rebirth — restoration-first gameplay (design record)

> Status: approved design (decided 2026-11-10). RB1 and RB2 done (2026-11-10); see the notes under each section and section 7.
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
| RB3 | Two-stage excavation | survey reveals the old plan; digging per foundation and per street; the discovery moment. |
| RB4 | Finds and museum | data sampling first; finds from real features; finds leading to places; return / exhibit / use; museum as a purpose with themed halls. |

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

## 8. Open

- Trade: to be redesigned within this frame later; today's daily swap at the market stays until then.
