# Architecture

How the code is laid out and which way the dependencies run. The README's "Under the map" gives the big picture;
this file is the map for working in the repository. Design history lives in git (the old `docs/PLAN-*.md` files; the
last, `docs/PLAN-buildings.md`, one folder per building, was finished on 2026-11-16).

## Repository

| Path | What it holds |
|---|---|
| `src/` | The game (TypeScript, Preact, WebGPU). |
| `index.html` | The game page; entry `src/boot.ts`. |
| `dev/` | Dev-only pages, not part of the build: `dev/villagers.html` previews the resident figures. |
| `public/` | Static files copied as they are (icon, social preview). |
| `env/` | Per-portal build settings, `env/.env.<portal>`, read by `vite build --mode <portal>`. |
| `scripts/` | `build-portals.mjs` (every portal build), `pack.mjs` (archive checks and zips), `bake-biomes.mjs` (bakes `src/world/biomes.png`). |
| `release/` | Output of `npm run build:portals` (ignored): `release/<portal>/` and `release/rebirth-<portal>.zip`. |
| `dist/` | Output of `npm run build`, the site build Vercel serves (ignored). |
| `docs/` | This file, `DEVELOPMENT.md` (branches, releases, publishing), `ROADMAP.md` (open work). |
| `PRODUCT.md`, `DESIGN.md` | Product brief and visual design system. |
| `.claude/`, `.github/agents`, `.github/skills`, `.github/hooks`, `.impeccable/` | Agent tooling: skills, agents, the dev benchmark (`.claude/bench.js`), preview servers (`.claude/launch.json`). |

## Source modules

```
boot.ts ─► platform/ (portal SDK) ─► main.ts
                                      │
             ┌────────────────────────┼─────────────────────────┐
             ▼                        ▼                         ▼
          ui/ (Preact)          view/ (View API)           simClient.ts
             │                        │                         │ postMessage
             │                        ▼                         ▼
             │                  view/engine/ ─► engine/     sim/worker.ts ─► sim/handler.ts
             │                  view/layers/                    (the rules, in a Web Worker)
             └──────► map/ (tools, model geometry) ◄──┘
                      world/ (real-world data: tiles, DEM, places, Wikipedia, biomes)
```

| Module | Owns |
|---|---|
| `boot.ts`, `main.ts` | Start-up: the portal SDK first (it sets the language), then the engine, the UI and the sim worker. |
| `platform/` | One adapter per portal (Yandex, CrazyGames, Poki, VK, GameDistribution, GamePix), picked at build time by `VITE_PLATFORM`; the standalone build has none. |
| `buildings/` | One folder per building (`buildings/<id>/`): its rules (`rules.ts`, run in the sim worker), its 3D model (`model.ts`) and its interface (`ui.ts`), listed by one registry per layer. See "Buildings" below. |
| `sim/` | Every game rule: residents and households, roads, buildings, production, storages, fields, weather, research, excavation, heritage, museums, saves (IndexedDB) and save migrations. Runs in `sim/worker.ts`; `sim/handler.ts` applies commands and builds snapshots; `sim/protocol.ts` is the message contract. Pure and testable: no DOM, no renderer. |
| `simClient.ts` | The main thread's side of the worker: sends commands, keeps the latest snapshot in signals for the UI and the view. |
| `engine/` | The own WebGPU renderer: globe camera, LOD terrain, vector map streaming and baking, sky, clouds, water, shadows, overlays, picking. Knows nothing of the game's rules. `engine/debug/` holds dev-page helpers. |
| `view/` | The game's window onto the world: `view/view.ts` is the API that UI and tools use; `view/engine/` implements it on the engine (forest, fields, models, residents, weather, labels); `view/layers/` turns sim snapshots into drawable layers. |
| `map/` | Client-side game tools (roads, strokes, land, placement, reveal) and the geometry of what is drawn: town, road, tree, ruin and resident models; the cloud model (`map/clouds/`) shared by the engine and the view. |
| `world/` | Real-world inputs: tile and DEM fetching, the local metric frame, place search, Wikipedia articles, old streets and buildings from OpenStreetMap, biomes, site sampling. |
| `ui/` | Preact components (`*.tsx`), their pure view models (`*Model.ts`, unit-tested), styles (`*.css`, tokens in `tokens.css`) and the component kit (`ui/kit/`). |
| `pace/` | The balance harness (`npm run pace`): a headless town played through the real handler. |
| `i18n.ts` | `L(ru, en)`: every text in both languages, the language fixed at start. |

## Rules of thumb

- Game state lives in the worker. The main thread renders snapshots and asks focused queries; it never decides a rule.
- UI and tools talk to `view/view.ts`, never to `engine/` directly.
- Logic goes into pure functions next to their tests (`foo.ts` + `foo.test.ts`); components and render code stay thin.
- Tech upgrades are variants of existing tools, not new build-bar buttons.
- Saves must load in any later version: each format change comes with a migration in `sim/save.ts`.

## Buildings

Everything about one building lives in `src/buildings/<id>/`, where `<id>` is its template id (a save key: `izba`,
`gumno`, `sawpit` stay as they are; renaming one needs a migration in `sim/save.ts`).

| File | Holds | Runs in | Listed by |
|---|---|---|---|
| `rules.ts` | Name, class, lot, size, labor, crew, materials, and the optional parts (`BuildingRules` in `buildings/types.ts`): job title, chronicle line, store room, size class, service, tool wear, reach and the forest or water it needs, dry land, one per town, foundation only, food keeping, what it makes (`produce`: a recipe or the fields' harvest), its weather, and the roles systems look for (a work site, a monument, evening guests, school seats, trade, water). | sim worker | `buildings/rules.ts` (`RULES`, `TemplateId`) |
| `model.ts` | Its 3D model: `build(c)` on the shared kit (`map/townKit.ts`) and forms (`map/townForms.ts`), or `whole(...)` for a model made elsewhere (the temple), plus its smoke and how it sits on the ground. | main thread | `buildings/models.ts` (`MODELS`) |
| `ui.ts` | Its inspector icon, its kind's label on a group tool, or its own build-bar tool: icon, map colour, purpose, site, reach, placing hint (`BuildingUi` in `buildings/uiKit.ts`). | main thread | `buildings/ui.ts` (`UI`) |

The sim reads a building through `BUILDINGS` (`sim/buildings.ts`), built from `RULES`; the generic parts of the
building system (floor area, levels and upgrades, storage, labor allocation, placement, the production loop) stay in
`sim/` and ask the rules instead of comparing template ids. `buildings/boundaries.test.ts` keeps it so: the rules
import only leaf modules (`i18n.ts`, `buildings/types.ts`, `buildings/workshop.ts`, `sim/weatherSigns.ts`; types from
anywhere but map, ui, view, engine and world), every building is reachable from the build bar, and no code outside
`src/buildings/` compares a template id (only the balance scenario in `src/pace/` names buildings): it asks the rules
(`needs`, `monument`, `evenings`, `seats`, `isFarm`, `recipeOf`...) or, for a system's own site, the system's
constant (`DIG.template`, `MUSEUM.template`). Nor does it switch on template ids or keep a list or a table keyed by
them: the lists left are of tools and unlocks (`map/tools.ts`, `ui/buildMenu.ts`, `sim/tech.ts`) and the services in
the order of their coverage bits (`sim/services.ts`). `buildings/meshes.test.ts` pins
the mesh of every model: a change meant to alter how a building looks updates its snapshot.

The goods of the stock have one row each in `GOOD_INFO` (`sim/goods.ts`): names, unit, store group, mass, cart load,
trade value and the household need.

### Adding a building

1. Copy the folder of a similar building to `src/buildings/<id>/` and set its numbers and rules in `rules.ts`, its model
   in `model.ts` (or none: it is drawn as a log house), its interface in `ui.ts`.
2. Add one line to each of `buildings/rules.ts`, `buildings/models.ts` and `buildings/ui.ts`; `tsc` reports a registry
   that misses it.
3. Put it on the build bar: its tool in `PlaceTool` / `PLACE_TOOLS` (`map/tools.ts`) and in a category
   (`ui/buildMenu.ts`), or as a kind of a group tool (`PLACE_KINDS` in `map/tools.ts`); new eras prefer a kind over a
   new tool.
4. Open it in the tech tree: `unlocks` and `UNLOCK_NAME` in `sim/tech.ts`. A new icon goes into the icon library
   (`ui/icons.ts`), keyed by its name.
5. Something new to make or a new kind of work is a new rule in `sim/`, as before; a new look of the snapshot
   `npx vitest run -u src/buildings/meshes.test.ts` in the same commit.

## Known cross-layer imports

Kept as they are for now; worth untangling when those files are touched:

- `engine/sky/*` reads constants from `map/clouds/` and colours from `ui/palette.ts`.
- `map/` and `view/` read colours from `ui/palette.ts` (the palette is shared by UI and map rather than owned by the UI).
- `sim/life.ts` and `sim/protocol.ts` use the trip types of `map/life.ts`.
- `buildings/` spans the layers on purpose: a building's `model.ts` imports `map/`, its `ui.ts` `ui/` and `sim/`; only its
  `rules.ts` is held to the worker's leaf imports.
