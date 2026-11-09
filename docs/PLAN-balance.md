# Rebirth — balance plan (growth past 1000 residents)

Goal: the early pace from `PLAN-pace.md` stays, growth slows down past ~1000 residents because
the town needs more organisation (logistics, goods chains, administration), not because of a hard cap.
Measured pace (player, 2026-10-26): 100 residents in ~1.5 h real time at 4× (~75 game days).

## Milestones

| # | Milestone | Done when |
|---|---|---|
| B1 | Builder limits | A building site takes at most a crew sized by its footprint (`siteCrew`: about one hand per 12 m², 2..16); a толока doubles it. A road edge takes about one hand per 10 m of its length (1..`CREW`). Hands no site can use stay idle instead of piling onto the same sites; the idle artel is visible to the player. **Done**: `siteCrew`, `FOCUS_CREWS`, `roadCrew` (`sim/buildings.ts`, `sim/roads.ts`), builders fill crews in `sim/life.ts`, the builders panel shows idle hands and a per-site estimate. Pace harness: early milestones unchanged (10 houses 1:15), population on game day 128 is 149 instead of 244. |
| B2 | Families by house level | A house holds as many families as its level. A new house starts at level 1 (the large house at 2); the area of its lot (old foundations scale it) sets the highest level (`maxLevel` = families the area holds + 1). Upgrades go level by level, each costing more (`UPGRADE` × current level) under the same service, land and mood conditions; capacity = level × family size. Old saves: a house keeps every family living in it (its level is raised to their number). **Done**: `startLevel`, `maxLevel`, `upgradable`, `upgradeLabor`, `upgradeMaterials` in `sim/buildings.ts`; houses on old foundations cost their template; save migration in `sim/save.ts`. |
| B3 | Goods groups | `wares` splits into clothing, dishes, tools and household goods, each made by its own workshop. Clothing is the level 1 need, dishes join at level 2, household goods at level 3+; a house keeps its level only while its goods are served. Tools are an input of production: workshops, woodcutters, quarries and farms without tools work at half rate. Goods shortages appear in the HUD and day summary. |
| B4 | Logistics and storages | Resources live in storages, not one town stock: a log yard (logs, planks), a stone yard, the barn and cellar (food), a warehouse (goods). Producers deliver to the nearest storage with room, sites and households fetch from the nearest one that holds it; carrying takes carters' time by road distance, so a sprawling town without district storages slows down. Carts are visible on roads. |
| B5 | Finite resources | Forest stands are felled and regrow over years; woodcutters work the forest within their radius and move or stop when it is cut. Quarries and fishing grounds deplete slowly and recover partly. Overlays show what is left. |
| B6 | Immigration by attractiveness | Settlers come by the town's attractiveness (food outlook, mood, services coverage, free homes, jobs), not once per vacant house; the inflow per day saturates with size so a big town grows by births and steady arrivals. The town panel explains the score. |
| B7 | Administration | A town hall and later district offices give a management capacity of N residents each; past it every work rate drops gently (a visible «перегрузка управления»). New buildings for B3–B7 come as variants or upgrades of existing tools where possible (see the memory note on the build bar). |
| B8 | Museums | New potential museum sites on the map (old buildings that can become museums for found items): design to be agreed with the user before work starts. |
| B9 | Harness and tuning | `npm run pace` plays to 2000 residents, reports what limits growth at each stage (time per `growthAdvice` reason, idle hands, goods shortage days) and is calibrated against the measured pace; constants tuned to a target curve (fast to ~100, slowing past ~1000). |
| Later | Fires and disease | Density risks: fires spread between close wooden houses, disease in crowded quarters without wells and healers. |

Order: B1 → B2 → B3 → B4 → B6 → B5 → B7 → B9 → B8 (needs a design talk).
