# Agent guide

How to work in this repository fast: the commands, the layer rules and where things live. `docs/ARCHITECTURE.md` is the
detailed map — read it before any cross-layer change; `PRODUCT.md` and `DESIGN.md` are the product brief and the visual
system.

## Commands

| Task | Command |
|---|---|
| Type-check | `npx tsc --noEmit` |
| All tests (154 files, ~7s) | `npx vitest run` |
| One test file | `npx vitest run <path>` |
| Balance scenario | `npm run pace` |
| Production build | `npm run build` |
| Dev server | `npm run dev` |
| Portal builds | `npm run build:portals` |

Run the touched area's tests after every change; `npx tsc --noEmit` before handing work back. Node.js 24.

## Where things live

See the module table in `docs/ARCHITECTURE.md` for the full map. The short version:

- `src/sim/` — every game rule, in a Web Worker. Pure, no DOM. `handler.ts` applies commands, `protocol.ts` is the
  message contract, `save.ts` is saves and their migrations.
- `src/ui/` — Preact components (`*.tsx`), pure view models (`*Model.ts`, unit-tested), style tokens in `tokens.css`,
  the component kit in `ui/kit/`.
- `src/view/` — the view API (`view/view.ts`); `view/engine/` and `view/layers/` implement it on `src/engine/`, the own
  WebGPU renderer, which knows nothing of the game's rules.
- `src/map/` — client-side tools and what is drawn; `src/world/` — real-world data; `src/buildings/<id>/` — everything
  about one building (rules, model, interface).
- Texts are `L(ru, en)` inline, the language fixed at start (`i18n.ts`).

## Rules the tests hold

- Layer directions are pinned by the boundary tests `buildings/boundaries.test.ts`, `sim/boundaries.test.ts` and
  `ui/boundaries.test.ts`. A new import across layers must fit their allowlists, or be agreed in
  `docs/ARCHITECTURE.md` "Known cross-layer imports" first.
- The sim worker's bundle stays free of UI, view and renderer code.
- Template ids are compared only inside `src/buildings/` (checked by test): systems ask the rules (`BUILDINGS[t].needs`,
  `.monument`, `recipeOf`...) or a system's own constant (`DIG.template`).
- Saves must load in any later version: every format change comes with a migration in `sim/saveMigrations.ts`.

## Conventions

- Logic goes into pure functions next to their tests (`foo.ts` + `foo.test.ts`); components and render code stay thin.
- Adding a building: follow "Adding a building" in `docs/ARCHITECTURE.md` — a folder under `src/buildings/<id>/`, one
  line in each of `buildings/rules.ts`, `models.ts`, `ui.ts`, a tool in `map/tools.ts`, an unlock in `sim/tech.ts`.
- Tech upgrades are variants of existing tools, not new build-bar buttons.
- Split a large file along its seams when a change touches it; keep functions pure so the tests stay cheap.

## Git

- Branches: `feature/*` → `dev` → `main`; never push day-to-day work to `main` (`docs/DEVELOPMENT.md`).
- Conventional Commits (`feat(ui): ...`, `fix(sim): ...`); `feat` bumps the minor version on release.
- CI runs `npm test` and `npm run build` on pull requests.
