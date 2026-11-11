---
name: Rebirth
description: Real Earth, real metres, a settlement built over the city that used to be there.
colors:
  bark: "#e2d2b0"
  bark-raised: "#ecdfc2"
  bark-shade: "#d3c09b"
  bark-sunk: "#c7b28c"
  tar: "#1f1a13"
  tar-soft: "#3d3427"
  pencil: "#554935"
  pencil-faint: "#8a7a5c"
  rule-soft: "#bda98a"
  rule-dotted: "#a89478"
  moss: "#2f3a2c"
  moss-deep: "#1e2619"
  moss-light: "#3e4a35"
  resin: "#c07a22"
  resin-deep: "#8f5a13"
  ok: "#3f5c33"
  ok-text: "#36502a"
  ok-fill: "#cdd6b4"
  warn: "#96660f"
  warn-text: "#6b4a08"
  warn-fill: "#ecd6a4"
  bad: "#8a2f1f"
  bad-fill: "#e0bdb2"
  info: "#2c4c63"
  info-fill: "#c3d2dc"
  shadow-deep: "rgba(12, 16, 10, 0.5)"
  shadow-soft: "rgba(12, 16, 10, 0.42)"
  vignette: "rgba(20, 26, 17, 0.82)"
  frame-bar: "#2b3624"
  frame-deep: "#10150d"
  frame-raise: "#37432c"
  frame-line: "#5d6a4e"
  control-bg: "#121722"
  text-on-frame: "#b8ab8c"
  void: "#04060c"
  on-resin: "#1a1509"
  frame-text-dim: "#c9ba9c"
  frame-sun: "#e8c67a"
  frame-moon: "#a8c0d0"
  frame-text-muted: "#8f8468"
typography:
  display:
    fontFamily: "Bitter, PT Serif, Georgia, serif"
    fontSize: "26px"
    fontWeight: 800
    lineHeight: 1.12
    letterSpacing: "-0.01em"
  body:
    fontFamily: "Golos Text, PT Sans, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.45
    letterSpacing: "0em"
  caption:
    fontFamily: "Golos Text, PT Sans, system-ui, sans-serif"
    fontSize: "12.5px"
    fontWeight: 400
    lineHeight: 1.4
  micro:
    fontFamily: "Golos Text, PT Sans, system-ui, sans-serif"
    fontSize: "11px"
    fontWeight: 700
    lineHeight: 1.3
    letterSpacing: "0.1em"
  small:
    fontFamily: "Golos Text, PT Sans, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.4
  small-plus:
    fontFamily: "Golos Text, PT Sans, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.4
  stamp:
    fontFamily: "Bitter, PT Serif, Georgia, serif"
    fontSize: "8px"
    fontWeight: 800
    lineHeight: 1.15
    letterSpacing: "0.1em"
rounded:
  none: "0px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "20px"
  xxl: "24px"
components:
  button-primary:
    backgroundColor: "{colors.tar}"
    textColor: "{colors.bark-raised}"
    rounded: "{rounded.none}"
    padding: "12px 16px"
    height: "52px"
  button-primary-disabled:
    backgroundColor: "transparent"
    textColor: "{colors.pencil}"
  chip:
    backgroundColor: "transparent"
    textColor: "{colors.tar}"
    rounded: "{rounded.none}"
    padding: "6px 11px"
  chip-pressed:
    backgroundColor: "{colors.tar}"
    textColor: "{colors.bark-raised}"
  panel:
    backgroundColor: "{colors.bark}"
    textColor: "{colors.tar}"
    rounded: "{rounded.none}"
    padding: "12px 16px"
---

## Overview

**«Береста и грамота»** — the world chosen 2026-10-31, replacing direction A «Полевой атлас». The founding screen is the first record of a settlement, scratched into birch bark and laid on the forest floor. The product's own promise — that the ground holds records — is the interface's material.

The world refuses two things: the category's dark HUD floating over a map, and the previous paper atlas, which it replaces by giving paper a body (bark, tar, moss, resin) instead of a texture-free cream.

**Scope note:** every surface is now in the world. Rebuilt: the **first-launch / founding surface** (`FoundCity.tsx`, `PlaceSearch.tsx`, `journal.css`), the **frame** (`topbar.css`, `buildbar.css`, `layout.css` — tar plates, redesigned 2026-11-03 with phone layouts), the **right slot** (`panels.css`), the **research screen** (`TechPanel.tsx`, `tech.css`), the **notebook** (`Notebook.tsx`, `notebook.css`), the **feedback layer** (`feedback.css`: toasts, event cards, map badges), **heritage** (`heritage.css`) and **admin** (`admin.css`), plus the space background and map controls in `style.css`.

## Colors

Roles, not materials: the `paper*` variables are the bark surface role (birch bark *is* paper), the `ink*` variables are the tar role.

**Surface hierarchy (three registers, never one):**
- **Ground — moss and space** (`--moss`, `--moss-deep`): the field around the settlement, and behind the globe the Earth's actual void — near-black `#04060c` with a cold glow at the planet and a sparse dust of stars, never a mossy green. Map controls sit on `#121722` so they read against both the void and the moss floor.
- **Frame — tar plates** (`--frame` `#26302b` → `--frame-deep` `#1b241f`, edge `--frame-edge`, hover `--frame-raise`, rules `--frame-line`, text `--frame-text` / `--frame-dim`): not full-width bars but separate plates laid on the field — the town plate, the ledger, the actions, the build dock, the layers and builders' tags — so the map shows between them. A plate has a lit top edge and a row of lenticels along its foot in `--frame-line`. Text is bark; the live step, tab or tool is resin with `--on-resin` text; status on tar uses `--frame-up` / `--frame-down` / `--frame-warn` / `--frame-night`. The frame is what recedes.
- **Records — bark** (`--paper*`): everything that carries reading — the founding sheet, the research spread, the inspector, the town panel, the layers panel, notes and cards.

Do not make every panel bark (the screen becomes one sheet of old paper) and do not make panels moss (they dissolve into the map and the world loses its paper). The hierarchy is the answer, not a different colour for everything.

- **Bark** `#e2d2b0` (`--paper`) carries every surface that holds text; `--paper-raised` `#ecdfc2` for the lit face of a sheet, `--paper-shade` `#d3c09b` and `--paper-sunk` `#c7b28c` for recesses and shading.
- **Tar** `#1f1a13` (`--ink`) is text and rules; `--ink-2` `#3d3427` for softened body, `--pencil` `#554935` for secondary labels.
- **Moss** `#2f3a2c` (`--moss`) is the field; `--moss-deep` `#1e2619` for tar-shaped chrome that sits on the map (task line, search buttons), `--moss-light` for raised ground.
- **Resin** `#c07a22` (`--resin`) is the single warm signal: the map marker, the seal, the one bead on a status line. It is the only accent allowed to appear without carrying a meaning class.
- **Status** pairs: ok / warn / bad / info each have `-text` and `-fill` companions. Never colour alone — status always pairs with an icon or a word.
- **Map**: land is moss (`#4e5a42`), grass `#5d6d45`, forest `#2c3a22`, water `#2b4d58`, roads worn light (`#c4b28a` path … `#b4b1a6` stone). Every map colour lives in `palette.ts` and must equal its `tokens.css` twin (`palette.test.ts`).

## Typography

- **Display — Bitter** 400 / 600 / 800. Slab serifs read as a stylus cut into bark. Headings, numbers, the primary action, the seal.
- **Body — Golos Text** 400 / 500 / 700. Interface text, labels, remarks.
- Both self-hosted through `@fontsource`, Cyrillic and Latin, no hosted font stylesheet.
- Scale: `--fs-xs` 11 → `--fs-sm` 12.5 → `--fs-md` 14 → `--fs-lg` 17 → `--fs-xl` 21 → `--fs-2xl` 26. Headings tighten to 1.12; body sets at 1.45.
- Figures are tabular everywhere (`font-variant-numeric: tabular-nums`); coordinates and measurements are set in Bitter 600 with wide tracking.

## Layout

- The map is the artifact and stays the visual centre; panels never cover it entirely and never sit in the middle of the viewport unless they are modal.
- **The in-game HUD (redesigned 2026-11-03)** is plates on the field, laid out in `layout.css`: town plate top-left, ledger in the middle, actions top-right, build dock centred at the foot, builders' tag bottom-left, warnings / layers / news in the left column. The right column belongs to the right slot (inspector, town panel, notebook): its sheet starts right under the plates, and the map controls and the notebook tag step left of an open sheet instead of hiding under it.
- **Ledger captions are never printed**: icon + number, the daily delta under the number from 1400 px; the caption and the full wording live in the tooltip and for screen readers. Below 1280 px the ledger takes its own row under the town plate and the actions.
- **Phone, portrait (≤ 640 px)**: one tar band in two rows (name and clock with the actions; speed with the ledger, which scrolls sideways and opens its notes as a full-width slip under the band); the dock spans the foot with categories as equal columns and a sideways-scrolling tray; the right slot is a bottom sheet over the dock (≤ 72 dvh); the builders' tag, credits «i» and FPS stand just above the dock.
- **Phone, landscape (height ≤ 500 px)**: one low band of plates (40 px), the dock at the foot, the right slot as a side sheet from the band to the foot. Map credits fold behind the «i» in both orientations.
- **First launch**: search slip top-left (430 px), task line directly beneath it, founding sheet bottom-left (462 px). The sheet is a flex column whose *land readout* is the only part allowed to shrink (`max-height: calc(100vh - 158px)`), so the name field and «Основать» are always visible from 390 px up.
- 4 px spacing scale; 12 px between fields inside the sheet, 16 px between groups.

## Elevation & Depth

- **No offset block shadows.** Depth is a soft, downward shadow: `--shadow-panel` `0 14px 30px rgba(12,16,10,.5)`, `--shadow-hard-sm` for small chrome.
- A torn sheet cannot cast a `box-shadow` (the clip would cut it), so the shadow lives on the parent as `filter: drop-shadow(...)`, which follows the torn outline.
- Surfaces are opaque. No translucency, no `backdrop-filter`, no glass. The only see-through thing is the map vignette over the map layer.
- One authored motion: the sheet settles into place (translate 10 px → 0, 240 ms, `cubic-bezier(.16,1,.3,1)`), disabled under `prefers-reduced-motion`.

## Shapes

- **Radius is zero.** Bark is torn, not rounded: `--radius` and `--radius-sm` are `0px`.
- Torn edges come from `clip-path` polygons with 2–3 % corner bites, never from a radius or a mask image.
- **The rule is a lenticel**, not a hairline: `--lenticel` is a row of 3 px dashes with 7 px gaps. Horizontal fact rows and list rows use it. Vertical coloured edge bars are forbidden.
- Borders are 1.5 px tar where a real boundary is needed (inputs, buttons, panels).

## Components

- **Founding sheet** (`.found` / `.found-sheet`): bark surface with horizontal fibre bands (`repeating-linear-gradient(0deg, …)` at 23 px and 9 px pitches), edge soiling at top and bottom, a stain at the upper left and lower right. Contents: heading, scratched coordinates, a tar rule, six land facts ruled by lenticels, remarks above a 2 px tar rule, name chips, the name field, the tar action.
- **Seal** (`.found-seal`): a 50 px double ring in resin-deep, rotated −8°, holding «ЗЕМЛЯ». A stamp on the record, not a label above the heading.
- **Task line** (`.found-task`): moss-deep bar, bark-raised text, one resin bead before the words. Never a coloured left border.
- **Search slip** (`.place-search`): bark field with the icon inside, then two tar square icon buttons (locate, place names). Its dropdown opens *over* the task line (`z-index: var(--z-tooltip)`); the Photon / OpenStreetMap credit is the last row of that dropdown.
- **Chip** (`.chip-btn`): outline in tar, Bitter 600; pressed inverts to tar with bark text.
- **Primary action**: tar fill, bark-raised text, Bitter 800 at 21 px, full width of the sheet. Disabled = transparent with a tar outline — an empty record line, not a faded button.
- **Town plate** (`.tb-plate`): the mark, the name (Bitter 800, flies the map home) over the date, the clock with its **day ruler** — a 66 px strip of night / morning / day / evening spans with six-hour ticks and a resin needle at the current minute — and the joined speed block.
- **Actions plate** (`.tb-end`): «Наука» shows what is studied, its percent and a resin progress line, or «простаивает» in the warning colour (an «готово» tag when a tech finished); «Город»; and one menu button (`role="menu"`, arrow keys, Esc returns focus) holding the rare actions — hide interface, hotkeys, settings, about.
- **Build dock** (`.bb-panel`): one row of categories (icon + name) is all that stays on screen; the live category opens its tray of tools above the row as one slab, a resin edge joining them; clicking the live category folds the tray (remembered). F-keys and tool keys open the tray. Tool tiles: icon and name only, shortcuts in titles, `aria-keyshortcuts` and the hotkey dialog. Touch gets no hover card; the cost line above the dock carries it.
- **Resource columns**: icon and number, separated by spacing alone — no dividers between them.
- **Layers tag** (`.layers`): a tar tag naming the live layer; open, a bark slip with two captioned groups (what the map shows / on top of the map). The live layer's legend stays under the tag while the slip is folded.
- **Builders' tag** (`.builder-tasks`): tar tag with the count; open, a bark list rises above it.
- **Right-slot sheet** (`.rs-panel`): bark under a sticky tar head (icon tile, name, status stamp and size line, close); parts are `Section`s ruled off by lenticels with Bitter titles; construction shows the share done large beside the bar; residents are rows with a locate button to follow; the actions stay pinned to the foot of the sheet.
- **Research screen** (`.tech-screen`): a full-screen bark spread over a moss scrim — era rail on the left, the era's register in the middle (available first, then the rest, rows separated by lenticels), the chosen technology's leaf on the right, the queue along the foot. Domain identity is a square swatch and a word, never a coloured side bar. A row's state is a word in a tag: изучать / идёт / в очереди / изучено / закрыто, colour only backing it up.
- **Map chrome**: MapLibre's zoom group is a tar square on the moss floor with `invert(1)` icons; the attribution is bark with square corners (it must override `.maplibregl-compact`, which ships white with a 12 px radius).

## Do's and Don'ts

- **Do** let bark carry text and moss carry the field; the contrast between them is the world.
- **Do** theme browser surfaces: `::selection` is resin on moss-deep, `caret-color` is tar, scrollbars are tar on bark.
- **Don't** reintroduce the field-atlas look: no cream `#f4eddc`, no PT Serif/Sans, no hard offset shadows, no 3 px radius.
- **Don't** add a radius, a vertical grid texture (it reads as graph paper), or a coloured side bar.
- **Don't** use resin for anything but the marker, the seal and one status bead.
- **Don't** place the FPS readout on the first-launch screen; it is a running-town overlay and it covers the sheet.
- **Do** keep every palette pair AA: `access.test.ts` enforces 4.5:1 for text and 3:1 for components across the bark surfaces, the status fills and the focus ring.
- **Do** keep Cyrillic first: this world ships in Russian now and both locales are first-class; test expanded English labels, not just the Russian copy.
- **No new raster assets** were added with this world. The existing `public/rebirth-social-preview.png` predates it and still shows the old look — regenerate it once the world covers the town view.

**Status:** the replacement is complete across every surface. Suite green (1140 tests), production build clean, and the mechanical detector returns `[]` over all stylesheets.

**Notebook (product decision, 2026-10-31):** two sections only — «История» (Wikipedia articles unlocked by digging) and «Хроника» (the town's own record). The «Находки» list was removed: the player already sees foundations and streets on the map, so repeating them in the book was noise. The badge counts articles only; entries are grouped by game year; a search field filters the active section.
