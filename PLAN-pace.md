# Rebirth — pace and balance plan

Goal: the player sees and does more, the town grows several times faster, and night
stops being dead time. Companion to `PLAN.md` (simulation design) and `PLAN-ui.md`.

## 1. Diagnosis (current code)

| Area | Now | Where |
|---|---|---|
| Clock | 1 real s = 1 game min, no pause or speed control. Day = 24 real min, year (360 days) = 6 real days. | `sim/clock.ts` `MS_PER_GAME_MINUTE`, `sim/time.ts` |
| Night | Work only 07–19 (`step` skips roads, construction, production otherwise): 12 of every 24 real minutes nothing is built or made. Night shows lights only. | `sim/clock.ts:20`, `sim/roads.ts` `WORK_START/END` |
| Start | 10 founders (6 adults) in tents; stock food 1.75 t, wares 20, **no logs, planks or stone**. | `sim/people.ts` `FOUNDERS`, `sim/buildings.ts` `FOUNDING_STOCK` |
| First house | Izba 100 person-h, but with an empty stock the materials are made by hand: +100 (logs) +24 (planks) +4 (stone) = 228 person-h = 38 workday hours for 6 hands ≈ **76 real min**. The comment in `buildings.ts` intends "about one game day". | `sim/production.ts` `HAND_HOURS`, `payMaterials` |
| Construction | The artel serves roads first, then one building at a time in id order. | `sim/clock.ts`, `sim/growth.ts` `advanceBuildings` |
| Growth | Residential demand = 1.5 + 0.5 × job vacancies − vacant − unfinished + tents; one spawn per zone type per game hour, only at demand ≥ 1. Without jobs the next house waits until the last one is built **and** occupied. | `sim/growth.ts` |
| Immigration | Once a game day, per vacant house, p = 0.5 × food outlook × mood/100 → about 3–4 game days (≈ 1.5 real h) per family. | `sim/people.ts` `RATES.immigrationDay` |
| Seasons | First harvest on game day 181 = real day 3; sowing only in the first 1.5 real days. | `sim/fields.ts` |
| Decisions | No currency, unlocks, goals, events or notifications; all 18 tools from minute one. Between placements the player only waits. | `sim/protocol.ts`, `ui/RoadTools.tsx` |

Estimated result: the 4 founder houses take about 5 real hours, 10 houses 10–20 real hours.

**Baseline measured by P0** (`npm run pace`, flat site, fixed build order, speed 1×):

| Milestone | Real time | Game day | Population |
|---|---|---|---|
| First house finished | 1:21 | 4 | 10 |
| First planks in stock | 7:13 | 19 | 10 |
| 5 houses finished | 11:20 | 29 | 10 |
| 10 houses finished | — | — | — |
| Population 25 | 30:42 | 78 | 25 |
| Population 50 / 100 | — | — | — |
| First harvest | 81:49 | 205 | 25 |

After 400 game days: 9 houses, 12 residents. Population peaks at 25 around day 78 and then falls:
houses stand empty while families leave, so growth is limited by demand, immigration and
departures, not by space (a hand-built town in the browser showed the same: 10 houses, 15
residents after 80 days).

## 2. Pace targets

Measured at speed 1× by the harness (P0) with a scripted build order; tuned in P8.

| Milestone | Now (est.) | Target |
|---|---|---|
| First house finished | ~80 min | ≤ 4 min |
| First planks | — | ≤ 12 min |
| 5 houses, ~25 residents | ~6 h | ~20 min |
| First harvest | real day 3 | ~75 min (≤ 30 min at 2×–4×) |
| 10 houses | 10–20 h | ~45 min |
| 100 residents | days | 2–3 h of active play |
| Something to decide or watch finish | every 10+ min | every 30–60 s |

## 3. Milestones

| # | Milestone | Done when |
|---|---|---|
| P0 | Pacing harness | A Node script (`npm run pace`) founds a town on a synthetic flat site with forest and water, plays a fixed build order through the worker handler (roads, residential zone, woodcutter, sawpit, gumno + fields, well, dig) and prints the real time to each target in section 2. Baseline recorded in this file. **Done** (`src/pace/pace.run.ts`, `vitest.pace.config.ts`). |
| P1 | Time model | Speed controls and a short night (section 4). Pause, 1×, 2×, 4×; night 22–05 passes ×4 faster; offline catch-up unchanged in cost. Tests for the clock and catch-up. **Done**: `tickMs` and `clockAt` in `sim/clock.ts`; `step` no longer moves `realTime`, `advanceTo` spends wall time at a `Pace`; worker ticks every 250 ms and persists at most every 10 s; speed is not saved; harness: first house 0:16, 5 houses 2:13, first harvest 15:59 (game days unchanged). |
| P2 | Compressed calendar | Year of 4 × 8 days with calendar-scaled daily processes; save v4 migration (section 5). First harvest ~75 real min after founding at 1×. **Done**: `YEAR_DAYS`/`YEAR_SCALE` in `sim/time.ts`, yearly quantities scaled, `massText` for small harvests; v3 saves migrate on load and the original is kept once under the IndexedDB key `before-v4`. Harness: 10 houses 3:05, population 25 at 2:48; the harness misses the first sowing (its gumno is finished after the 8-day spring), so the first harvest is in year 2 (3:55). |
| P3 | Fast start, visible construction | Founding cart, more founders, parallel sites, growth pipeline and immigration retuned, forest clearing tool (section 6). First house ≤ 4 min in the harness. **Part A done**: 14 founders and the cart, `allocateLabor` with crews of 6, a planned house counts 1 and a started one 0.5 against demand, families on their way (`SimState.incoming`, cart from the edge of the network, «в пути» in the HUD), hand-made hours on the site panel. Harness: first house 0:07, 5 houses 1:25, 10 houses 2:35, population 50 at 3:19 (was never), first harvest 1:22 in year 1. Still slow against section 2 because hand-made logs (4 h/m³) dominate once the cart is used up; tuned in P8. **Part B done (forest clearing)**: `addClearing`/`removeClearing`, `SimState.clearings` (`sim/clearing.ts`); a crew of the artel per clearing, after the buildings while the stock holds the logs of an izba and before them when it does not (`clearingsFirst`); logs credited by labor done, finished clearings turn forest into meadow in the worker terrain, profiles and site sampling; «Вырубка» polygon tool in «Зоны», map outline with percent, HUD line; harness row «First clearing finished». Harness (clearing drawn once the gumno stands): first house 0:07, 5 houses 1:21, 10 houses 2:35, population 50 at 3:08, first clearing 1:11, first harvest 1:22, population 100 at 30:04. **Finding for P8 tuning:** the 8-day spring is a knife edge: the harness gumno stands on day 7, and any delay (a clearing drawn on day 1 took a crew) misses the sowing, moves the first harvest to year 2 (4:01) and starves growth for months. |
| P4 | Evenings and night | Evening home crafts and gatherings, the day summary, lights that show vacancy (section 7). **Done**: evening home crafts 19–22 (`sim/evening.ts`, 0.01 wares per adult-hour, ×2 in winter, shown in the wares tooltip), +3 mood target for households under a chapel or near a staffed tavern, tavern glow and evening walkers, dark vacant houses and idle workshops, «Итоги дня» at 22:00 (`sim/summary.ts`, `ui/DaySummary.tsx`, lines fly to the place), «начнут в 07:00» on queued sites and roads. |
| P5 | Player levers | Construction priority, «толока», work schedule, rations, call for settlers (section 8). **Done**: `SimState.levers` (`sim/levers.ts`, `leverCmds.ts`): priority site first in both allocation rounds, толока (all adults, production stops, 3-day cooldown), страда 05–21 with mood −8 (`workHours` replaces WORK_START/END everywhere), rations ×0.75/1/1.25 with mood −10/0/+8 in food use and outlook, призыв for 300 kg and 10 wares through `incoming`; buttons in the building panel and «Распоряжения» in the town panel. |
| P6 | Goals and unlocks | Starting tool set, goal chain with rewards that unlocks the rest (section 9). **Done**: `sim/goals.ts` (`SimState.goals`: `done`, `unlocks`, `families`, `notebook`, `feast`), checked daily and in the tick a building finishes (`goalStep`), chronicle line `goal:<id>` plus events `goal`/`unlock` (with `pos`); the sim refuses locked `placeBuilding`/`paintZones` («Откроется: <цель>») and `spawnBuildings` skips locked zones, izba upgrades wait for the `upgrade` unlock; old saves are migrated in `parseSave` (proven unlocks, met goals done silently, no save bump); build bar shows locks, `ui/GoalsTracker.tsx` lists the 3 active goals. «Вырубка» and «снять зону» are available from the start. Pace harness (sawpit after 2 izbas, craft zone after the logs goal): first house 0:07, 2 izbas 0:16, sawpit 1:35, 2 ha sown 0:36, 20 m³ logs 1:07, 5 houses 1:21, 10 houses 2:17, pop 25 at 1:56, pop 50 at 3:06, pop 100 at 10:57, first harvest 1:22. |
| P7 | Events with choices | A small event every 1–2 game days with two options; offline events auto-resolve (section 10). **Done**: `src/sim/events.ts`; `SimState.pending` (one `TownChoice` with two options and their effect text, `safe`, `until`), `nextEvent`, `eventLast` (4-day cooldown per kind); `choose{id, option}` command; events at 07-21 h, 1-2 days apart (first after 3 days, old saves too); kinds `shelter`, `cart`, `frost`, `dig`, `sick`, `feast` (the last put at once when `goals.feast` is set, which it consumes); unanswered ones resolve with the safe option after one game day, offline too, listed in `Away.choices`; outcomes go to the feed (`event` kind) and chronicle (`event:<id>`); `EventCard.tsx` mounted beside DaySummary. The trading cart has no tool bonus yet; the dig reward widens the disc (more finds) instead of granting an article directly. |
| P8 | Sim signals and tuning | The worker posts typed notices (finished, arrived, shortage, goal, event) for the UI; constants tuned until the harness meets section 2. **Signals done**: `TownEvent.pos`, kinds `built` and `shortage` (once per material per game day), positions on arrivals, move-ins, departures, farm work and clearings; HUD events with a position fly the map there; `growthAdvice` (`nozone`, `demand`, `lots`, `hands`, `materials`) in the snapshot as `people.growth`, shown under the zone tool hints. Goal, unlock and event kinds come with P6/P7. Tuning still to do. **Tuning (stopped early, partial)**: woodcutter `RATE.logs` 0.25 → 0.4, path labor 0.2 → 0.1 person-h/m, sowing runs 4 days into summer at half credit (`LATE_SOWING`, removes the spring cliff), a harvest counts as done when at most 25 % of the grain is left (`HARVEST_OK`), the artel serves workplaces before houses, a workplace finished in a tick hires at once. Harness plays like a sensible player (construction priority high, sawpit first in the queue, calls settlers, zones jobs for the jobless) and reports first planks and feed events per minute. Result: first house 0:06, sawpit 0:21, first planks 0:38, 5 houses 1:12, first harvest 1:15, pop 25 1:24, 10 houses 1:58, pop 50 2:23, pop 100 3:58; feed events 0.4–0.6 per minute. Still missed: 5 houses (target ~20 min), 10 houses (~45 min), 100 residents (2–3 h), something every 30–60 s. Next levers: cheaper houses and farm, a larger founding cart, more founders (tried: they fix most of it but need the tests reworked). |

Order: P0 → P1 → P2 → P3 → P8 signals → P4 → P5 → P6 → P7 → P8 tuning. UI work for each
milestone uses the current styles until `PLAN-ui.md` U1 lands.

## 4. P1 — time model

- **Decouple game time from wall time.** `SimState.gameMinutes` advances by
  `speed × base rate` of elapsed wall time; `realTime` stays the wall-clock anchor for offline
  catch-up. Base rate at 1×: 1 real s = 4 game min (1 game hour = 15 real s, workday 07–19 = 3 real min).
- **Speeds:** pause, 1×, 2×, 4× (Space toggles pause, 1/2/3 pick a speed). Speed is per session,
  not saved; the town starts at 1× after load.
- **Short night:** 22:00–05:00 runs ×4 on top of the chosen speed (dusk and dawn at normal speed for
  the light change). A day at 1× ≈ 3 min work + 45 s evening + 26 s night + 30 s dawn ≈ **4.7 real min**.
- **Offline:** catch-up keeps today's cost: 1 game min per real s, cap 24 real h = 60 game days. A tab
  hidden for more than 5 minutes is treated as offline (browsers throttle hidden timers anyway).
- **Ticks and snapshots:** the tick stays 10 game min; the worker runs as many ticks as the elapsed
  scaled time asks for (up to ~6 per real second at 4× at night) and posts a snapshot at most every 250 ms.
- **Visuals:** walkers and carts already move in game time; check they stay readable at 4 game
  min/s, else lower the base rate to 3 (one constant).
- Risk: every place that uses `realTime` for display must switch to `gameMinutes`.

## 5. P2 — compressed calendar

- **Season = 8 days, year = 32 days** (≈ 2.5 real h at 1×). A day stays a day: people eat,
  forage, fish and make wares per day as before, and construction stays per workday hour. Only
  what is counted **per year** shrinks with the year, by `YEAR_DAYS / 360 = 32 / 360`:
  - crop yield per ha per year (400 → ~35.6 kg/ha), so the land a family needs stays historical
    (about 2 ha per family of four);
  - field labor per ha (sowing 50 → ~4.4 h/ha, harvest 200 → ~17.8 h/ha) so the same farmers fit
    the 8-day spring and the 4-day harvest window (first half of autumn);
  - school days to literacy (720 → 2 years = 64 days); the food-outlook horizon (one year);
  - births and deaths stay annual rates, applied per day as `rate / YEAR_DAYS` (no literal 360 left).
- Ageing follows `YEAR_MIN` automatically.
- **Save v4 migration:** game time is kept as it is (the date is re-read in the new calendar, so a
  town may jump a few years ahead); resident `born` is rescaled so every age is preserved, and
  school days scale with the year.
- Offline cap of 60 game days becomes ≈ 2 years: check the away summary stays readable.

## 6. P3 — fast start and visible construction

Finding from P0: the population falls because food runs out, not for lack of space. Mood drops
below 35 only in a famine (target = 10 + 45 × fed + 10 × house + …), and immigration stops when the
food outlook falls below 90 % of a year's need. So early food (forage, fishers, the first fields) is
the real wall; the harness build order adds about 2 ha of fields per new house to play sensibly.

- **Founding party:** 14 people (4 families, 8 adults) with a cart: food 3 t, logs 60 m³, planks 8 m³,
  stone 6 t, wares 20 — enough for the first two izbas without hand-made materials. With 8 hands an izba
  (100 person-h) takes 12.5 workday hours ≈ 3.1 real min.
- **Hand-made materials stay** (they motivate the woodcutter and sawpit), but the shortfall is shown on
  the site («без досок стройка вдвое дольше»).
- **Parallel sites:** the artel works up to ⌈hands / 4⌉ sites at once, oldest first, so several frames
  rise together and the player sees progress everywhere.
- **Growth pipeline:** an unfinished house counts 0.5 against residential demand instead of 1, and
  families already on their way (see immigration below) count as demand, so the next lot starts before the last
  family has moved in.
- **Immigration:** checked every game hour as a hazard with the same daily expectation at base rate
  1.0 (was 0.5). A family that decides to come is on its way for half a game day (the HUD shows
  «в пути: N семей») and arrives as a visible cart walking in along the roads from the edge of the
  built network.
- **Forest clearing («Вырубка»):** a brush that marks forest for the artel; each cleared 100 m² gives
  logs and turns the cells into meadow (buildable). This is the deferred "clearing forest for logs"
  from `PLAN.md` section 8.

## 7. P4 — evenings and night

- **Evening 19–22, home crafts («посиделки»):** adults at home make wares at 0.01 pcs per adult-hour
  (× 2 in winter); the HUD shows it as an evening line. Wares start to matter without a workshop.
- **Gatherings:** households covered by a tavern or chapel gain mood each evening; taverns glow and draw
  walkers in the evening.
- **Day summary at 22:00:** a small card «Итоги дня»: built, arrived, born, produced, problems, each line
  clickable to fly to the place. Natural pause point; dismissed by a click or the next morning.
- **Lights tell the state:** occupied houses glow, vacant ones stay dark, workshops without inputs show
  no light, so the night map is a vacancy and problem overview.
- **Night planning:** all tools work at night; queued roads and sites show «начнут в 07:00».

## 8. P5 — player levers

| Lever | Effect | Tradeoff |
|---|---|---|
| Priority | Mark a site «в первую очередь»: the artel serves it first. | Others wait. |
| Толока | Once per 3 game days call all employed adults to one site for the rest of the workday. | Production stops for that time. |
| Распорядок | Workday 07–19 (normal) or «страда» 05–21. | +33 % work, mood −8 while active. |
| Пайки | Rations normal, reduced (−25 % food, mood −10) or generous (+25 % food, mood +8). | Food outlook and immigration change with it. |
| Призыв | Send a call for settlers: spend 300 kg food and 10 wares, a family arrives within a game day. | Needs a vacant house. |

All levers are sim commands, saved with the town, shown in the chronicle when used.

## 9. P6 — goals and unlocks

- **Starting tools:** path, road, demolish, residential zone, field, gumno, woodcutter, well, dig, plus «снять зону» and «вырубка» (clearing is the answer to log shortages, so it is not locked).
- **Unlocks by goals** (each goal shows its reward up front; three active goals at a time):

| Goal | Reward |
|---|---|
| Build 2 izbas | sawpit, barn |
| Stock 20 m³ logs | quarry, craft zone |
| Sow 2 ha | fisher, +1 family |
| Open a dig site | the notebook's first article prompt |
| 25 residents | trade zone, market |
| First harvest | chapel, a harvest feast event |
| 50 residents | school, healer |
| 5 craft buildings | izba upgrades shown on the map |

- Existing towns get every unlock their buildings already prove (migration in v4).
- Goals and unlocks live in `SimState`, are checked daily and when a building finishes, and write
  chronicle lines.

## 10. P7 — events with choices

- One event every 1–2 game days (5–10 real min at 1×), drawn by the sim RNG from those whose
  condition holds; two options, each with its effect stated.
- First set: wanderers ask for shelter (accept a family / refuse); a trading cart (swap wares or food
  for planks, stone or a tool bonus); early frost in the harvest window (draft workers to the fields /
  accept the loss); a find at the dig (spend labor to dig deeper for an article / move on); harvest feast
  (spend food for mood); a sick family (healer covers: no effect; else pay food or risk a death).
- Unanswered events auto-resolve with the safe option after one game day; offline events resolve
  that way and are listed in the away summary.
- Events, choices and outcomes are saved and written to the chronicle.

## 11. P8 — signals and tuning

- **Signals:** the worker posts typed notices (`built`, `arrived`, `left`, `shortage`, `harvest`,
  `goal`, `unlock`, `event`) with a position when there is one. `PLAN-ui.md` U5 renders them; until
  then the HUD event list shows them.
- **Growth advisor:** the sim reports why a zone does not grow (no demand, no free lots beside built
  roads, no hands, no materials), shown in the zone tool hint.
- **Tuning:** run the harness after each milestone; adjust the constants listed in section 1 until
  section 2 holds; record the final numbers in `PLAN.md` sections 8–9.

## 12. Decisions taken by default (change before P1 if needed)

- Realism gives way to pace: 32-day years, a 4.7-minute day, a ×4 night.
- Offline progress stays at today's rate (60 game days for 24 h away); speed controls affect only
  live play.
- Tools are gated by goals for new towns; existing saves keep what they have built.
