# Rebirth — interface plan

Goal: no emoji, one proper icon system, a deliberate visual style (not glassmorphism: no
translucent or blurred surfaces), and UI/UX that makes the town's state and the next action obvious.
Companion to `PLAN.md` and `PLAN-pace.md`.

## 1. Current state

| Area | Now | Where |
|---|---|---|
| Emoji and symbols | One emoji: 📖 on the notebook button. Pictographs ◉ ≡ ▫ as notebook entry icons, × as the close button. Tools have colored squares instead of icons. | `ui/Notebook.tsx:24,45`, `ui/BuildingPanel.tsx:123`, `ui/RoadTools.tsx:89` |
| Surfaces | Cream panels `rgba(255,252,240,0.88)` and `0.92`, soft blurred shadow `0 4px 16px`, 12 px radius. No `backdrop-filter`. | `style.css:24-30, 315`, `ui/notebook.css` |
| Tokens | None: hex and rgba values hard-coded across `style.css` (488 lines) and `notebook.css`. No theme, no `@media` rules. | `style.css` |
| Type | System font stack, no webfont, no tabular figures. | `style.css:8` |
| HUD | Top-left text block: date, population, jobs, food, materials, mood, literacy, a layers `<select>`, «Подробнее» and «События» `<details>`, «Начать заново» link. Numbers are run-on text lines. | `ui/Hud.tsx` |
| Build menu | Bottom panel, 20 text buttons in 4 rows, hint line on top. No costs, requirements or effects before placing; no hotkeys to pick a tool. | `ui/RoadTools.tsx` |
| Inspector | Right panel with status, workers, production, coverage, demolish. | `ui/BuildingPanel.tsx` |
| Feedback | Native `confirm()` for reset; native `title` tooltips; no notifications; errors flash in the tool hint. | `ui/Hud.tsx:25`, tool modules |
| Access | Color-only signals (demand bars, traffic ramp, low food), small close and link targets, no focus styles, no small-screen layout. | — |

## 2. Style direction (decided in U0)

**Chosen: A. «Полевой атлас»** (user's pick, 2026-10-25). B and C below are kept for reference only.

All three share the hard rules: opaque surfaces only, no `backdrop-filter`, no blurred shadows
(borders or a hard 1–2 px offset shadow instead), one accent per meaning, numbers in tabular figures.

| | A. «Полевой атлас» (recommended) | B. «Плоская мастерская» | C. «Тёмный кабинет» |
|---|---|---|---|
| Idea | Surveyor's field book and printed atlas: paper, ink, stamps. Matches the excavation, notebook and chronicle. | Flat modern builder (Mini Motorways, Islanders): solid shapes, bold category colors. | Dark opaque instrument panel (Manor Lords, Against the Storm), warm light text. |
| Surfaces | Opaque paper `#F4EDDC`, ink rules 1.5 px, hard offset shadow | Solid off-white, no borders, chunky radius | Opaque charcoal `#1F1D1A`, thin warm borders |
| Type | PT Serif (titles, numbers) + PT Sans (body) | Golos Text | PT Sans + PT Sans Narrow |
| Icons | game-icons.net, solid ink | Phosphor Fill, colored | game-icons.net, light on dark |
| Risk | Can look old-fashioned if overdone | Generic | Heavy over the pale daytime map |

## 3. Assets

| Asset | Use | License | How |
|---|---|---|---|
| [game-icons.net](https://game-icons.net) via `@iconify-json/game-icons` (4 100+ SVG) | World things: wheat, log, planks, stone, wares, food, izba, barn, axe, saw, pickaxe, fish, well, chapel, school, healer, shovel, family, tent | CC BY 3.0, credit Lorc, Delapouite and contributors | Build-time icons |
| [Phosphor](https://phosphoricons.com) via `@iconify-json/ph` | Interface: play, pause, fast-forward, close, layers, book, bell, info, warning, chevrons, settings | MIT | Build-time icons |
| `unplugin-icons` (Vite plugin) | Compiles `~icons/<set>/<name>` imports into Preact components at build time: only used icons ship, no runtime, `currentColor` | MIT | dev dependency |
| PT Serif, PT Sans / Golos Text via `@fontsource/*` | UI fonts with full Cyrillic, self-hosted (works offline, no Google CDN) | OFL | dependency, 400 and 700 only |
| Kenney Interface Sounds (optional, U9) | Click, place, finished | CC0 | files in `public/sfx` |

Not used: raster UI kits (Kenney UI Pack, itch.io panel packs). Their 9-slice PNGs blur on HiDPI and
clash with the vector map; the same panels are a few lines of CSS. Credits for icons, fonts and map
data go into an «Об игре» dialog (U6).

## 4. Milestones

| # | Milestone | Done when |
|---|---|---|
| U0 | Style board | A static page with the same four screens (top bar, build bar, building inspector, notebook) in directions A, B and C over a real map screenshot, published for review. The user picks one; the choice is recorded in section 2. **Done**: board published (claude.ai artifact «Rebirth — доска стилей»); the user chose A «Полевой атлас». |
| U1 | Foundations | Design tokens as CSS custom properties (colors, type scale, 4 px spacing, radii, borders, shadows, z-layers); fonts; the icon pipeline and an `Icon` component; base components (Panel, Button, IconButton, Tooltip, Stat, Tabs, Dialog, ProgressBar). Every panel opaque; 📖 ◉ ≡ ▫ × replaced by icons; a unit test fails on any emoji or pictograph in `src/`. **Done**: tokens in `src/ui/tokens.css` (paper/ink/rule palette, ok/warn/bad/info, 4 px spacing, hard offset shadows, z-layers), PT Serif + PT Sans via @fontsource, `unplugin-icons` (`vite.config.ts`, Preact JSX runtime set for esbuild) with `src/ui/icons.ts` and `Icon`, kit in `src/ui/kit/` (not yet used by screens), current UI reskinned and opaque, tool buttons with icons, `noPictographs.test.ts`, `CREDITS.md`. Left: the `<dialog>` backdrop scrim (U5) and the night tint (U7). |
| U2 | Top bar | City, date with a day-phase icon, speed controls (`PLAN-pace.md` P1), population, food with days left, logs, planks, stone, wares, mood — each an icon + tabular number + daily delta; tooltip with the breakdown. Layers become an icon button group with a legend. Warnings as icon + text, never color alone. **Done**: `TopBar.tsx` (date with day phase, speed, resources with tooltips and daily production deltas from `economy.yesterday`, food net), warnings as icon chips, `LayerBar.tsx` (icon buttons and legends, colors shared with the map via `OVERLAY_COLORS`), the rest of the HUD in `TownPanel.tsx` until U4. |
| U3 | Build bar | Category tabs (Дороги, Зоны, Хозяйство, Службы, Прошлое) with icon buttons; hover card with name, purpose, labor, materials, jobs, site rule and reach; locked items show their goal (P6). Hotkeys: F1–F5 categories (1–3 and P/Space already set the speed, P1), Q–Y items, B demolish, Esc. Placement shows cost and ETA next to the cursor and tints invalid spots. **Done**: `BuildBar.tsx` with category tabs (F1–F5), items on Q–Y, B demolish, hover cards from the sim constants (`buildMenu.ts`), cost and ETA next to the cursor (`buildEta.ts`, work hours, night and speed included; the queue ahead is ignored); `RoadTools.tsx` removed. Locked items come with P6. |
| U4 | Inspector and town panel | Building inspector: icon, name, status chip, construction progress with ETA, workers, output, actions (priority, «толока», demolish with an in-app confirm). Town panel (today's «Подробнее»): tabs for people, jobs and demand, services coverage, events. **Done**: one right slot (`panels.ts`) for the inspector, the town panel and the notebook, Esc closes it; building and clearing inspectors with status chip, progress and ETA, workers, residents, output, priority, толока and demolish behind an in-app `Confirm`; town panel with tabs Жители, Работа и спрос, Службы, События, Распоряжения, opened from «Город» in the top bar; no `confirm()` left. |
| U5 | Feedback layer | Toasts from the sim signals (P8), clickable to fly to the place; event cards (P7); goals tracker (P6); day summary (P4); in-app dialogs instead of `confirm()`; map badges over buildings (no workers, no inputs, % built). |
| U6 | Notebook, away screen, founding, credits | Journal-styled notebook and «Пока вас не было», founding card with land info and name suggestions, «Об игре» dialog with all attributions. **Done**: field-book notebook, away card from `sim/away.ts` with current worries, founding card with land, slope and shares around the spot and name suggestions (`foundModel.ts`), «Об игре» dialog (`AboutDialog.tsx`) from `CREDITS.md`. |
| U7 | Map in the same palette | Zone, building, overlay and night-tint colors taken from the tokens; legends for every overlay. |
| U8 | Access and layout | WCAG AA contrast, visible focus, keyboard reach for every control, labels on icon buttons, reduced motion; layout checked at 1280×720, 1920×1080 and 2560×1440; panels collapse below 1100 px. |
| U9 | Sound (optional) | UI sounds from Kenney Interface Sounds, off by default, volume in settings. |

Order with the pace plan: U0 first (it needs the user's choice), then P0–P3, U1–U3, P4–P7, U4–U6,
P8 tuning, U7–U8.

## 5. Layout target

- **Top bar** (full width, one row): city and date left, speed in the middle, resources right.
- **Left:** goals tracker (collapsible), toasts stack below it.
- **Bottom centre:** build bar with category tabs; the hint and cost line sits above it.
- **Right:** one panel slot shared by the building inspector, the town panel and the notebook.
- **Centre:** event cards, day summary and dialogs (modal only when a choice is required).

## 6. Verification

Each milestone: `npm test`, `npm run build`, screenshots at the three sizes in the browser preview,
and a check that the player's save is untouched (backup and restore IndexedDB, as before).
