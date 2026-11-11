# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

**Primary (confirmed 2026-10-31):** solo builders who want a living world — players of city-building
and simulation games who arrive in a desktop browser for a session of roughly one to three hours.
They want to found a settlement anywhere, watch it grow into something that feels alive, and dig
into what the ground remembers. They value depth and a world that behaves on its own rules more
than speed-running a build order.

They may play in Russian or English; both locales are first-class (see Language). Returning players
open a town exactly where they left it, so the product serves both "a long evening of
planning" and "come back to the town tomorrow".

Not yet an audience: mobile-first players, short casual sessions, and players of rival titles who
never reach the excavation loop.

## Product Purpose

Rebirth turns the real Earth into a city-building simulation. The player picks any point on the
planet; the game projects that place into a local metric world and gives a handful of families,
primitive infrastructure and one problem: **make this place survive.**

The town is simulated, not drawn: households live, work, commute on a road graph, farm on
seasons, learn, age, arrive and leave. It runs while the game is open and waits, unchanged, while
the player is away.

Beneath the new settlement lies another city — the one that used to be there. Excavation uncovers
foundations, streets and named places derived from real geography; restoring them turns the past
into infrastructure, research and memory. Progress through eras is partly built on knowing what
was already here.

**Success:** the player builds a place they can describe as *their* place, feels its life
independent of their clicks, and digs up something they did not expect.

## Positioning

**The map beneath the map.** Rebirth is the city-builder where the civilization that already
existed at these exact coordinates is the progression resource. Real latitude and longitude become
a metric world; the buried city (real footprints, real streets, real named places, real articles)
is what the player excavates and turns into monuments, working buildings, insights and eras.

What a neighbouring product could not truthfully copy:

- **Geography is the rules, not the backdrop.** The world is generated from open geographic data at
  the player's chosen coordinates; there are no handcrafted maps to copy.
- **Real scale in metres.** Road lengths, footprints, zoning, walking distances and service reach
  are metric quantities, so the shape of a settlement is always a reachable shape.
- **Real archaeology as progression.** Findings are sourced, attributed and tied to the player's
  actual spot on Earth; the same mechanic is meaningless on a fictional map.

Supporting truths (real, but not the claim): the settlement is a *graph* — services and jobs
require reachability, not radius; every resident is simulated individually and the town persists
through IndexedDB, with a chronicle of what happened.

## Operating Context

- **Desktop browser session** on a WebGL-capable machine, typically 1280×720 to 2560×1440; the
  interface is designed to keep working down to a narrow layout, but mobile is not a target.
- **Online play, local persistence.** Map, terrain, place search and article data are fetched from
  public open-data endpoints; the town itself is saved locally (IndexedDB) and lives without a
  server account.
- **Returning visits.** A town opens at the moment it was left: time away is never played back,
  so absence earns nothing.
- **Sourced material.** Findings and notebook entries are attributed (OpenStreetMap, Wikipedia,
  open terrain data); the product's factual claims about places must remain traceable.
- **Development flow.** `main` is release-only and deploys to Vercel; `dev` integrates work through
  Conventional Commits and Release Please; every change ships through `npm test` and
  `npm run build`. See `docs/DEVELOPMENT.md`.
- **Playtesting by the authors.** Balance is checked with a headless pacing harness (`npm run pace`)
  and hands-on play sessions.

## Capabilities and Constraints

Built and playable (see `docs/PLAN.md` and `docs/PLAN-research.ru.md` for the authoritative
records):

- Founding from real coordinates: Photon place search, "where am I" geolocation, and faint old
  place names.
- Rewilded Earth rendering (MapLibre GL JS + hybrid Three.js layers): terrain, forest, water,
  weather, seasons; deliberately no satellite imagery.
- Real-scale simulation in a Web Worker: free-form roads with snapping, zones, buildings from
  templates, households and individual residents, jobs and commuting, production chains, services
  with network-distance coverage, construction by a work party.
- Archaeology: dig sites reveal real OSM footprints and streets; typed finds classified from POIs;
  restore "as it was" as a monument or a working building.
- Progression: a technology tree with two eras, insights from restorations, a scarcity multiplier
  that favours find-poor places.
- Continuity: IndexedDB saves and a chronicle; no offline catch-up.
- Interface: «Полевой атлас» field-atlas direction (being replaced, see Brand Commitments), icon system, in-app dialogs, toasts, event
  cards, a day summary, a town panel, an inspector, a notebook and an "About" dialog.

Constraints and confirmed facts:

- **Language (confirmed 2026-10-31): full i18n is a committed direction.** Both Russian and English
  are first-class, switchable player locales. Player-facing text is currently Russian throughout
  (including the game's internal vocabulary, migrated on save load by `src/sim/legacyText.ts`); the
  `index.html` locale is `ru`, while the README and public descriptions are English. Existing
  Russian copy is product truth to translate, not to redesign away.
- **Release state (confirmed 2026-10-31): public alpha, in development.** The Vercel build is live
  and is the only public artifact. Saves and balance may break between versions.
- **Open source** under Apache License 2.0.
- Stack is fixed by the existing codebase: TypeScript, Preact + `@preact/signals`, MapLibre GL JS,
  Three.js, Vite, Vitest, Web Worker + IndexedDB. See `## Stack` note below.
- Deliberately out of scope for now: later eras beyond Era II, bridges and water transport,
  multiple towns, the shared world archive, accounts and server saves, sound design beyond the
  synthesized UI sounds, mobile polish.
- Explicitly undecided: launch timing, whether exploration becomes multiplayer/shared-world, and
  the final stance on mobile.

## Stack

Existing codebase (not a greenfield choice, confirmed 2026-10-31): TypeScript · Preact +
@preact/signals · MapLibre GL JS · Three.js · Vite · Vitest · Web Worker + IndexedDB. Open data:
OpenFreeMap/OpenStreetMap, Terrarium DEM (AWS Open Data), Photon (komoot), Wikipedia/MediaWiki.
Deployment: Vercel, production from `main`; licensed Apache-2.0.

## Brand Commitments

- **Name:** Rebirth. Russian player-facing text is Russian; README and public metadata English.
- **Tagline / voice:** "Civilization is gone. The coordinates survived." — restrained, factual,
  historical; no invented lore and no explanation of why the world is empty. The README voice is
  declarative and short-sentenced; player text uses universal terms (see the glossary in
  `docs/PLAN-ui.md`), not jargon.
- **Visual world: replaced, in progress (revoked by the user 2026-10-31).** Direction A «Полевой
  атлас» (surveyor's field book and printed atlas: opaque paper surfaces, ink rules, hard offset
  shadows, PT Serif + PT Sans, game-icons.net + Phosphor) was the U0 choice of 2026-10-25 and is no
  longer binding. The user asked for a full rework of palette and UI; the old look is now evidence
  and anti-reference only. Whatever replaces it becomes binding once recorded in DESIGN.md at the
  end of the replacement run — do not reintroduce the field-atlas look by default.
- **Still binding regardless of the new world:** no emoji or pictographs in `src/` (enforced by
  `noPictographs.test.ts`); icon sets must keep their licences and credits; the name, tagline and
  voice above.
- **Assets:** `public/rebirth-icon.svg` (game mark), `public/rebirth-social-preview.png` (social
  preview).
- **Attribution commitments:** OpenStreetMap/OpenFreeMap, Mapzen/AWS terrain, Photon, Wikipedia
  CC BY-SA 4.0, game-icons.net CC BY 3.0, Phosphor MIT, PT fonts OFL. Recorded in `CREDITS.md` and
  shown in the in-app «Об игре» dialog.

## Evidence on Hand

- **Live deployment:** https://rebirth-ashy.vercel.app/ — the public artifact.
- **Authors' own play sessions on localhost:** real gameplay observations, saves and verification
  data (e.g. the save with 12 buildings and 41 residents used for the U-milestone verification in
  `docs/PLAN-ui.md`).
- **Headless pacing harness output** (`npm run pace`): recorded milestones (first house, first
  planks, N houses, first harvest, population growth, Era II) — the project's balance evidence.
- **Open, test-covered codebase:** 600+ tests including contrast, focus, no-pictograph and
  hotkey-coverage checks; the plans in `docs/` are the sourced design record.
- **Absences future work must not fabricate:** no user testimonials or quotes, no named external
  playtesters, no press coverage, no benchmarks against other games, no pricing, no player counts,
  no download numbers. Gameplay screenshots are marked `PREVIEW PENDING` in the README and must
  not be replaced by mock imagery presented as the game.

## Product Principles

1. **The ground is the game.** Real coordinates, real data and real metres are the rules engine,
   not decoration; any feature that could work on a fictional map is optional, any that cannot is
   core.
2. **The simulation is not the interface.** Simulation lives outside the interface, in a worker; the
   UI is a view of the world, never the world itself. Time passes only while the game is open.
3. **The past is a resource.** Excavation, restoration and research make heritage materially useful;
   progress is partly earned by learning what was already here.
4. **Reachability over radius.** Distance is measured along real networks and real routes; a badly
   connected settlement is badly connected, and the product says so plainly.
5. **Sourced and attributed.** Facts about the world — places, articles, data — stay traceable to
   their open-data sources; nothing about real geography is invented.

## Accessibility & Inclusion

No separate product-specific accessibility standard beyond the shipped commitments. The
implementation already commits to WCAG AA contrast for palette pairs, visible focus, labelled icon
buttons, keyboard reach for every control, roving arrow keys in tabs, and reduced-motion respect
(enforced in `src/ui/access.test.ts` and `layout.css`); these are confirmed as binding and future
work must not regress them. A bilingual (ru/en) player base means text expansion and long
translated labels are a standing layout constraint.
