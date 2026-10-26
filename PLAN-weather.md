# Rebirth — weather plan

Companion to `PLAN.md` (section 6 simulation) and `PLAN-pace.md`. Decisions (user, 2026-10-26):

- **Source:** a deterministic climate simulation, not live data. One pure model gives the weather at any
  (lng, lat, game time) on the whole globe; the worker uses it at the town, the map uses it for clouds.
- **Effects:** crops (sowing, yield, harvest), resource extraction, construction and the artel, people and food.
- **Clouds:** own WebGL custom layer on the MapLibre globe, no new dependencies, switchable in the layer bar.
- **Strength:** realistically harsh. Bad weather can lose a season's work; the player must plan (barns, firewood).
  Risk: the 8-day spring is a knife edge for the first sowing (PLAN-pace.md P3), so the average spring field-work
  factor in a temperate climate must stay near 0.85 and the pace harness must still reach a year-1 harvest.

## 1. Model (`src/sim/weather.ts`, pure, no state, shared by worker and main thread)

Time: `t` = game minutes. The year has `YEAR_DAYS` = 32 game days. `yearFrac(t, phase)` = fraction of the year since
the northern spring equinox, `phase` shifts the epoch so that the **town's calendar spring is its physical spring**
(`phase` = 0 for a northern founding site, 0.5 for a southern one; set once at founding from the latitude).
The whole globe shares the clock, so clouds are consistent worldwide.

**Climatology** (long-term mean, no weather noise), `climate(lat, elev, frac)`:
- annual mean `T0 = 27 − 22·sin²(lat) − 14·sin⁴(lat)` °C at sea level (the first draft, `27 − 50·sin²`, gave −2 °C at 50°); seasonal half-amplitude `A = 15·|sin lat|^1.2`
  (flipped sign in the south), peak lagged 0.08 year after the solstice; lapse −6.5 °C/km of elevation.
- daily swing: ±(3 + 5·dryness) °C around the daily mean, minimum at 05:00, maximum at 15:00; clouds and rain cut it.
- moisture index `wet(lat, frac)` 0..1: ITCZ band (centre `8°·sin(2π·frac)`), wet mid-latitudes near 50°, dry
  subtropics near 28° and the poles.

**Weather** = climatology + moving systems. Value noise over a 3D domain (direction on the unit sphere, so there is
no seam or pole singularity) advected by the zonal wind (westerlies poleward of 30°, trade easterlies below, speed
about 10 m/s expressed in degrees per game day). Two octaves of big systems (about 3000 km) and one of small (about
800 km). Outputs of `weatherAt(site, t)`:

```ts
interface Weather {
  temp: number;     // °C at the site, with the daily swing and the front anomaly (±6 °C in mid-latitudes)
  cloud: number;    // 0..1 cover
  precip: number;   // mm/h, 0 unless cloud > 0.6 and wet > 0.3
  snow: boolean;    // precip falls as snow (temp < 0.5 °C)
  wind: number;     // m/s
}
```

`cloudField(lng, lat, t, seed, phase): { cloud, precip }` is the same field without the site terms (no elevation or
daily swing); the cloud layer samples it on a 256 × 128 grid. `sunDirection(t, phase)` returns the unit vector from
the Earth's centre to the subsolar point (declination `23.44°·sin(2π·frac)`, hour angle from the game clock).

**Site** (`WeatherSite`): `{ lat, lng, elev, seed, phase }`, stored in the save; `elev` is sampled from the DEM at
founding (older saves: 0 until enriched). `site === null` (tests, saves without it) means *calm*: every factor is 1,
temperature 12 °C, no cloud. This keeps old tests and the pace harness neutral until a test opts in.

## 2. State (`SimState.weather: WeatherState`)

```ts
interface WeatherState {
  site: WeatherSite | null;
  now: Weather;               // refreshed every tick
  soil: number;               // 0..1 plough-layer moisture (bucket: + rain/melt, − evaporation ~ temp & clear sky)
  snowpack: number;           // m of snow on the ground (+ snowfall at 0.0022 m of settled snow per mm of water, melts 0.004 m per °C-hour above 0; accumulation is compressed because a game winter is 11× shorter than a real one, melt keeps real-time physics)
  frozen: number;             // 0..1 ground frost depth proxy (builds below −2 °C, thaws above 2 °C)
  ice: number;                // 0..1 ice cover on water
  frost: number;              // 1 = untouched; `applyFrost(w, min)` lowers it (the effects code calls it once per night)
  gdd: number;                // growing degree-days (base 5 °C, scaled to a real year) since the last 1 March-equivalent
  stress: number;             // accumulated drought stress while the crop grows (0..1 mean once divided by growth days)
  stressDays: number;
  crop: number;               // yield potential 0..1.2 shown to the player: a projection (gdd so far + normal gdd to harvest) · water · frost, updated daily, frozen when the harvest season starts
  day: { min: number; max: number; rain: number };   // the running day, reset at 00:00
  yesterday: { min: number; max: number; rain: number };
}
```

Updated in `step` every tick by `weatherStep(s)` (pure, cheap). Founding runs a spin-up of 24 game days before day 1
so soil, snow and ice start in a plausible state.

Calibrated numbers (3-4 game years): at 50°N / 200 m the yearly snow maximum is 0.1-0.6 m, gone by game day 8 and absent
on days 17-22; 60°N 0.5-0.8 m. Soil at 50°N: mean 0.68, above 0.95 for about 1 % of the time, below 0.1 never; 35°N is dry
(mean 0.3), 5°N wet (mean 0.66, often saturated). Precipitation above 1 mm/h is about 14-19 % of spring hours at 50°N.
Pinned by the calibration test in `weather.test.ts`.

## 3. Effects (all factors in `src/sim/weather.ts` tables; ×1 for the calm state)

**Field work** (`fieldWork(w)`): rain > 1 mm/h → 0.2, light rain 0.6, snow on the ground > 5 cm or `frozen` > 0.5 → 0
(no sowing), wind storm → 0.7, heat > 33 °C → 0.8; waterlogged soil (soil > 0.95) → 0.5. Applied to `gumno` hours.

**Yield** (`crop`): `Y = heat · water · frost`.
- `heat = clamp(gdd / 1600, 0, 1)` (GDD base 5 °C accumulated from sowing start to the end of the harvest window,
  scaled by 1/YEAR_SCALE per game day so a game year equals a real one; surplus above 1 gives up to 1.1).
- `water = 1 − 0.85·meanStress`, where daily stress = `max(0, 1 − soil/0.35)` while 10 °C < temp.
- `frost`: a night below −2 °C after 20 % of the fields are sown and before the harvest window ends removes
  `min(0.6, 0.15·(−2 − min))` of the unreaped crop (once per night; replaces the random "frost" event condition).
- `expectedKg` and `remainingHours` take `crop`; reaping stays 2 kg per hour, hours scale with the expected kg.
- Wet harvest: rain halves reaping speed through `fieldWork`; grain left standing at the window's end is lost as now.

**Extraction** (`workFactor(template, w, wp)` multiplies the hours in `produceStep`):

| Template | Factors |
|---|---|
| woodcutter | storm 0.3; snowpack > 0.3 m 0.8; frozen & snow 1.15 (hauling on frozen ground); thaw mud (temp 0..4 & rain) 0.6 |
| sawpit | < −20 °C 0.85; rain 0.9 |
| quarry | rain > 1 mm/h 0.35, light rain 0.7; < −15 °C 0.5; snowpack > 0.3 m 0.4 |
| fisher | storm 0.2; `ice` > 0.5 0.35; rain 1 |
| garden | frost (temp < −1) 0; drought (soil < 0.25) 0.4; waterlogged 0.7 |
| hunter | storm 0.4; fresh snow tracks 1.3 |
| dig | frozen & < −5 °C 0.3; rain 0.7 |
| pottery / carpentry / smithy | < −10 °C 0.8 (cold hands, wet clay), heat > 33 °C 0.85 |

These multiply the existing season tables (`FOOD_RATE`), which stay as the baseline.

**Construction and the artel** (`buildFactor(w)`): rain 0.6, heavy rain (> 3 mm/h) 0.3, snowfall 0.5, storm wind
0.3, < −15 °C 0.4, > 33 °C 0.8, thaw mud on roads 0.7. Scales the artel's person-hours and the crew size in `step`.

**People and food**:
- Firewood: each household burns `FIREWOOD_M3_YEAR` = 10 m³ per real year × `YEAR_SCALE` spread over heating
  degree-days (base 12 °C): `daily = 10·YEAR_SCALE·max(0, 12 − meanTemp) / HDD_REF` (HDD_REF 2500 °C·day per real
  year). Taken from `stock.logs` at 00:00. An unheated household (logs ran out) has a mood target −12 and its
  death rate ×(1 + 0.04·max(0, −temp))`, capped at ×2; event line "Дров нет, люди мёрзнут" once per cold spell.
- Food need ×(1 + 0.01·max(0, 10 − meanTemp)), capped at +30 % (cold burns energy).
- Spoilage at 00:00: `stock.food` loses `0.0005·max(0, meanTemp − 15)·(0.5 + soilWet)` per day in the heat (barns
  halve it), and 0.001 per day in heavy wet weather outside barns; appears in the existing "пропало еды" report.
- Mood target: −4 in a storm or in extreme heat/cold for the whole day, +2 for a clear mild day (small, so the
  existing balance is not dominated).
- Events: `frost` draws when the real forecast night min < −1 during the harvest window; `flood` draws after
  heavy rain / melt when soil > 0.95 and the 3-day rain sum is high; the random weights stay for the rest.

## 4. UI

- Top bar chip: temperature and a condition word («ясно», «облачно», «дождь», «снег», «гроза/шторм» for storm
  wind), tooltip with wind, rain, soil moisture, snow, the crop estimate and what the weather costs today: field
  work, construction, firewood, the unheated, extra food need. The chip carries a warn/bad tone while the weather
  really holds the town back.
- Warnings strip: one line when field work or construction drops to 70 % or below, or when a household has no
  firewood («Дождь: стройка 60 %»).
- Town panel → «Работа»: a «Погода» block with the same factors and the current reason, visible without hovering.
- Building panel: «Работа сегодня» for a slowed workplace and «Стройка сегодня» for a site, with the reason.
- Layer bar toggle «Облака» (icon, `aria-pressed`, kept in localStorage `rebirth.clouds`, default on).
- Settings: «Шум погоды» (rain, wind, snow hush; own localStorage key `rebirth.weatherSound`, off by default,
  shares the volume slider with the UI sounds but not their on/off switch).

**On the map** (`map/weatherLayer.ts`, `map/precipLayer.ts`, `map/weatherMath.ts`): a paper-white snow veil and a
repaint of open water above it, ice on water, a faint overcast haze, a hillshade lit from the real sun, and
rain/snow particles on a 2D canvas above the map at town zoom. All are signal-driven from `weather`; the snow veil,
water, ice and haze sit under the night tint, so roads, buildings and lights keep their contrast. Layer bar toggle
«Погода на карте» (`rebirth.weatherMap`, default on) switches snow, ice, haze and particles independently of
«Облака»; the sun-lit hillshade stays.

## 5. Clouds (`src/map/cloudLayer.ts`)

**Superseded by `PLAN-clouds.md`** (volumetric ray-marched clouds on three.js, ground shadows, precipitation
shafts, lightning). The shell layer below is the current code until that plan lands.

- MapLibre custom layer, `renderingMode: "3d"`, raw WebGL2/1 as MapLibre provides it; no dependency added.
- Drawn only when zoom is below about 6 and fully faded at 6.5 (smoothstep), skipped entirely otherwise; the globe
  projection is the only case that matters at those zooms.
- Data: an RGBA8 texture 256 × 128 (lng/lat) from `cloudField`, rebuilt every 30 game minutes; the shader blends
  the previous and next texture by the fraction of the interval so fronts glide. R = cover, G = precip, B = temp
  (snow tint).
- Look: 6 thin spherical shells around the globe (altitude 1.5…10 km scaled for visibility), each thresholded by
  3D noise computed from the unit direction against the cover texture, so the cloud has depth and parallax when
  the camera tilts; shading from `sunDirection` (lit side white, night side dark blue-grey), rain clouds greyer,
  snow bluish-white; alpha soft at the edges. The sun direction uses the same clock as `gameClock`.
- The layer reads the world seed and phase from the snapshot (`weather.site`); with no site it draws nothing.
- Cost budget: texture rebuild under 3 ms, draw under 2 ms on an integrated GPU.

## 6. Work split

1. **Core** (`weather.ts`, state, save parse/validate, handler/found + elevation sampling, snapshot, tests).
2. **Effects** (production, fields, clock, people, events, tests, pace harness re-check) — sim files only.
3. **Clouds + UI** (cloud layer, layer bar, top-bar chip, icons) — map/ui files only.
2 and 3 run in parallel after 1.

## 7. Open

- Real climate normals (Open-Meteo archive) as the base instead of the analytic latitude model.
- Fire is a separate mechanic, not a weather event: the random `fire` event stays until that mechanic replaces it,
  and lightning does not start fires.
- There is no forecast by design: the player plans from the current state and the season, not from future weather.

## 8. Alternative food

A lost harvest (even the first) must be survivable. Alternatives are small on purpose: none replaces fields. Tunables: `FOOD_RATE`
(`fields.ts`), `EFFECTS` (`weatherEffects.ts`), `CELLAR_CAP` (`buildings.ts`). A work day is 12 h, an adult eats 0.7 kg/day (22 kg/year).

| Template | Site | Jobs | Labor, materials (logs/planks/stone) | Season table, kg/worker-h | Weather | Unlock |
|---|---|---|---|---|---|---|
| `forager` Сбор в лесу | forest ≥ 20 % within 150 m (sampled like the woodcutter) | 3 | 24 h, 2 / 0.5 / 0 | 0.13 × [0.3, 1, 1.4, 0] (about 4 adults a year) | rain ×0.5, storm ×0.3, snow cover > 5 cm 0 | `izbas2` (with the hunter) |
| `orchard` Сад | not water or wetland | 2 | 60 h, 4 / 0.5 / 0 | 0.8 × [0, 0, 1, 0], bears one game year after completion (`Building.ripe`), × yearly quality (5-7 adults at full quality) | rain ×0.7, storm ×0.5; quality: ≥ 3 spring nights below −1 °C −40…80 %, summer drought up to −50 %, heat days (> 33 °C) −5 % each up to −30 % | `harvest` (first harvest) |
| `apiary` Пасека | not water or wetland | 1 | 30 h, 3 / 1 / 0 | 0.3 × [0.3, 1, 0.7, 0] (honey as food equivalent, 1-2 adults) | works only at ≥ 10 °C, no rain or snow, wind ≤ 8 m/s | `pop25` |
| `cellar` Погреб | not applicable (no site rule) | 0 | 70 h, 10 / 3 / 4 | stores +10 t of food | heat spoilage −90 % on the stored share (barn −50 %), damp spoilage 0 | `izbas2` (with the barn) |

- Orchard workers are idle (join the artel, forage) when it is not autumn or the trees do not bear yet. The yearly record lives in
  `ProdState.orchard` (`OrchardYear`: spring frost nights, summer stress/hot days), counted at 00:00 for the day that ended.
- **Brushwood** (not a building): in the daily step the idle adults (the foraging pool) bring 0.03 m³ each into `stock.logs` before the
  firewood is burnt, only when a household was cold or the logs are below the day's demand; ×0.4 under snow (> 5 cm).
  `EconomyStats.brushwood` shows it. It does not count for the «logs» goal.
- **Frozen farmers**: `idleGumnos` now also treats every gumno as idle while `fieldWork(weather)` is 0 (frozen ground, snow cover),
  so the farmers join the artel and forage.
- `foodOutlook` counts forager and apiary like the fisher (today's daily output) and a bearing orchard as one autumn at the quality so far.
