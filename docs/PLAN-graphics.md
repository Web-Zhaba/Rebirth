# Rebirth — graphics update plan

Goal (2026-11-11): the town should read better up close and from afar without leaving the low-poly paper-atlas
style. Four asks: levels of detail that step down later, better light and shadows, better resident figures, better
buildings. Budget stays the one of `PLAN-engine.md`: 60 fps on a laptop's integrated GPU.

## What exists

- **Light:** the ground is lit in linear space (`terrain.wgsl`: white sun + blue sky fill, tone-mapped). Models,
  figures, trees and fields are lit in display space by one scalar ramp `mix(0.55, 1, N·L · shadow)` and a faint
  ink-blue cast in shadow (`shadow.wgsl shadowInk`). No sky/ground ambient colour, no warm low sun.
- **Shadows:** one local map (`PLAN-shadows.md`), radius 200/400/800 m, gone above 1200 m of camera height.
  Buildings, ruins, near trees and the ground cast; residents do not.
- **Levels of detail:** trees are models within 450 m and impostors beyond, thinned to 80k, shown from zoom 13.6;
  residents are figures from zoom 17.5 and only within 0.8 screens of the camera target, dots otherwise.
- **Residents:** a capsule for body and legs, ball hands and feet (`map/villagerModel.ts`), ~800 vertices
  rewritten on the CPU every frame.
- **Buildings:** `map/townModels.ts` + `map/modelGeometry.ts`: boxes, roofs and props; windows, doors and plank
  seams are painted by the shader from facade codes.

## Milestones

Each one ends with tests, a build and screenshots in the preview, and is committed on its own.

### G1 — softer levels of detail

- Forest: models to 700 m (was 450), details to 120 m (60), budget 120k trees (80k), shown from zoom 13 (13.6).
- Residents: a figure wherever it would be at least ~5 px tall on screen (per resident, by its distance to the
  eye), not by the map's zoom and a circle around the target; nearest first, capped by a vertex budget.
- Shadows: kept to 2600 m of camera height on the high preset (a 1600 m map step), low preset as before.
- Smoke from zoom 15 and to 900 m.

### G2 — light

- One shared `modelLight` (WGSL chunk) for buildings, roads, figures, trees and fields: a cool sky fill from above,
  a warm bounce from below, a sun that warms towards the horizon; shadows keep their ink-blue.
- The ground's sun gets the same warmth, so the town and the land agree at dawn and dusk.
- Cheap occlusion painted by the building shader: under the eaves, at the foot of walls.

### G3 — shadows

- The 3×3 PCF weighted as a tent, so an edge ramps evenly.
- Residents get a soft contact shadow stretched away from the sun (a blended ellipse on the ground, following its
  slope): on 20–40 cm texels a figure in the shadow map would be two texels wide and swim as it walks.
- Not done: a 100 m map step for close-ups. A tilted close view sees ground well past 100 m, where the shadows
  would then end; it needs a second cascade, not a smaller map.

### G4 — residents

- Separate legs and arms that swing, shoulders and a neck, hats and aprons by trade/age; still a few hundred
  flat-shaded triangles. A simpler rig for the far ones (the vertex budget of G1).

### G5 — buildings

- Painted by the shader (`townMesh.wgsl`): panes that darken up into the lintel's shade, two glazing bars, a
  deeper sill; they go once thinner than a pixel.
- Geometry: a collar under every chimney's top, the logs' ends as posts at a log house's corners, a step at every
  door.
- Left for later: dormers, ridge caps, shutters as relief, more props per trade.

## Status (2026-11-11)

G1–G5 are in, a commit each. Checked in the preview on the debug set of every model (`localStorage
debug3dModels`) at noon, a low sun and night, from zoom 13.5 to 22. Not measured on an integrated GPU: the tree
budget (120k) and the 1600 m shadow step are the two things to watch there.

## Risks

- **Integrated GPUs:** G1 raises tree and shadow work. The forest's budget solver still caps the count; the
  settings' shadow preset `low` keeps the old ranges.
- **CPU figures:** every figure is rewritten per frame; the vertex budget of G1 bounds it before G4 adds geometry.
