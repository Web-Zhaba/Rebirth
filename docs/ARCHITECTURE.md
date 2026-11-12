# Architecture

How the code is laid out and which way the dependencies run. The README's "Under the map" gives the big picture;
this file is the map for working in the repository. Design history lives in git (the old `docs/PLAN-*.md` files).

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

## Known cross-layer imports

Kept as they are for now; worth untangling when those files are touched:

- `engine/sky/*` reads constants from `map/clouds/` and colours from `ui/palette.ts`.
- `map/` and `view/` read colours from `ui/palette.ts` (the palette is shared by UI and map rather than owned by the UI).
- `sim/life.ts` and `sim/protocol.ts` use the trip types of `map/life.ts`.
