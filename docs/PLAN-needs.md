# Rebirth — needs and mood (design record)

Goal: hunger, fatigue, loneliness and cold must hurt before they kill. Every resident carries four personal
needs, and unmet needs and low mood feed back into work, movement, mood, births, learning, migration and
death. The town-wide `hungry` flag stays as the first alarm; it is no longer the only consequence.

Code: `src/sim/needs.ts` (all constants and factors), `src/sim/production.ts` (the daily step),
`src/sim/people.ts` (work, birth, migration, death), `src/sim/clock.ts` (artel hours),
`src/ui/NeedsBars.tsx` and the inspector/town panel. Tests: `src/sim/needs.test.ts`,
`src/sim/production.test.ts` (`producers`, `save`), `src/sim/people.test.ts`.

## 1. The four needs

Each resident has `needs?: { food, rest, social, warmth }`, each 0..100. Missing (old saves) reads as 100,
so an old town behaves as before until its first daily step.

| Need | UI | Falls | Rises |
|---|---|---|---|
| `food` | Сытость | 55 a day when the barns feed nobody, pro rata when they feed part of the need | a full day's rations restore 75: `food = food − 55 + 75 × fed`, so a fed town recovers from a shortage over several days |
| `rest` | Отдых | 2.5 per work hour (30 a normal 12-hour day, 40 in the 16-hour «страда») | the night returns a share of the remaining fatigue: 50 % in a house (+5 % at level 2), 35 % in a tent, ×0.6 in a cold house. Steady states: ≈70 in a house, 60 in the «страда», 44 in a tent, 30 in a cold house |
| `social` | Общение | 12 a day | +10 for a household with more than one member, +3 for wares, +6 for a tavern/chapel gathering, +2 for a school-age child |
| `warmth` | Тепло | 40 a day in a household without firewood | 20 a day in a house, 12 in a tent |

A baseline: a family in tents settles near 44 rest (mild fatigue) and loses 2 social a day (work and no
market/gathering); a house with firewood and a market is stable. This is deliberate: early tents are survivable but
not comfortable, and winter without firewood is an emergency.

### Proposed, not built yet

- **Чистота / вода** (a well becomes a need, not only mood): dirty water raises illness and child mortality.
- **Смысл / вера** (chapel, monuments, meaningful work): a slow need restored by heritage and by work that
  matches education; empty it and people leave a rich town that feels pointless.
- **Безопасность** (night, wolves, a healer): a household-level need restored by lamps, a healer and cleared
  forest; a raid empties it at once.
- **Уют / теснота** (residents per room, house level, neighbours): crowded houses cap rest and social instead of
  adding a fifth bar.
- Individual migration of young adults (not the whole family) when their own needs stay empty.

## 2. What an unmet need costs

| Need below | Work | Walking | Mood target | Death a day | Other |
|---|---|---|---|---|---|
| `food` | ×0.6 at 0 (starts at 70) | ×0.85 at 0 (starts at 60) | up to −12 (weight 0.4) | 2 % at 0, ×2 for under-5 and over-60, ×0.6 under a healer | `starving` event below 20, famine mood term from the food share |
| `rest` | ×0.7 at 0 (starts at 60) | ×0.85 at 0 | up to −7.5 (weight 0.25) | 0.4 % at 0 | learning factor falls with rest |
| `social` | ×0.9 at 0 (starts at 50) | — | up to −6 (weight 0.2) | — | household satisfaction feeds migration |
| `warmth` | ×0.85 at 0 (starts at 50) | ×0.9 at 0 (starts at 50) | up to −4.5 (weight 0.15) | 1.2 % at 0 | cold already halves sleep and adds the existing cold mortality |

A resident's work factor is `needWorkFactor × moodWorkFactor`, floored at 0.1. Movement is
`needMoveFactor` (floor 0.5; in practice the worst is ≈0.65), used both for `commute` in `jobsStep` and for the
walking trips on the map. A slower walk can cost a distant job: the 45-minute limit is measured at the resident's
current pace.

The mood target of a household gains `needMoodTerm(mean satisfaction)`: 0 at 100, −15 at 50, −30 at 0. It uses the
needs the day began with, so a single `dailyEconomy` call still uses the state it was called with.

## 3. What a low mood costs

`moodWorkFactor` is 1 from mood 55 up and falls to 0.6 at mood 0 (0.85 at the old leave threshold of 35).

| Effect | Where | Rule |
|---|---|---|
| Work | `produceStep`, `step` (artel hours), `forageKg`, `eveningRate` | personal mood factor multiplies the worker's hours |
| Migration | `dailyStep` emigration | below mood 35 the daily chance is `10 % × leaveRisk(satisfaction)`, up to ×1.6 at empty needs |
| Births | `dailyStep` birth | `birthYear × birthFactor(mood, satisfaction)`, floor 0.4 |
| Learning | `dailyServices` | `learnPerDay × learningFactor(mood, rest)`, floor 0.4 |
| Immigration | `dailyStep` attract | × `0.5 + 0.5 × satisfaction/100` |
| Death | `dailyStep` death | needs add their own chance a day; mood does not kill directly |
| Warnings, day summary, chronicle | `topbarModel`, `summary`, `chronicle` | starving, tired, lonely, freezing counts and the `starving` event |

The town panel's «Жители» tab shows all four averages and the average work strength; the house and workplace
inspectors show each resident's four bars, the words for what is short and, at a workplace, the personal strength.
The top-bar mood tooltip carries the same breakdown.

## 4. Balance anchors

The constants are all in `NEEDS` (`src/sim/needs.ts`). Tuning should keep these stories true:

- A fed, rested, sociable and warm resident with a neutral household (60) has **no penalty**; the whole system is
  exactly neutral at the old baseline. This is why the existing balance tests keep passing.
- One day without food is a warning; two days empty satiety. Work is then ×0.6 and the death chance 2 % a day.
- A family in tents settles near 44 rest (a mild fatigue) and loses 2 social a day; a house settles near 70 rest, and
  a market stabilises social. A cold spell without firewood empties warmth in 2.5 days and pulls rest towards 30.
- The «страда» costs 40 rest a day and settles near 60: a long spell of long days leaves people tired and low, but
  not destroyed.
- Low mood should be a slow squeeze (work, births, learning, newcomers, departures), never an instant fail state.

## 5. Save and compatibility

`needs` is optional in `Resident`. `parseNeeds` accepts only four finite numbers in 0..100; anything else (an old
save, a broken block) leaves the resident on full needs. The save version stays 4; old towns load unchanged and
begin accumulating needs from their first daily step. The `starving` flag is optional in `ProdFlags`, so the old
save shape still round-trips.
