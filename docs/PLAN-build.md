# Rebirth — building without zones

Zones go away. Every building is placed by the player; houses are laid out in bulk along streets, and old foundations
are filled first. Companion to `PLAN.md` (sections 6 and 12), `PLAN-ui.md` and `PLAN-restoration.md`.

## 1. Why

- Zones hide the decision: the player paints cells and waits for demand to pick a lot. With real foundations under
  the town the player wants to say "this house goes on that ring", which a zone cannot express.
- Zones cost a whole build-bar category (housing, crafts, trade, clear zone) plus a growth advisor to explain why
  nothing grows.
- What zones did well stays: lots cut along roads, foundations taken before new ground, one gesture for many houses.

## 2. Now

| Part | Now | Where |
|---|---|---|
| Zone cells | 8 × 8 m cells along both sides of a road, up to 4 deep, painted res / craft / trade | `sim/zones.ts`, `map/zoneTool.ts` |
| Growth | one building per zone type per game hour when demand ≥ 1; foundations in the zone first, then regular lots | `sim/growth.ts` spawnBuildings, findLots, foundationLots |
| Templates grown | house, large house (res); weaving, pottery, carpentry, smithy (craft); shop, tavern (trade) | `sim/buildings.ts` |
| Placement | one building per click, snaps to a foundation under the cursor; variants (store kinds, administration) | `map/placeTool.ts`, `map/tools.ts` placeVariant |
| Foundations | dug rings are lots (any purpose, full size, floors from height, size limits by tech); ghost outlines need digging; known kinds come back "as it was" | `sim/foundationLots.ts`, `sim/digging.ts`, `sim/heritage.ts` |

## 3. Design

### 3.1 Build bar

The grown templates become placed tools with variants (the store-kind mechanism; no new button per template):

| Tool | Variants |
|---|---|
| Дом | дом, большой дом |
| Мастерская | ткацкая, гончарня, столярня, кузница |
| Лавка | магазин, таверна |

Categories: Дороги (unchanged), Город (дом, мастерская, лавка, склад, погреб), Еда (поле + the current seven: 8 keys),
Ресурсы (вырубка, лесоруб, пилорама, каменоломня), Службы, Прошлое. «Снять зону» goes; unstarted plans are removed by
«Снос». Still six categories on F1–F6.

### 3.2 Quick access

- **Pipette:** middle click (or a key) on any building or plan picks its tool and variant.
- **Search:** a key opens a line over the build bar; typing filters tools and variants by name, Enter picks.
- **Recent:** the last four tools on keys 1–4.
- **«Построить ещё»** in the building panel: the pipette as a button.

### 3.3 Mass building: the stroke

The house tool (and the workshop/shop tools, same code) places one building on click and a row on drag.

- **Drag along a built or planned road.** The stroke projects onto the nearest road edges; lots are cut along them as
  zone cells are cut now (8 m cells, frontage to the road, blocked by water, steep land, other roads, fields). Side
  by the cursor; Shift — both sides. One row deep.
- **Foundations first.** Every dug foundation whose door is within `FOUNDATION_LOT.roadReach` of the stroked edges is
  taken before any new lot, at its full ring and floors. New lots never cover a foundation or reserved ground (rule
  already in `foundationLots.ts`). Toggle **«Только по фундаментам»** (G, remembered): off — gaps between foundations
  get new houses; on — only foundations.
- **Which foundations a house takes:** ordinary ones (no known kind, or a known house). A foundation of another known
  kind (shop, church, school...) is left for its purpose and shown as such; a unique candidate stays reserved ground.
  A foundation over the size limit of the template is skipped with its reason (`sizeBlocker`).
- **Ghost outlines in the stroke** (surveyed, not dug): planned as "раскопать и построить" — a dig order
  (`orderDig`) and a house plan waiting on it; the house starts once the ring is dug.
- **Road with houses:** a toggle in the road tool (H) runs the same stroke over the new road on both sides as soon as
  it is placed.

### 3.4 Preview

What the player sees before releasing, and again after release until confirmed:

- **Every future building at its real footprint and orientation**, door to the road, drawn as the tool previews are
  now (decal outline and a light fill; the 3D ghost model where the renderer has it). One look per outcome:

  | Outcome | Look |
  |---|---|
  | new house on a new lot | plain outline, tool colour |
  | house on a dug foundation | foundation ring filled, stronger outline, floors count |
  | house "as it was" | as above plus the "as it was" mark |
  | dig, then house | dashed ring, dig mark |
  | skipped foundation | muted ring with a short reason on hover («прежде: лавка», «больше 250 м²: нужно Жильё») |

- **Summary card** by the cursor: houses on foundations / new / to dig; families housed (from `homesOf`); materials
  needed against the stock now; person-hours; finish estimate from `sim/buildEta.ts`.
- **Hover a preview building:** its own line (size, floors, families, cost, what stood there).
- **Two-step for more than one building:** release freezes the preview; click a preview building to drop or return
  it; Enter or the card's «Построить N» confirms; Esc cancels. A single click-place stays one step.
- **Undo:** Ctrl+Z removes the last confirmed stroke while none of its sites has started.

### 3.5 Simulation

- `spawnBuildings`, demand-driven growth and the per-zone `lastSpawn` go; every building is `zone: "placed"`.
- A new command places a batch of plans (templates, rings or lots, foundation ids, dig-first flags) in one message, in
  stroke order; the build queue takes them in that order. Materials are taken when work starts, as now, so a long
  stroke is a queue, not a freeze of the store.
- Families keep moving into vacant houses; arrivals keep their flow limit.
- `growthAdvice` becomes the house tool hint: families waiting for a home, free places, houses under way.
- Lot cutting moves out of zone cells into a pure function over road edges (the cell generator of `sim/zones.ts`
  reused without painting); `ZoneCell`, painting and the zone layer go.
- **Saves:** painted cells are dropped; started zone-grown sites stay as placed plans; unstarted ones stay too (they
  are concrete lots already). Save version bump with migration in `sim/save.ts`.
- **Pace harness:** the bot strokes houses along its streets (foundations first when `PACE_FOUNDATION=1`) instead of
  painting zones; targets of `PLAN-pace.md` section 2 re-checked (100 residents in ~1.5 h at 4×).

## 4. Milestones

| # | Milestone | Content |
|---|---|---|
| Z1 | Lots without zones | Pure lot cutter over road edges (from `sim/zones.ts`), foundation selection for a template along edges (from `foundationLots`), batch placement command, plans in stroke order. Tests: cutter, foundation priority, skip reasons, dig-first chain. **Done** (see Z1 notes). |
| Z2 | Stroke tool and preview | House/workshop/shop tools with variants, drag stroke, sides, «Только по фундаментам», preview looks of 3.4, summary card, freeze-and-confirm, undo. Browser check on a town with dug and ghost foundations. **Done** (see Z2 notes). |
| Z3 | Zones removed | Zone tools, painting, zone layer, `spawnBuildings`, demand growth and advisor go; save migration; goals and unlocks that named zones point to the new tools. |
| Z4 | Quick access | Pipette, search line, recent tools on 1–4, «Построить ещё»; road tool «с домами». |
| Z5 | Pace | Harness on strokes, constants re-tuned to `PLAN-pace.md` section 2. |

Z1 notes: `sim/stroke.ts` — `planStroke(state, template, spans, onlyFoundations)` is pure and gives the items in stroke
order (`lot`, `foundation`, `dig`, each with the building as it would be, for the preview) and the foundations left
alone with their reason; `applyStroke` places the items, each checked again. A span is a road edge, a side and metres
along it from node a (`to` < `from` runs backwards). The lots are the zone cells of the edge (zones stay until Z3): a
laid building paints its own cells with its class, so `reconcile` keeps it and «Снять зону» still removes an unstarted
one; `canPlace`/`canPlaceOnFoundation` no longer refuse grown templates (the single-place commands still do, in the
handler). Foundations: a known old kind of the template's class comes back as it was (a tavern stroke over an old bank
gives a shop), another class is skipped with `foundationKindText`, a notable site standing is skipped (restored from
its card), a lost one counts as ordinary. An outline becomes a dig whose site carries `then` (the template, saved);
`completeExcavations` puts the building on the ring once dug. Outlines of at least `FOUNDATION_LOT.minArea` are now
reserved ground for every regular lot, as `PLAN-restoration.md` RB3 says (the code had let lots cover them). Worker
command `placeStroke {template, spans, onlyFoundations?, drop?}`: the worker plans again and leaves out the dropped
keys, so the client sends the stroke, not the buildings. Lots need a built road, as single placement does; strokes
along planned roads wait for Z4 («дорога с домами»), together with whether such sites wait for their road. A dig
ordered by a stroke goes into the queue at once; its building joins the queue's end when the dig is done.

Z2 notes: tools «Дом» (дом / большой), «Мастерская» (ткацкая / гончарня / столярная / кузница), «Лавка» (магазин /
таверна) are place tools with variants (`map/tools.ts` STROKE_TOOLS) in a new «Город» category with the storehouse and
the cellar; the bar has seven categories (F1–F7) until Z3 drops «Зоны». `workshop` and `shop` unlock with the craft and
trade zones. `map/strokeTool.ts` runs `planStroke` on the main thread's copy of the town (the placement functions are
generic over the state, `PlaceState`); `map/strokeModel.ts` turns the dragged path into spans (samples every 4 m to the
nearest edge within 24 m, padded by half a frontage, Shift adds the other side) and sums the card. Hover previews the one
building a click puts down; a mouse click places at once; a drag (or any touch) holds the plan with the card («Построить
N» / «Отмена», Enter / Esc / right click); clicking a held building drops or returns it; G switches «Только
фундаменты» and re-plans a held row. Overlays `stroke-plan` (lot plain, foundation stronger, "as it was" in the info
ink, dig dashed amber, dropped faint) and `stroke-skip` (muted dashed rings; hover tells why). The card counts
buildings by kind, families or jobs, person-hours with digs, materials and ETA, and what the store lacks now. Undo:
`placeStroke` answers with the ids it laid; Ctrl+Z sends `cancelStroke`, which removes those still planned and unpaid,
clears their painted cells and puts a restoration back to not ordered (a demolition would mark it lost). Browser check
on Мстёра: 18 outlines along a rebuilt street planned as digs with houses, one dropped, 17 placed, undo left the one
already started, «Достроить всё» put houses on the dug rings («Стоит на старом фундаменте», 209 м², 4 families).
