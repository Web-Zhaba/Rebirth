# Сборка, бандл и холодный старт Rebirth

Агент: `coldstart`. Всё измерено на этом чекауте, Node 22.22.2, vite 7.3.7, vitest 5.0.5, Chrome 157.
Харнессы — в `perf/bench/coldstart/`. Ни один файл в `src/` не менялся; `dist/` перезаписывался только `npx vite build`.

**Оговорки о методе (важно для чтения чисел)**

- Машина общая: в это же время другие агенты держали `perf/bench/sim/*.test.ts` и свои прогоны. Абсолютные
  времена сборки/тестов завышены и шумят в пределах ±5 %; сетевые байты (dist, gzip) от CPU не зависят.
- `tsc`/`vite build` — по заданию 3 и 2 прогона (не медиана из 5): медиана по 3 и по 2 значениям ниже.
- Рабочее дерево менялось параллельно: другие агенты держат незакоммиченные правки в `src/main.ts`,
  `src/simClient.ts`, `src/sim/worker.ts`, `src/platform/index.ts`. Все числа — про состояние дерева на момент
  прогона; после их мержа размеры чанков могут сдвинуться на единицы kB, номера строк — уехать.
- Сеть холодного старта снята через Chrome DevTools Protocol в `--headless=new`. WebGPU в headless есть
  (`navigator.gpu`, устройство выдаётся, движок стартует), но адаптер программный, поэтому *времена кадров* —
  верхняя граница; *байты и порядок запросов* детерминированы (3 прогона дали одинаковые 420.2 KiB / 16 запросов).

---

## 1. Время сборки

| Команда | Прогоны (wall) | Медиана | Собственный таймер инструмента |
|---|---|---|---|
| `npx tsc --noEmit` (после прогрева) | 6919 / 6733 / 7025 мс | **6919 мс** | `Total time 5.77 s` |
| `node node_modules/typescript/bin/tsc --noEmit` | 5814 / 5243 мс | **~5.5 с** | — |
| `npx vite build` (`rm -rf dist` перед каждым) | 6628 / 6281 мс | **6454 мс** | `built in 5.24s` / `5.06s` |
| `npx vitest run` (весь include) | 11 178 мс | — | `Duration 9.85 s`, 160 файлов |
| `npx vitest run src/` | 6075 мс | — | `Duration 4.76 s`, 158 файлов |
| `npm run pace` | 9072 мс | — | `Duration 7.29 s`, харнесс печатает `(6.7 s wall time)` |

Оверхед `npx` в tsc — **~1.2 с** (6919 против ~5.5 с прямого бинаря): это резолв npm + старт node, а не работа
компилятора.

`tsc --extendedDiagnostics` (`perf/bench/coldstart/tsc-diag.log`):

```
Files: 712   Lines of TypeScript: 67585   Identifiers: 304417   Symbols: 377665   Types: 93941
Parse time: 0.68s   Bind time: 0.34s   Check time: 4.38s   Total time: 5.77s   Memory used: 445855K
```

Check — 76 % времени. Из 712 файлов 158 — тесты и `src/pace/` (`src/**/*.test.ts`), они попадают в `tsc` через
`tsconfig.json:15` (`"include": ["src"]`). Отдельный прогон без них
(`perf/bench/coldstart/tsconfig.no-tests.json`): **530 файлов**, 48 894 строки, `Check time 3.23s`,
`Total time 4.42s`, wall 5256 мс — **−1.3 с (−20 %)**.

`vite build`: 551 модуль, dist детерминирован — оба прогона дали ровно **1 955 350 байт** (1909.5 KiB).
Из 6.5 с wall ~1.3 с уходит на старт node/vite/конфига (`built in 5.06–5.24s` — это уже сам Rollup).

---

## 2. Что лежит в `dist/`

38 файлов, **1909.5 KiB raw / 986.1 KiB gzip / 896.2 KiB brotli**. Команда:
`node perf/bench/coldstart/analyze-dist.mjs` (и тест `perf/bench/coldstart/dist-budget.test.ts`).

| kind | файлов | raw KiB | gzip KiB | доля gzip |
|---|---|---|---|---|
| js | 8 | 1274.1 | 468.1 | 47.5 % |
| font | 24 | 321.5 | 321.4 | 32.6 % |
| image | 3 | 186.0 | 171.8 | 17.4 % |
| css | 2 | 125.7 | 24.0 | 2.4 % |
| other (index.html) | 1 | 2.2 | 0.7 | 0.1 % |

### Топ-10 по raw (и по gzip — порядок тот же)

| raw KiB | gzip KiB | brotli KiB | файл |
|---|---|---|---|
| 945.2 | 349.1 | 285.2 | `assets/main-CJDN3mlF.js` |
| 281.0 | 99.9 | 84.3 | `assets/worker-kiES1Bew.js` (sim-воркер) |
| 118.5 | 106.5 | 103.1 | `assets/biomes-JBtXiI4c.png` (биом-карта, `src/world/biomes.png`) |
| 91.9 | 16.7 | 14.5 | `assets/main-DCwOfvZ-.css` (стили UI) |
| 65.7 | 64.5 | 64.3 | `rebirth-social-preview.png` (OG-картинка из `public/`, в приложение не грузится) |
| 33.8 | 7.3 | 6.5 | `assets/index-BV8LY4vC.css` (`style.css` + `ui/tokens.css`) |
| 23.9 | 9.0 | 8.0 | `assets/drapeWorker-DREm_-T3.js` |
| 22.4 | 22.5 | 22.3 | `bitter-latin-800-normal-*.woff` |
| 21.8 | 21.8 | 21.7 | `bitter-latin-600-normal-*.woff` |
| 21.7 | 21.7 | 21.5 | `bitter-latin-400-normal-*.woff` |

### Разбиение на чанки

Есть ровно одна граница: `boot.ts` → `main` через top-level await (`src/boot.ts:7`), плюс воркеры. Никакого
vendor-чанка и `manualChunks` нет (`vite.config.ts` не задаёт `build.rollupOptions`), поэтому Vite печатает
`Some chunks are larger than 500 kB`. Итог: **967.84 kB / 357.86 kB gzip одним файлом**, и это 96 % приложения.

### Тяжёлые зависимости: где они и сколько весят

Сборка с `manualChunks` «пакет = чанк» (`perf/bench/coldstart/vite.analyze.config.ts`):

| пакет | raw kB | gzip kB | в стартовом чанке? |
|---|---|---|---|
| `preact` | 14.03 | 5.84 | да (единственный прямой импорт `main.ts:1`) |
| `earcut` | 7.38 | 3.16 | да (`engine/overlay/geometry.ts`, `map/fieldMesh.ts`) |
| `@preact/signals-core` | 4.66 | 1.69 | да |
| `pbf` | 4.10 | 1.27 | да (`world/tiles.ts` → `world/oldworld.ts`) |
| `@mapbox/vector-tile` | 3.89 | 1.47 | да |
| `@preact/signals` | 3.26 | 1.53 | да |
| `@mapbox/point-geometry` | 2.07 | 0.70 | да |
| `@vkontakte/vk-bridge` | 0.00 | 0.02 | **нет** — ветка платформы вырезана (`platform/index.ts:64-72`) |
| `@fontsource/*` | только CSS + woff2 | — | CSS да, шрифты — отдельные файлы по требованию |

Сумма всех npm-зависимостей — **39.4 kB raw / ~15.7 kB gzip**, то есть **4.1 % чанка**. Остальные 928.7 kB raw —
собственный код игры. Вывод: «тяжёлые зависимости» здесь не проблема; балласт — свой код (см. §7).

### Сколько грузится до первого кадра

Замер CDP, 3 прогона, идентично: **420.2 KiB, 16 запросов** до first contentful paint.

| KiB | мс | что |
|---|---|---|
| 350.1 | 68 | `main-CJDN3mlF.js` — весь код игры, gzip |
| 17.2 | 69 | `main-DCwOfvZ-.css` |
| 19.2 | 280 | `bitter-latin-800-normal-*.woff2` |
| 12.0 | 279 | `golos-text-latin-400-normal-*.woff2` |
| 7.7 | 59 | `index-BV8LY4vC.css` — **блокирует рендер** |
| 7.1 | 288 | `golos-text-cyrillic-400-normal-*.woff2` |
| 2.4 | 279 | `tiles.openfreemap.org/planet` (TileJSON) |
| 1.5 | 58 | `index-CpVk2rg2.js` (boot-чанк) |
| 1.0 | 22 | документ |
| 1.3 | 75+287 | `rebirth-icon.svg` (дважды: `rel=icon` и панель управления) |
| 0.8 | 58 | `index-ChhihJ1H.js` (preload, `platform/index.ts`) |

**Ядро пути (JS+CSS) = 378.3 KiB gzip; с шрифтами, иконкой и TileJSON — 420.2 KiB.**
Вне этого числа, но в том же холодном старте (воркеры и их сеть не видны в Network страницы):
`worker-kiES1Bew.js` 99.9 KiB gz + `drapeWorker` 9.0 + `demWorker` 2.0 + `placeWorker` 3.8 + `biomes.png`
106.5 KiB gz = **221.2 KiB gzip**. Итого ≈ **641 KiB gzip** до первого задрапированного ландшафта, без самих
DEM-тайлов (их размер не измерял).

---

## 3. Шрифты

Импортируются только два пакета (`src/ui/tokens.css:8-19`), 12 правил `@font-face`:

```
bitter/cyrillic-{400,600,800}.css   bitter/latin-{400,600,800}.css
golos-text/cyrillic-{400,500,700}.css   golos-text/latin-{400,500,700}.css
```

`@fontsource/pt-sans` и `@fontsource/pt-serif` лежат в `package.json` (`dependencies`), но не импортируются
нигде — мёртвые зависимости (в бандл не попадают).

В `dist/` — **24 файла шрифтов, 321.5 KiB = 16.8 % сборки**:

| формат | файлов | KiB raw | когда скачивается |
|---|---|---|---|
| woff2 | 12 | 145.6 | по требованию: 3 файла (38.3 KiB) на первом экране, все 12 — когда появляется весь текст UI |
| **woff** | **12** | **175.8** | **никогда** в браузере, который умеет woff2 (все с 2016) |

Размеры woff2: Bitter cyr 400/600/800 = 11.4/11.6/11.8, Bitter lat 400/600/800 = 18.6/18.8/19.4,
Golos cyr 400/500/700 = 7.0/7.0/7.1, Golos lat 400/500/700 = 12.0/12.0/12.4.
woff — те же начертания на 25–35 % толще (bitter-latin-800 22.98 против 19.37).

**Можно ли урезать — да, два измерения:**

1. **Все 12 `woff` — мёртвый груз.** Их не запрашивает ни один современный браузер (в CDP-логе за весь холодный
   старт ни одного `.woff`). Выкинуть `url(...woff) format('woff')` из правил: **−175.8 KiB сборки (−9.2 %)**,
   для клиента — 0 изменений. Риск: браузеры до 2016 без woff2 останутся с системным шрифтом.
2. **Вес 500 у Golos Text используется ровно один раз** (`grep "font-weight: *[0-9]*" src/**/*.css`:
   `400×16, 500×1, 600×44, 700×51, 800×32`). Убрать `golos-text/{cyrillic,latin}-500.css` → **−18.7 KiB** (2 файла).
   Альтернатива — заменить одно объявление на 600.

Про `latin-*.css` против `index.css`/`400.css`: в `node_modules/@fontsource/bitter/latin-400.css` **нет
`unicode-range`**, а в `400.css`/`index.css` он есть. Поэтому у каждого (семейство, вес) обе подмножества
конкурируют за каждый глиф, и браузер обязан держать файлы обоих: probe `document.fonts.load("400 16px
Bitter","Ж")` вернул **2 faces**, и скачиваются оба файла (`perf/bench/coldstart/font-probe.mjs`). Кириллица при
этом рисуется настоящим шрифтом (ширина «ЖЖЖ» в Bitter 800 = 102.9 px против 86.0 px у serif — это глифы
Bitter, а не фолбэк). То есть на русском UI переход на `400.css`-стиль (с `unicode-range`) байтов не экономит —
экономит он только латинской локали (там кириллическое подмножество не загрузится). Зато он делает поведение
предсказуемым и позволяет `preload` нужной пары.

Итого шрифтовый бюджет: 321.5 KiB в dist, 38.3 KiB на первый экран, 145.6 KiB после полного UI.
Реалистичный минимум после правок 1+2: **157 KiB в dist** (было 321.5, −51 %) при том же рендере.

---

## 4. Стартовый путь: что блокирует первый кадр

Порядок (из `dist/index.html` и `assets/index-CpVk2rg2.js`, номера строк — исходники):

1. `dist/index.html:27` — `<link rel="stylesheet" href="./assets/index-BV8LY4vC.css">`: **блокирует рендер**, 7.7 KiB gz.
   Плюс `modulepreload` хелпера и `script type=module` boot-чанка (2.2 kB).
2. `src/boot.ts:6` — `await initPlatform()`: **top-level await**. Standalone: `portalInit` возвращает `null`
   (`platform/index.ts:72`), сеть не нужна, промис уже готов. Портал: динамический импорт адаптера + SDK-скрипт с
   таймаутом `INIT_WAIT_MS = 15_000` (`platform/index.ts:35`) — вот где реально можно потерять до 15 с.
3. `src/boot.ts:7` — `await import("./main")`: Vite преload-ит `main-DCwOfvZ-.css` (17.2 KiB gz) и **ждёт
   `load` стилей**, потом исполняет main-чанк 350.1 KiB gz. Здесь и лежит ~90 % времени до старта игры.
4. `src/main.ts:82` — `await tryMountEngineView(...)`: **весь UI ждёт GPU**. Внутри `Engine.create` →
   `await navigator.gpu.requestAdapter` (`engine/gpu/device.ts:27`) и `await adapter.requestDevice`
   (`device.ts:31`); конструктор `Terrain` синхронно создаёт два воркера
   (`engine/terrain/terrain.ts:70` → `demStream(8)` → `engine/stream/demStream.ts:139`; `terrain.ts:74` — drape).
5. Рендер UI — только внутри `start()`: `src/main.ts:116` `render(h(App, ...))`. До этого момента на экране ничего
   игрового. `load()` (`main.ts:118`) шлёт воркеру команду загрузки сейва; `platform.ready()` — когда пришёл
   `loaded`/`loadFailed`.
6. `engine.start()` (`view/engine/mount.ts:102`) — первый кадр карты.

**Воркеров до первого кадра — 4, плюс один лениво:**

| воркер | чанк (gzip) | когда создаётся |
|---|---|---|
| sim | 99.9 KiB | `src/simClient.ts:79` — **на импорте модуля**, до движка и до решения «будет ли игра» |
| DEM | 2.0 KiB | `engine/terrain/terrain.ts:70`, конструктор Terrain (в `Engine.create`) |
| drape | 9.0 KiB | `engine/terrain/terrain.ts:74`, там же |
| place (подписи) | 3.8 KiB | `view/engine/placeLabels.ts:43`, при монтировании |
| cloud | 3.0 KiB | `map/clouds/cloudData.ts:21`, лениво — на первый запрос облаков |

**Сети, стартующие сразу:** sim-воркер (`simClient.ts:79`); биом-карта **106.5 KiB gz** — `drapeWorker.ts:34`
делает `loadBiomeMap()` на верхнем уровне модуля (`world/biomes.ts:57`), то есть как только воркер запустился;
TileJSON `tiles.ts:77` (замерено: 2.4 KiB, 279 мс); DEM-тайлы `tiles.ts:67`; векторные тайлы подписей
`placeLabels.ts:51` → `tiles.ts:96`. Статьи Wikipedia (`world/wiki.ts:65`) — только когда появился диск раскопок
(`map/articles.ts:37`), геокодер — только по поиску.

**Тайминг (3 прогона CDP, медиана):** first paint 148 мс · canvas 173 мс · UI отрендерен 309 мс ·
**FCP 2072 мс**; `domContentLoaded` 38 мс, `load` 43 мс.

Два неочевидных следствия, оба измерены:

- **`load` документа не ждёт игру вообще.** domContentLoaded 38 мс и load 43 мс — при том что main-чанк
  приходит на 68 мс. Причина: top-level await в `boot.ts:6-7` делает исполнение модуля асинхронным, и событие
  `load` не задерживается. Любой портал, снимающий свой лоадер по `window.onload`, покажет пустой экран.
- **FCP 2.0 с при UI, готовом на 309 мс.** Long task'ов > 50 мс нет ни одного (0 мс суммарно), rAF-колбэки идут
  221, 233, 636, 640 мс, затем провал до 2022 мс и дальше ровные 60 fps
  (`perf/bench/coldstart/longtask-probe.mjs`). Значит 1.4 с дыры — не JS, а прогрев GPU/композитора (в headless
  адаптер программный). На реальной видеокарте это должно быть заметно меньше; число 2072 мс стоит читать как
  верхнюю границу, а не как FCP пользователя.

---

## 5. Тесты и pace

| прогон | wall | Duration внутри vitest | файлов |
|---|---|---|---|
| `npx vitest run` (дефолтный include) | **11 178 мс** | 9.85 s | **160** |
| `npx vitest run src/` | 6 075 мс | 4.76 s | 158 |
| `npm run pace` | 9 072 мс | 7.29 s | 1 (харнесс: `(6.7 s wall time)`) |

AGENTS.md (`AGENTS.md:12`) обещает «154 files, ~7s». По факту файлов **158** (счёт устарел), а время — 4.76 s
внутри vitest / 6.1 с wall: заявленное «~7s» близко к wall-времени и не врёт.

**Но `npx vitest run` = 11.2 с, потому что в дефолтный include попадают чужие бенчмарки.** В
`vite.config.ts:34` исключены только `**/node_modules/**` и `.claude/**`, поэтому `perf/bench/**` тоже
прогоняется, и в этом прогоне критический путь задавали:

| файл | мс | тестов |
|---|---|---|
| `perf/bench/sim/probe2.test.ts` (другой агент) | 8 951 | 1 |
| `perf/bench/sim/probe.test.ts` (другой агент) | 1 114 | 1 |

Топ-10 самых медленных файлов из `src/` (`node perf/bench/coldstart/top-files.mjs`, json-репортер):

| мс | тестов | файл |
|---|---|---|
| 4 280 | 6 | `src/engine/terrain/morph.test.ts` |
| 3 112 | 9 | `src/engine/terrain/quadtree.test.ts` |
| 2 096 | 21 | `src/sim/weather.test.ts` |
| 1 997 | 66 | `src/sim/production.test.ts` |
| 1 853 | 58 | `src/sim/people.test.ts` |
| 1 234 | 3 | `src/platform/crazygamesStorage.test.ts` |
| 1 217 | 4 | `src/map/clouds/noise3d.test.ts` |
| 1 161 | 21 | `src/sim/life.test.ts` |
| 1 153 | 3 | `src/map/clouds/cloudWorker.test.ts` |
| 941 | 12 | `src/sim/chronicle.test.ts` |

Файлы идут параллельно: сумма по файлам 36.8 с при wall 9.9 с. CPU делится с другими агентами — одиночный
«чистый» прогон был бы быстрее, но относительный порядок файлов устойчив.

---

## 6. Хотспоты (что именно тяжело)

Размеры по файлам получены сборкой, где каждый модуль `src/**` принудительно вынесен в свой чанк
(`perf/bench/coldstart/vite.files.config.ts`, 436 чанков; абсолютные kB слегка завышены из-за общего кода на
границах — читать как доли, не как точную бухгалтерию).

| raw kB | gzip kB | файл |
|---|---|---|
| 102.8 | 40.7 | `src/ui/icons.ts` (89 иконок `~icons/*`, строки 5–… ) — **10.5 % чанка** |
| 22.1 | 7.1 | `src/main.ts` |
| 21.9 | 8.4 | `src/ui/BuildingPanel.tsx` (552 строки) |
| 20.2 | 7.3 | `src/ui/TownhallPanel.tsx` (600) |
| 19.7 | 7.3 | `src/boot.ts` |
| 19.1 | 7.2 | `src/engine/terrain/terrain.wgsl?raw` |
| 17.6 | 7.0 | `src/map/roadTool.ts` |
| 17.5 | 6.6 | `src/ui/TownPanel.tsx` (370) |
| 16.3 | 6.2 | `src/ui/MuseumPanel.tsx` (493) |
| 15.4 | 6.2 | `src/ui/TopBar.tsx` (472) |
| 15.2 | 5.8 | `src/engine/scene/forest.ts` |
| 14.8 | 5.7 | `src/engine/sky/clouds.wgsl?raw` |
| 14.3 | 5.6 | `src/ui/MarketPanel.tsx` (451) |
| 14.3 | 4.7 | `src/engine/scene/townMesh.wgsl?raw` |
| 12.1 | 4.7 | `src/engine/scene/forestScatter.wgsl?raw` |

Проверка «сколько стоят иконки»: сборка с заглушкой вместо `unplugin-icons`
(`perf/bench/coldstart/vite.noicons.config.ts`) — main 826.90 kB / 301.46 gz против 928.74 / 343.25, то есть
**иконки = 101.8 kB raw / 41.8 kB gzip**. WGSL-шейдеры, зашитые через `?raw`, — ~80 kB raw / ~29 kB gzip.

По слоям (`perf/bench/coldstart/vite.dirs.config.ts`): `ui` 350.4 (128.6 gz), `engine` 234.9 (81.4),
`map` 121.7 (48.0), `sim` 78.4 (30.3), `view` 64.0 (25.3), `buildings` 53.5 (19.2), `world` 29.1 (12.1),
CSS: `ui` 94.1 (17.2), `style.css` 34.6 (7.5).

---

## 7. Предлагаемые правки

| # | Правка | Где | Ожидаемый выигрыш (измерено/оценено) | Риск |
|---|---|---|---|---|
| 1 | **В `vite.config.ts:34` добавить `"perf/**"` в `test.exclude`** | `vite.config.ts` | `npx vitest run`: **11.18 с → 6.08 с (−46 %)**, 160 → 158 файлов, прогон перестаёт зависеть от того, что оставили другие агенты (сейчас `probe2.test.ts` одного теста стоит 8.95 с) | нет: `perf/bench` — не тесты игры, запускаются явным путём |
| 2 | **Выкинуть 12 `.woff` (и вес Golos 500)** | `src/ui/tokens.css:8-19` (перейти на свои `@font-face` с `url(...woff2)` + `unicode-range`) либо `generateBundle`-плагин, срезающий `*.woff` из бандла | dist: **1909.5 → 1733.7 KiB (−9.2 %)**, шрифтовые байты 321.5 → 145.6 KiB (−55 %); с весом 500 — ещё −18.7 KiB. Клиент не теряет ничего (`.woff` не запрашивается ни разу) | низкий: браузеры старше 2016 без woff2 получат системный шрифт; нужен визуальный прогон кириллицы |
| 3 | **Не создавать sim-воркер на импорте** — перенести `new Worker(...)` из `src/simClient.ts:79` в `load()`/первый `sendCmd` | `src/simClient.ts` | **−99.9 KiB gzip** из холодного старта (−24 % от 420 KiB до FCP) на медленных каналах и в iframe порталов; при отсутствии WebGPU воркер вообще не стартует и не берёт лок сейва | средний: воркер сейчас гарантированно жив к первому `send`; нужно аккуратно разбудить его до первых команд (иначе `sendCmd` до `loaded` уже возвращает `{ok:false}`) |
| 4 | **Не типизировать тесты в сборочном `tsc`** — отдельный `tsconfig.test.json` (CI гоняет его параллельно) | `tsconfig.json:15` | `tsc --noEmit`: Check 4.38 → 3.23 с, **wall 6577 → 5256 мс (−20 %)**, 712 → 530 файлов | низкий: тесты перестают проверяться основным гейтом — только если CI не запускает второй проект |
| 5 | **Разрезать main-чанк по существующим швам**: панели за `import()` при открытии (`BuildingPanel` 8.4, `TownhallPanel` 7.3, `MuseumPanel` 6.2, `MarketPanel` 5.6, `TopBar` 6.2, `TechPanel` 3.6) и WGSL отдельными файлами вместо `?raw` | `src/ui/App.tsx`, `src/engine/**/*.wgsl` | ~30–45 kB gzip уходит с критического пути первого кадра (из 357.9 kB gz main-чанка); шейдеры ~29 kB gz грузятся параллельно с инициализацией GPU вместо блокировки разбора | средний: Preact без Suspense — нужен явный `lazy`-механизм и заглушки; риск мигания панелей. Иконки (41.8 kB gz) дробить смысла мало — они нужны на первом экране |
| 6 | **`biomes.png` (106.5 KiB gz) — не PNG, а сырой Uint8 (1 байт/пиксель)**: сейчас 118.5 kB PNG декодируется в `Uint8Array` в `world/biomes.ts:57` | `src/world/biomes.ts`, `scripts/bake-biomes.mjs` | оценка: карта ~65 кБ raw (`biomes.test.ts` знает размеры) → экономия ~40–50 KiB gz и время `decodePng` в драпировочном воркере | средний: нужен скрипт пере-выпечки и правка `decodeBiomeMap`; формат завязан на тест |

Общая картина: **узкое место не зависимости и не «сборка», а один монолитный чанк собственного кода
(350 KiB gzip) + шрифтовой балласт (321 KiB в dist) + дефолтный include тестов, всасывающий чужие бенчмарки.**
Плюс два системных факта для порталов: `load` документа не ждёт игру (top-level await), и sim-воркер стартует
раньше, чем известно, будет ли игра вообще.

---

## 8. Файлы харнессов и команды

Всё в `perf/bench/coldstart/` (вне `tsconfig`, `tsc` их не видит).

| файл | что делает | команда |
|---|---|---|
| `measure-build.sh` | прогрев + 3× `tsc --noEmit`, 2× `npx vite build` (с `rm -rf dist`) | `bash perf/bench/coldstart/measure-build.sh` → `raw-times.txt`, `tsc-*.log`, `build-*.log` |
| `measure-suites.sh` | один полный `npx vitest run` (verbose + json) и один `npm run pace` | `bash perf/bench/coldstart/measure-suites.sh` → `raw-suites.txt`, `vitest.json`, `vitest-verbose.log`, `pace.log` |
| `analyze-dist.mjs` | инвентарь `dist/`: raw/gzip(level 9)/brotli(11) по файлам, итоги по типам, топ-10, шрифты | `node perf/bench/coldstart/analyze-dist.mjs` |
| `dist-budget.test.ts` | то же в виде проверяемого теста (бюджет по типам, 12 woff2 vs 12 woff) | `npx vitest run --config vitest.perf.config.ts perf/bench/coldstart/dist-budget.test.ts --reporter=verbose` — `perf/**` уже исключён из дефолтного include (`vite.config.ts`), старый `probe2.test.ts` удалён |
| `top-files.mjs` | топ медленных тест-файлов из `vitest.json`, отдельно — просочившиеся `perf/bench/**` | `node perf/bench/coldstart/top-files.mjs` |
| `cdp-coldstart.mjs` | холодный старт `dist/` в headless Chrome через CDP: байты и порядок запросов до FCP/`load`/первого рендера UI | `npx vite preview --host 127.0.0.1 --port 4188` затем `node perf/bench/coldstart/cdp-coldstart.mjs http://127.0.0.1:4188/ perf/bench/coldstart/coldstart-1.json` |
| `font-probe.mjs` | какие подмножества шрифтов реально скачиваются под кириллицу/латиницу, `document.fonts` | `node perf/bench/coldstart/font-probe.mjs http://127.0.0.1:4188/` |
| `longtask-probe.mjs` | long tasks, paint-тайминги, первые rAF-кадры | `node perf/bench/coldstart/longtask-probe.mjs http://127.0.0.1:4188/` |
| `vite.analyze.config.ts` | сборка «пакет = чанк» (вес зависимостей) | `npx vite build --config perf/bench/coldstart/vite.analyze.config.ts` |
| `vite.dirs.config.ts` / `vite.files.config.ts` | сборка по слоям / по файлам | `npx vite build --config perf/bench/coldstart/vite.dirs.config.ts` |
| `vite.noicons.config.ts` | то же с заглушкой вместо `unplugin-icons` (цена иконок) | `npx vite build --config perf/bench/coldstart/vite.noicons.config.ts` |
| `tsconfig.no-tests.json` | `tsc` без тестов и `src/pace/` | `npx tsc -p perf/bench/coldstart/tsconfig.no-tests.json --noEmit --extendedDiagnostics` |

Сырые данные прогонов: `raw-times.txt`, `raw-suites.txt`, `tsc-diag.log`, `tsc-no-tests.log`,
`coldstart-{1,2,3}.json`, `cdp-{1,2,3}.log`, `vitest.json`, `vitest-src-only.log`, `build-files.log`.
Сборки `vite.*.config.ts` кладут вывод в `perf/bench/coldstart/analyze-*/` (сам `dist/` они не трогают).
