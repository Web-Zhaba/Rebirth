# Plan: one folder per building

Goal: everything about one building (its numbers, its rules, its 3D model, its texts and look in the UI) lives in its
own folder, so adding or changing a building means opening that folder, and the compiler lists anything still missing.
The refactor changes no behaviour and no save format.

## Where a building lives today

One building is spread over ~20 parallel tables keyed by the template id. The smithy, for example:

| Layer | File | What it holds for the smithy |
|---|---|---|
| sim | `sim/buildings.ts` | template: name, class, lot, footprint, height, labor, crew, materials, job group |
| sim | `sim/production.ts` | `RATE.smithy`, `RATE.smithyLogs`, a `case "smithy"` in the production loop, `GOOD.smithy`, the "missing input" text |
| sim | `sim/fields.ts` | `WORKSHOP_INPUT.smithy`, `STOPS_WHEN_FULL.smithy` |
| sim | `sim/weatherEffects.ts` | `EFFECTS.shop` and a `case "smithy"` in `workFactor` |
| sim | `sim/people.ts` | `WORK_TEXT.smithy` (what a worker is called) |
| sim | `sim/chronicle.ts` | `FIRST_BUILT.smithy` |
| sim | `sim/foundationLots.ts` | size class (by absence from `STORE_CLASS` / `HALL_CLASS`) |
| map | `map/townModels.ts` | `FORMS.smithy = "workshop"`, `if (t === "smithy")` branches inside the shared `workshop()` builder, `smithYard()` |
| map | `map/smokeMath.ts` | `FURNACE` set |
| map | `map/tools.ts` | `PLACE_VARIANTS.workshop` entry (label, title) |
| ui | `ui/inspectorModel.ts` | `CRAFT` set for the icon |

Other templates add more: `TOOL_USERS` (`sim/goods.ts`), `STORES` (`sim/buildings.ts`), `SERVICE_LIST`
(`sim/services.ts`), `FOOD_RATE` (`sim/fields.ts`), placement checks in `canPlace` (`sim/growth.ts`), `SITE_RADIUS`
(`map/tools.ts`) and its copy in `map/coveragePreviewModel.ts` (400 / 150 / 100 hard-coded again), `TOOL_ICON`,
`PURPOSE`, `SITE` (`ui/buildMenu.ts`), the hints in `ui/BuildBar.tsx`, `ICONS` (`ui/icons.ts`),
`PLACED_BUILDING_COLORS` (`ui/palette.ts`), the site rows in `ui/BuildingPanel.tsx`. Nearly all of them are
`Record<string, …>`: a new template missing from one compiles and silently falls back to a default.

`map/townModels.ts` (1280 lines) mixes the shared kit (context, walls and roof, chimney, porch, lot split, fence,
barrels, crates) with 25 form builders, and the shared forms branch on template ids (`cabin` checks `tavern`,
`workshop` checks `smithy` / `pottery` / `carpentry`).

## Target layout

```
src/buildings/
  types.ts            BuildingRules, Produce, BuildingUi, TownModel — the contracts (worker-safe)
  rules.ts            registry of every rules.ts -> RULES, TemplateId          (imported by sim/)
  models.ts           registry of every model.ts -> MODELS: Record<TemplateId>  (imported by map/townModels.ts)
  ui.ts               registry of every ui.ts    -> UI: Record<TemplateId>      (imported by ui/, map/tools.ts)
  boundaries.test.ts  import rules below, and "no template branches outside src/buildings"
  smithy/
    rules.ts          numbers + rules: runs in the sim worker
    model.ts          the 3D model: main thread only
    ui.ts             icon, map colour, variant label, tool texts and hints, inspector extras
    smithy.test.ts    tests of this building (rules and model)
  izba/ izba5/ carpentry/ pottery/ weaver/ shop/ tavern/ gumno/ woodcutter/ sawpit/ quarry/ fisher/ barn/ well/
  market/ chapel/ school/ healer/ garden/ hunter/ forager/ orchard/ apiary/ cellar/ logyard/ stoneyard/ warehouse/
  townhall/ office/ dig/ museum/ excavation/ restored/
```

Why three files and not one: `rules.ts` runs in the sim worker, `model.ts` and `ui.ts` on the main thread. One file per
building would pull mesh code, Preact and the palette into the worker bundle (or the rules into a module graph with
cycles). The registries are the only places that import all folders, one per layer. A folder has only the files it
needs: `excavation/` and `restored/` have no `model.ts` (drawn by the ruins and heritage code), and their registry entry
is `null`.

Folder names are the template ids, which are save keys (`Building.template`), so `izba`, `gumno`, `sawpit` stay.
Renaming ids is a separate decision with a save migration in `sim/save.ts`; not part of this plan.

### The three files, on the smithy

```ts
// src/buildings/smithy/rules.ts
export const smithy = {
  id: "smithy",
  name: L("Кузница", "Smithy"),
  zone: "craft",
  group: "crafts",
  lot: [2, 2], footprint: [10, 8], height: 5,
  labor: 160, crew: 6, materials: [18, 2, 9],
  job: L("кузнец — Кузница", "smith — Smithy"),
  firstBuilt: L("Построена первая кузница", "The first smithy is built"),
  produce: { good: "tools", perHour: 0.015, input: { good: "logs", per: 0.05, missing: L("брёвна (на уголь)", "logs (for charcoal)") } },
  weather: workshopWeather, // shared by the four workshops
} as const satisfies BuildingRules;
```

```ts
// src/buildings/smithy/model.ts
export const smithyModel: TownModel = {
  smoke: "furnace",
  build(c) {
    const w = workshopHouse(c, { back: 0.58, stone: true, roof: TOWN_COLORS.roofPlank, darkRoof: true });
    chimney(w.house, w.roof, w.eaves, w.eaves + w.rise + 1.8, w.house.cu, w.house.cv, 1.1, shade(w.brick, 0.8));
    // the forge yard: today's smithYard()
  },
};
```

```ts
// src/buildings/smithy/ui.ts
export const smithyUi: BuildingUi = {
  icon: "craft",
  variant: { label: L("Кузница", "Smithy"), title: L("Кузница: инструменты", "Smithy: tools") },
};
```

A single-tool building (the woodcutter) also carries the tool texts in its `ui.ts`: `purpose`, `site`, `hint`, `color`.
The four group tools (house, workshop, storehouse, administration) are declared once in `ui/buildMenu.ts` with their
own texts and the ordered list of their templates (the order is the switch order; the first is the default), and
`PLACE_VARIANTS` / `toolOfTemplate` are derived from that list.

### BuildingRules (sketch)

Required: `id`, `name`, `zone`, `group`, `lot`, `footprint`, `height`, `labor`, `crew` (residents of a house, jobs
of a workplace), `materials`. Optional, each replacing a parallel table:

| Field | Replaces |
|---|---|
| `homes` | the `homes` argument of `T()` |
| `job` | `WORK_TEXT` (`sim/people.ts`) |
| `firstBuilt` | `FIRST_BUILT` (`sim/chronicle.ts`) |
| `store` | `STORES` (`sim/buildings.ts`) |
| `sizeClass: "store" \| "hall"` | `STORE_CLASS`, `HALL_CLASS` (`sim/foundationLots.ts`); absent = heated |
| `service: { name, reach, mood, color }` | `SERVICE_LIST` (`sim/services.ts`); `SERVICE_IDS` keeps its explicit order |
| `usesTools` | `TOOL_USERS` (`sim/goods.ts`) |
| `produce` | `RATE.*`, `GOOD`, `FOOD_RATE`, `WORKSHOP_INPUT`, `STOPS_WHEN_FULL`, the `missing` texts, the production `switch` |
| `weather(w)` | `EFFECTS.<template>` and the `workFactor` `switch` (`sim/weatherEffects.ts`) |
| `site: { radius, min?: { forest? \| water? }, reason }` | `SITE_RADIUS`, `PLACE_MIN`, `relationRadius`, the checks in `canPlace` |
| `dryLand` | the quarry / garden / orchard / apiary check in `canPlace` |
| `onePerTown`, `foundationOnly` | `secondHall`, the restored / museum checks in `canPlace` |

`produce` covers the recipe workplaces: an output good, a rate per worker-hour (a number, or a function of the
building and the day for the woodcutter's forest share, the food producers' season and the orchard's bearing), an
optional input (good, amount per unit, missing text). The generic loop in `production.ts` keeps today's rule for the
room check: an input-taking workplace is capped by the room for its output unless input and output share a store
group (the sawmill frees timber room as it works). The farm and the dig are not recipes: their rules say
`work: "fields"` / `work: "dig"` and the field system (`sim/fields.ts`) and excavation (`sim/excavation.ts`) keep
their logic.

What stays in `sim/`: everything generic about buildings (`floorArea`, `storeRoom`, levels and upgrades, labor
allocation, `canPlace` itself) stays in `sim/buildings.ts` / `sim/growth.ts`, reading the rules through `RULES`.
`BUILDINGS` keeps its name and shape (`Record<TemplateId, BuildingTemplate>`, built from `RULES`) so its 30 readers
change only where they read a removed table.

### Rules that keep it clean

- `*/rules.ts` imports only `buildings/types.ts`, `sim/types.ts` (types), `i18n.ts` and leaf helpers (weather
  predicates moved to a leaf `sim/weatherSigns.ts`); never `map/`, `ui/`, `view/`, `engine/`, nor a sim module that
  imports the registry (no import cycles). `*/model.ts` imports `map/` and the palette; `*/ui.ts` imports `ui/`.
  `boundaries.test.ts` checks the imports by scanning the files.
- No template-id comparison (`template === "…"`, `case "…"`, a `Record` keyed by template ids) outside
  `src/buildings/`, except the scenario in `pace/pace.run.ts` and the group-tool lists in `ui/buildMenu.ts`. Checked
  by the same test.
- The registries are typed `Record<TemplateId, …>`: a new folder registered in `rules.ts` but missing a model or a UI
  entry is a compile error, and so is a table that still lists a removed template.
- Shared model forms never check a template id: a variation is a parameter (`cabin(c, { floors: 2, plastered: 0.6 })`),
  the rest is drawn by the building's own `model.ts` after the shared part.

## Milestones

Each one is a commit on `dev` with `tsc --noEmit` and `npm test` green. Start after the current uncommitted work is
committed: the refactor touches most of the same files.

**M0. Safety net.** A test that hashes the mesh of every template (a few seeds, fronts, level 2, upgrading, tinted),
committed with today's hashes. The pace report (`npm run pace`) saved as the baseline. Both must stay identical through
M1–M5: the refactor moves code, it must not move a single vertex or a single kilogram.

**M1. Folders and rules registry.** `src/buildings/types.ts`, the 34 `rules.ts` with the numbers of today's `T(...)`
lines, `src/buildings/rules.ts` with `RULES` and `TemplateId`. `sim/buildings.ts` builds `BUILDINGS` from them.
Mechanical; nothing else changes.

**M2. Plain tables into the rules.** `job`, `firstBuilt`, `store`, `sizeClass`, `service`, `usesTools`, `site`,
`dryLand`, `onePerTown`, `foundationOnly`. Each parallel table is deleted and its readers go through `RULES`;
`coveragePreviewModel.ts` loses its hard-coded radii.

**M3. Production and weather.** `produce` and `weather` in the rules, the generic production loop, `workFactor` via the
registry, the inspector's missing-input text from `produce.input`. Gate: pace report identical, `production.test.ts`
and `weather*.test.ts` green.

**M4. Models.** Split `map/townModels.ts`: the shared kit (context, `body`, `eavesRoof`, `chimney`, `porch`, lot split,
yard frame, fence, barrel, crate, sack, haystack, log stack, pot, beam) to `map/townKit.ts`; the shared forms
(`cabin`, `workshopHouse`, `store`) to `map/townForms.ts`, without template branches; one `model.ts` per building;
`buildTownModel` stays in `map/townModels.ts` as frame + context + dispatch through `MODELS`. The smoke kind moves
from `smokeMath.ts` to the model (`smoke: "furnace"`). Each builder must draw from the seed in exactly today's order
(every `c.r()` call is a draw): the M0 mesh hashes prove it. `townModels.test.ts` splits into kit tests and the
per-building tests next to each model.

**M5. UI.** One `ui.ts` per building: icon, map colour, variant label and title, and for single-tool buildings the
purpose, site and hint texts and the inspector's site rows (forest / water around). `ui/buildMenu.ts` keeps the
categories and the four group tools; `TOOL_ICON`, `PURPOSE`, `SITE`, the hint table in `BuildBar.tsx`,
`PLACED_BUILDING_COLORS`, `PLACE_VARIANTS`, `templateIcon`'s sets and `BuildingPanel`'s template branches are derived
from `UI` or deleted.

**M6. Goods in one table** (the same problem outside buildings). Each good (food, logs, planks, stone, clothes,
dishes, furniture, tools) is spread over `GOOD_NAMES`, `TRADE_NAME`, `TRADE_LABEL`, the inspector's `OUTPUT`, `MASS`,
`LOAD`, `TRADE.value` / `keep` / `step`, `WARES_SPLIT`, `NEED_PER_PERSON`, `groupOf` / `STORE_GROUPS`, and five
literal zero stocks. One `GOODS` table in `sim/goods.ts` (worker-safe fields) plus an icon table on the UI side, and an
`emptyStock()`.

**M7. Docs and checks.** `docs/ARCHITECTURE.md` gets a "Buildings" section (the folder, the three files, the
registries, the import rules) and a checklist "Adding a building". The two boundary checks of `boundaries.test.ts`
become strict (no allow-list left but the pace scenario and the group tools). This file is deleted.

## Adding a building afterwards

1. Copy a similar folder, rename, set the numbers and the rules in `rules.ts`.
2. Add one line to each of `src/buildings/rules.ts`, `models.ts`, `ui.ts`; `tsc` reports anything still missing.
3. Put it on the build bar (a category in `ui/buildMenu.ts`, or a group tool's list) and in the tech tree
   (`unlocks` and `UNLOCK_NAME` in `sim/tech.ts`).
4. If it makes something new (a new good, a new kind of work), that is new rules in `sim/`, as today.

## Risks

- **Worker bundle and import cycles.** Guarded by `boundaries.test.ts`; check the worker chunk size in `vite build`
  after M1 and M4.
- **Behaviour drift while generalising production and weather.** Guarded by the identical pace report and the
  existing sim tests; any intended change goes in its own commit after the refactor.
- **Model drift.** Guarded by the mesh hashes; a builder that consumes the seed in another order changes every
  building of that kind on every map.
- **Scope.** ~34 folders and ~90 small files instead of a dozen large tables. Each folder is short and greppable by id;
  the generic logic (production loop, placement, levels, storage) gets smaller because the special cases move out.
