# First launch / founding — surface brief

## Scope and mode

One surface: the first launch and founding flow (place search, the spot survey, naming, founding).
Mode: **Experience** — the real Earth is the artifact; the interface is the hand that writes on it.
Platform: web, desktop (1280–2560 wide).

## Audience and job

A solo builder who has just opened the game and does not yet have a town. Their job in one minute:
pick somewhere on Earth, understand what the land there is, name the place, and feel that a record
has begun rather than a form has been submitted.

## Constraints

- The real MapLibre map stays the visual centre; panels never cover it.
- No emoji or pictographs in `src/` (`noPictographs.test.ts`); icons come from the project's Icon set.
- WCAG AA holds for every palette pair (`access.test.ts`); the palette lives in `palette.ts` and
  must stay identical to `tokens.css` (`palette.test.ts`).
- Player copy stays Russian and is not rewritten, only re-set.
- The incumbent «Полевой атлас» look is revoked (user, 2026-10-31); do not reintroduce it.

## Direction contract

**THESIS.** The first record of a settlement, scratched into birch bark and laid on the forest
floor. It refuses the category's dark HUD floating over a map, and refuses the incumbent paper
atlas by giving paper a body — bark, tar, moss, resin.

**OWN-WORLD.** Ground is deep moss (`#2f3a2c` family); every surface that carries text is birch
bark (`#ecdfc2` → `#c7b28c`) with tar ink (`#1f1a13`); the single accent is resin amber (`#c07a22`)
for the map marker and the seal; rules are bark lenticels — rows of short horizontal dashes, never
a solid hairline; edges are torn, never rounded; no translucency, no blur, no glass, no offset
block shadows.

**STORY.** The visitor understands: this coordinate is real, the land here has a character
(forest, water, slope), and naming it opens a record. They search or click the map, read the land,
choose a name, and found.

**FIRST VIEWPORT.** 1440×900. Full-bleed dim forest-floor map with a river and a vignette. Top-left
a bark search slip with two tar icon buttons, and under it a tar task line. Bottom-left the founding
sheet, 462 px: torn left edge, coordinates scratched as its first line, a tar rule, six land facts
ruled by lenticels, one scratched remark, five bark name tags, a name field, and a full-width tar
«Основать» button. A resin ring marks the spot.

**FORM.** Grounded candidate 5 of 7 (my ordered list: 1 rings, 2 log-frame, 3 nursery, 4 peat
strata, **5 birch-bark letter**, 6 apiary, 7 tracking guide). Chosen from the dealt hand over
"Годичные кольца" (pick) and the Breton and VU challengers. Debated and won 1:1.13.
seed:0000bec66c559d35

**FINISH.** unreviewed and undocumented is unfinished; this build ends with the finish review, the
verdict, DESIGN.md, and every shipping raster carrying its provenance
