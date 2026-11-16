# Changelog

## [0.6.1](https://github.com/Web-Zhaba/Rebirth/compare/rebirth-v0.6.0...rebirth-v0.6.1) (2026-11-16)


### Features

* **build:** the tavern gets its own tool, the shop is the goods service, the market moves to resources ([d7451ea](https://github.com/Web-Zhaba/Rebirth/commit/d7451ea5ca64b6850a458fc4b5fee988f590890e))
* **graphics:** shadow cascades, a sun that follows the clock, steady far trees, forest clear of lots ([adb3f8e](https://github.com/Web-Zhaba/Rebirth/commit/adb3f8e21ee11ed034229fc9583d5e8d731f4040))
* **map:** the terrain card opens on a click and closes on a pan or Escape ([e9a3d22](https://github.com/Web-Zhaba/Rebirth/commit/e9a3d22b98bd3f8a910ca921721fe7b38404e105))
* **models:** weaving workshop, smithy yard, timber yard and pier models; piers on piles, bridges drawn with depth ([6a10390](https://github.com/Web-Zhaba/Rebirth/commit/6a103909b380b25312eebe7b4fb423611e7ffbcb))
* **tech:** the research desk: the tech under a loupe, the queue pinned to the wall, with sounds ([f8b9149](https://github.com/Web-Zhaba/Rebirth/commit/f8b914959e5b62d37d310043dc0ea15d97932fac))
* **townhall:** form cards with «Продолжить», orders as charters, records as a census report ([6950aea](https://github.com/Web-Zhaba/Rebirth/commit/6950aea3c8146f76b017e8f3afe2c70846c24118))
* **townhall:** orders are sealed and lifted by a click on the charter ([c47fbc7](https://github.com/Web-Zhaba/Rebirth/commit/c47fbc784e59fd4dd3940b9db1b48134a53b0b17))
* **townhall:** the head of the town, the form of rule and the town's records ([044681d](https://github.com/Web-Zhaba/Rebirth/commit/044681d6710f2b11562bb4732dc9be31581c18d2))
* **townhall:** the head works as a town hall clerk; the form changes once in five years ([3024dbe](https://github.com/Web-Zhaba/Rebirth/commit/3024dbe10a4f4717b2a9df724216243d168781e4))
* **trade:** market window with stalls, trade research and order limits ([7cf37a3](https://github.com/Web-Zhaba/Rebirth/commit/7cf37a388c1d3b0ade5691ba04f306d5cbf830f9))


### Bug Fixes

* **clock:** a pause keeps the time reached inside the tick ([d56108c](https://github.com/Web-Zhaba/Rebirth/commit/d56108c71728beb4a74c093b842012074910ce50))
* **platform:** CrazyGames SDK tag in the page, start without a portal SDK that fails ([fef7e37](https://github.com/Web-Zhaba/Rebirth/commit/fef7e37ef64bd54760031d5612b5b7b13ae5dd12))
* **roads:** road hover and demolish overlays as wide as the road under them ([96e4117](https://github.com/Web-Zhaba/Rebirth/commit/96e4117e202c0fb04ff2f25a48d0e06c574f3a07))
* the market's and a foundation dig's inspector icons pointed at icons ([01286a6](https://github.com/Web-Zhaba/Rebirth/commit/01286a6dc2db61415cd3bac5ad437602d205b0ef))
* **townhall:** rule split in two, orders sealed or cancelled, every tab fits the sheet ([e415e8c](https://github.com/Web-Zhaba/Rebirth/commit/e415e8c5ff18efccf734196a4acd1fb38186d4eb))


### Refactoring

* **buildings:** boundary checks and the buildings section of the architecture ([3b4012a](https://github.com/Web-Zhaba/Rebirth/commit/3b4012ac8b7ed9b80634aa991b4f4a28ab46cb84))
* **buildings:** each building's interface in its own ui.ts ([01286a6](https://github.com/Web-Zhaba/Rebirth/commit/01286a6dc2db61415cd3bac5ad437602d205b0ef))
* **buildings:** job, chronicle, store, size class, service and placement rules in each building ([857c5a8](https://github.com/Web-Zhaba/Rebirth/commit/857c5a8f1d309b4ac0afbad26585246f889a3aa3))
* **buildings:** no template-id checks outside the building folders ([288d891](https://github.com/Web-Zhaba/Rebirth/commit/288d891f7b09f743ac216cea6a299a99ff45f985))
* **buildings:** one 3D model file per building ([ee36389](https://github.com/Web-Zhaba/Rebirth/commit/ee36389709671950f04c174fea46a073a277ba08))
* **buildings:** one folder per building, rules registry ([e54a47d](https://github.com/Web-Zhaba/Rebirth/commit/e54a47d3d8bb8714bc18408902ece07e1886d487))
* **buildings:** recipes and weather of the workplaces in their rules ([8f8e6e1](https://github.com/Web-Zhaba/Rebirth/commit/8f8e6e10008f95dc6a1229936467a182eec7d8d1))
* **buildings:** the last per-building tables move into the rules and ui files ([bff87fa](https://github.com/Web-Zhaba/Rebirth/commit/bff87fae08c51724eb0fd36bc2f7513efd3004d8))
* **buildings:** the offices' reach in their rules; switch and table checks ([695abe8](https://github.com/Web-Zhaba/Rebirth/commit/695abe8a2f22cbfee1737c5edceb07865a8e856d))
* **goods:** one row per good of the stock ([9d130a0](https://github.com/Web-Zhaba/Rebirth/commit/9d130a063fe1267b7f412858075606fa74a6f6d8))
* **life:** drop the glow halos around lit buildings ([2a01b57](https://github.com/Web-Zhaba/Rebirth/commit/2a01b5735a799ae81e6a0bbb8b9ac8013ddbea49))


### Documentation

* **architecture:** the building lists left outside the folders ([892da93](https://github.com/Web-Zhaba/Rebirth/commit/892da934fe510c18d8e974ba91ad982087a9dcd0))
* **readme:** current version 0.6.1, aligned tables ([3746d1e](https://github.com/Web-Zhaba/Rebirth/commit/3746d1e7016eed954433da2c46a9bc084af8b8f4))

## [0.6.0](https://github.com/Web-Zhaba/Rebirth/compare/rebirth-v0.5.1...rebirth-v0.6.0) (2026-11-12)


### Features

* **build:** drop zones, every building is laid by the player ([423ab67](https://github.com/Web-Zhaba/Rebirth/commit/423ab678fbc07563f940dfe4e14b0e6068b4a951))
* **build:** lay houses, workshops and shops in strokes along roads ([e7aae30](https://github.com/Web-Zhaba/Rebirth/commit/e7aae3059ba577d34c7437d2b4828e8a01544b07))
* **build:** quick access to tools and roads laid with houses ([6ac1503](https://github.com/Web-Zhaba/Rebirth/commit/6ac1503fee25822cccc579cdcae30799c24b86e3))
* **graphics:** contact shadows under residents, evener shadow edges ([f03fee7](https://github.com/Web-Zhaba/Rebirth/commit/f03fee71e84e19ffaf4677f3936bf8ae28503e62))
* **graphics:** glazing bars, chimney caps, corner posts and door steps ([f338191](https://github.com/Web-Zhaba/Rebirth/commit/f3381919cea22fdf6b14b46b073bb6b3f67ac37e))
* **graphics:** levels of detail step down later ([2853c7e](https://github.com/Web-Zhaba/Rebirth/commit/2853c7ede250fee9c0fd89b39dc120ba09b0d6e8))
* **graphics:** residents with legs, sleeves, a neck and hats ([5b9df9f](https://github.com/Web-Zhaba/Rebirth/commit/5b9df9fecefe1f411ab9f433780eb530ee5ec34a))
* **graphics:** sky and ground fills, a sun that warms at the horizon ([96bfb6c](https://github.com/Web-Zhaba/Rebirth/commit/96bfb6c84e746b992712cc1626f601fe1481bfe3))
* **museum:** museum panel and arranging every hall at once ([867c9ba](https://github.com/Web-Zhaba/Rebirth/commit/867c9ba0e0fcf2dd0e5373a8b4bcb780dd35866e))
* **platform:** CrazyGames build and publishing every portal from one release ([00d243d](https://github.com/Web-Zhaba/Rebirth/commit/00d243dc3ae3f24ac92e4813d2651165f8f29a9d))
* **platform:** Poki, VK Games, GameDistribution and GamePix builds ([c30fa3e](https://github.com/Web-Zhaba/Rebirth/commit/c30fa3eefa6a64fab369d4e9f27d108b48e7251c))


### Performance

* **engine:** no layout reads in the frame, tighter terrain culling ([76ae2b1](https://github.com/Web-Zhaba/Rebirth/commit/76ae2b11ec91d5333ced75ecbc858f2d9b3c05f9))

## [0.5.1](https://github.com/Web-Zhaba/Rebirth/compare/rebirth-v0.5.0...rebirth-v0.5.1) (2026-11-11)


### Bug Fixes

* **ui:** keep the game clock stepping smoothly between snapshots ([112d6db](https://github.com/Web-Zhaba/Rebirth/commit/112d6dbb981e6f77879ecc691620faec878e1f16))


### Performance

* **sim:** drop the offline catch-up ([1224a82](https://github.com/Web-Zhaba/Rebirth/commit/1224a828fd88bbe4ca8eb1d15326defcfe579030))

## [0.5.0](https://github.com/Web-Zhaba/Rebirth/compare/rebirth-v0.4.1...rebirth-v0.5.0) (2026-11-11)


### Features

* **restoration:** close the plan's remaining points ([dd71cb0](https://github.com/Web-Zhaba/Rebirth/commit/dd71cb059481525754731041cf4d87afb117f174))
* **restoration:** excavation in two stages ([ad6f083](https://github.com/Web-Zhaba/Rebirth/commit/ad6f0835db7c4b2b1dec6fc37ce2d7f42e577ac5))
* **restoration:** finds and the museum ([5a01df5](https://github.com/Web-Zhaba/Rebirth/commit/5a01df5b4281d132bc2faa0e99a7b4314b4cc485))
* **restoration:** the foundation sets the building ([dd7b31f](https://github.com/Web-Zhaba/Rebirth/commit/dd7b31f7f03b98d2b9434aa8499e9e748afd1aa1))
* **restoration:** tiers of old buildings and rewards by share ([b641752](https://github.com/Web-Zhaba/Rebirth/commit/b641752409a45c1686fc1b3f44d337add44e2299))


### Performance

* **sim:** delta snapshots and per-tick identity caches ([10afdad](https://github.com/Web-Zhaba/Rebirth/commit/10afdad18c39a1127fca6b9f40f9332a7b435d37))


### Documentation

* restoration-first gameplay plan ([fb2a575](https://github.com/Web-Zhaba/Rebirth/commit/fb2a5754aef7058ad3346fa10911b20e323ed39c))

## [0.4.1](https://github.com/Web-Zhaba/Rebirth/compare/rebirth-v0.4.0...rebirth-v0.4.1) (2026-11-10)


### Performance

* **sim:** faster offline catch-up ([f3c162d](https://github.com/Web-Zhaba/Rebirth/commit/f3c162dba0b22d5c0e3f108e0eca04864bdfc728))

## [0.4.0](https://github.com/Web-Zhaba/Rebirth/compare/rebirth-v0.3.2...rebirth-v0.4.0) (2026-11-10)


### Features

* **ads:** supplies for a rewarded ad ([da821f1](https://github.com/Web-Zhaba/Rebirth/commit/da821f147f27dced7445d0ccebc8790a558e0c81))
* **balance:** administration capacity and overload ([55b73fb](https://github.com/Web-Zhaba/Rebirth/commit/55b73fb197c5e341bab0353008ac9b48f598e780))
* **balance:** crew limits per site and families by house level ([06cfd23](https://github.com/Web-Zhaba/Rebirth/commit/06cfd23439fcfb966618dc0b95b20709cb65b090))
* **balance:** goods groups instead of one wares figure ([37c8a94](https://github.com/Web-Zhaba/Rebirth/commit/37c8a9494642bc48a4a64aeef6d5bc1f9d2304b7))
* **balance:** settlers come by the town's attractiveness ([b93c238](https://github.com/Web-Zhaba/Rebirth/commit/b93c238270f47caf59c70275758464e109a556ee))
* **balance:** stores and carting instead of one town stock ([0c3c859](https://github.com/Web-Zhaba/Rebirth/commit/0c3c859629f3923312663e5db525c137fc71df40))
* **i18n:** detect the language through the Yandex Games SDK ([1d91d51](https://github.com/Web-Zhaba/Rebirth/commit/1d91d5137675d54a3692fe8315eba48294a1f546))


### Documentation

* **balance:** mark B1 and B2 done ([e4eb4d9](https://github.com/Web-Zhaba/Rebirth/commit/e4eb4d93ddf167cca16491a0e125bbfba588bb32))
* **balance:** road crew cap is ROAD_CREW_MAX ([6d67320](https://github.com/Web-Zhaba/Rebirth/commit/6d67320f9d8ebad2e2b0ed459983481060ab2739))

## [0.3.2](https://github.com/Web-Zhaba/Rebirth/compare/rebirth-v0.3.0...rebirth-v0.3.2) (2026-11-04)


### Features

* road and bridge upgrades, road fixes, foundation sizes (0.3.2) ([ea73f0c](https://github.com/Web-Zhaba/Rebirth/commit/ea73f0cdfd6e39e5d0dc4c6a180de0cb7b4d2863))
* **roads:** upgrade roads and bridges by hovering them with a better kind ([fb290d9](https://github.com/Web-Zhaba/Rebirth/commit/fb290d93c4a91f82936cee08bb480182e56f2426))
* **sim:** old foundations are building lots; buildings get real sizes ([ef1ed43](https://github.com/Web-Zhaba/Rebirth/commit/ef1ed43e2d69213ebe9eebc821281c8ba1914494))
* **sim:** stores and market halls take old foundations of any size ([98778ff](https://github.com/Web-Zhaba/Rebirth/commit/98778ffa1f45733e617981ab92a20f64f0f598a3))

## [0.3.0](https://github.com/Web-Zhaba/Rebirth/compare/rebirth-v0.2.0...rebirth-v0.3.0) (2026-11-03)


### Features

* **engine:** real-world biomes on the terrain ([bb2d6d9](https://github.com/Web-Zhaba/Rebirth/commit/bb2d6d9e2cfc7599ca338bc9fcecf9e7f8a490b8))
* **engine:** sun shadows for terrain, town and forest ([6496b67](https://github.com/Web-Zhaba/Rebirth/commit/6496b67fd62a7f7660f08f4c31f08417647c0709))
* **sim:** remove random town events ([774375d](https://github.com/Web-Zhaba/Rebirth/commit/774375dff32ca6f181fdb05fe0bc9b863d117dad))


### Bug Fixes

* **camera:** keep the eye above ground and tighten forest culling ([bb46922](https://github.com/Web-Zhaba/Rebirth/commit/bb46922af0b7ce7bd9215f4f7a30a09dfc4b8f8b))
* **residents:** consistent daily life, follow mode and hiring ([c2127ec](https://github.com/Web-Zhaba/Rebirth/commit/c2127ece7fd030d4188b0364dea958a38a2784ac))
* **touch:** make the map and build tools work with a finger ([1ddae1b](https://github.com/Web-Zhaba/Rebirth/commit/1ddae1b1c2326e34a35d396397346d58f6782522))

## [0.2.0](https://github.com/Web-Zhaba/Rebirth/compare/rebirth-v0.1.0...rebirth-v0.2.0) (2026-11-03)


### Features

* **admin:** keep the admin panel out of production builds ([413e06e](https://github.com/Web-Zhaba/Rebirth/commit/413e06e6ad70f8be630a7fbce0dcf842d4c6dfc9))
* **i18n:** bilingual UI and sim text; fix(needs): tent camp gets services ([f72044f](https://github.com/Web-Zhaba/Rebirth/commit/f72044f7efaec6bb6d3d7388f5a9174f52c9ace1))
* **platform:** add Yandex Games build target ([61b7077](https://github.com/Web-Zhaba/Rebirth/commit/61b70778e87b858e18e3f7094ccc975ed62868c3))
* **ui:** redesign the in-game HUD as tar plates, with phone layouts ([0a7a9f3](https://github.com/Web-Zhaba/Rebirth/commit/0a7a9f359d88ef12400957ab908de6782213a511))


### Bug Fixes

* **build-menu:** show road costs per metre to hundredths ([fe21dd5](https://github.com/Web-Zhaba/Rebirth/commit/fe21dd5154ba2f8a38a5902684c62a3c138de041))


### Documentation

* describe the WebGPU engine and where to play for 0.2.0 ([ed683e4](https://github.com/Web-Zhaba/Rebirth/commit/ed683e48c8726b1dfcf9a94edc215beabb89a426))

## 0.1.0 (2026-10-29)


### Bug Fixes

* **ci:** restore green test and build checks ([23d8398](https://github.com/Web-Zhaba/Rebirth/commit/23d8398ffd4fd3946c3b2525256683a76b34f4f2))
