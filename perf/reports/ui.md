# Профилирование главного потока UI и доставки снапшотов

Стенд: `perf/bench/ui/` (вне `tsconfig`). Ничего в `src/` не менялось.
Все числа — **измерены** этим стендом, кроме мест, помеченных «оценка».

## 0. Как измерялось и чему верить

* **Снапшот** генерируется настоящим `Handler` (`src/sim/handler.ts`) на плоской синтетической площадке, как в
  `src/pace/pace.run.ts`: дорога на 4000 м, ряды домов и мастерских через `placeStroke`, `admin` команды `free`/`finish`/
  `unlock`/`stock` (они доступны только в DEV-сборке — `src/sim/handler.ts:445`), `recordFinds` для старого города,
  `setGovForm`+`chooseHead`, 60 дней игры. Получается `perf/bench/ui/.fixture.json` (кэш, пересоздаётся удалением файла).
* **Город фикстуры**: 481 здание (все `active`), 222 жителя, 80 рёбер дорог, 3840 клеток зон, 2 поля, 1 выработка,
  111 записей хроники, 79 строк истории, 26 технологий, находки 120 фундаментов / 40 старых улиц / 60 мест / 80
  признаков; снапшот — 706 557 байт в JSON.
* **Замер** — медиана из 9 замеров после прогрева (`perf/bench/ui/fixture.ts`, `time()`), время через `performance.now()`,
  внутри одного процесса. На машине параллельно работают другие агенты, поэтому **абсолютные числа шумят в 1.5–2 раза**
  (в отчёте — диапазон по прогонам), сравнения относительные и воспроизводимые.
* **Чего измерить было нельзя**: нет DOM/jsdom (`node_modules` без `jsdom`/`happy-dom`/`preact-render-to-string`), поэтому
  стоимость *диффа* Preact-дерева не измерена. Измерено всё, что JS делает в телах рендера (чистые вью-модели), частота
  ре-рендеров (по конструкции + по часам) и полный путь снапшота до слоёв.
* Запуск: `npx vitest run --config vitest.perf.config.ts perf/bench/ui/<файл>.test.ts --reporter=verbose`.

## 1. Публикация снапшота: сколько раз в секунду и во что это превращается

Тик воркера — `POLL_MS = 250` мс (`src/sim/clock.ts:38`), базовый тик — 10 игровых минут (`clock.ts:32`), живые часы —
250 мс на игровую минуту (`clock.ts:35`). Снапшот уходит только если тик сдвинул часы (`src/sim/handler.ts:540-545`).
Замерено на 400 опросах воркера (= 100 с игры) на городе из фикстуры:

| скорость | сообщений/с | медиана, байт | p90, байт | max, байт | игровых мин/с |
|---|---|---|---|---|---|
| 1× | **0.72** | 86 | 389 | 7 264 | 7.2 |
| 2× | **0.80** | 415 | 415 | 2 985 | 8.0 |
| 4× | **1.92** | 390 | 419 | 12 573 | 22.3 |

(на 4× и особенно ночью — до 4/с, ограничение `POLL_MS`; `NIGHT_BOOST = 4`, `clock.ts:40`.)

Что стоит главному потоку на **один** снапшот:

| шаг | мс | file:line |
|---|---|---|
| `snapshotDelta` в воркере (диф + JSON производных частей) | 0.0027–0.0049 | `src/sim/delta.ts:51-80` |
| `applyDelta` в `simClient` | 0.00027–0.00058 | `src/sim/delta.ts:84-89`, `src/simClient.ts:158` |
| чтение всех UI-сигналов (`state/people/stock/economy/roads/zones/buildings/buildingSet/incoming/digs/services/events/daySummary/chronicle/finds/articles`) | 0.0011–0.0021 | `perf/bench/ui/signals.ts` |
| пересборка слоёв `src/view/layers/` (steady state, сумма 19 computed) | **0.18–0.34** (max 0.98–2.21) | см. §3 |

**Итог: путь снапшота ≈ 0.2–0.35 мс на снапшот, при 0.72–1.92 снапшота/с это 0.15–0.65 мс/с главного потока.**
Доставка снапшотов и слои — не узкое место.

Важнее другое: в большинстве сообщений меняются `stock` и `stores` (`gameMinutes+realTime+rng+stock+stores` — 53–299 из
400), т.е. объект `stock` получает новую идентичность почти каждый тик → сигнал `stock` (`src/simClient.ts:27`) будит
всех своих подписчиков с той же частотой, что и `state`.

Холодная сборка слоёв (сообщение `loaded`, кэши пусты) — **14.3–22.0 мс** на одном кадре: `ruinHints` 8.6–14.8 мс
(`src/view/layers/ruins.ts:181-191` → первый `catalogue()` в `src/sim/items.ts:89`), `roadItems` 1.1–2.3
(`roads.ts:50`), `ruinGhosts` 0.6–1.1 (`ruins.ts:48`), `buildingShapes` 0.7–1.0 (`buildings.ts:100`),
`buildingItems` 0.4–0.6 (`buildings.ts:73`). Первый вызов `catalogue` — 4.2–7.9 мс (в основном JIT), повторный
пересчёт — 2.0–2.6 мс, из кэша — 0.004 мс.

## 2. Чистые вью-модели: мс на вызов (медиана, диапазон по прогонам)

| модель | мс | вызовов на рендер / где |
|---|---|---|
| **`places.placesView`** | **5.5–9.0** | 1, `src/ui/placesModel.ts:50` ← `TownPanel.tsx:284` (вкладка «Места») |
| **`heritage.buildOutlineView`** | **2.7–5.3** | 1, `heritageModel.ts:168` ← `HeritagePanel.tsx:128` |
| `buildMenu.toolInfo` × все инструменты (~30) | 0.042–0.086 | по одному на карточку, `buildMenu.ts:152` |
| `townhall.chartOf` (79 строк) | 0.033–0.058 | 1, `townhallModel.ts:51` ← `TownhallPanel.tsx:433` |
| `topbar.roadQueue` (80 рёбер) | 0.039–0.052 | 1–2, `topbarModel.ts:74` ← `TopBar.tsx:418`, `TownPanel.tsx:212` |
| `tech.buildTechView` | 0.036–0.076 | 1, `techModel.ts:119` ← `TechPanel.tsx` |
| `museum.museumView` | 0.030–0.036 | 1, `museumModel.ts:93` ← `MuseumPanel.tsx:434`, `BuildingPanel.tsx:101` |
| `finds.findsView` | 0.014–0.027 | 1 (в `computed`), `NotebookHost.tsx:22` |
| `notebook.newestFirst` (хроника 111) | 0.014–0.021 | 1–2, `notebookLogic.ts:30` ← `Notebook.tsx:47` |
| `notebook.findsToEntries` | 0.0125–0.0133 | 1 (в `computed`), `NotebookHost.tsx:14` |
| `follow.residentPlace` (жизнь 222) | 0.011–0.020 | до 20/с при слежении, `FollowCamera.tsx:63` |
| `townhall.rowAt` | 0.005–0.0076 | по движению мыши по графику |
| `market.marketView` | 0.0035–0.0062 | 1, `marketModel.ts:30` |
| `heritage.buildHeritageView` | 0.0024–0.0043 | 1, `HeritagePanel.tsx:137` |
| `badgeFor` × 481 здание | 0.02–0.048 | 1/с, `src/map/badgeModel.ts:17` ← `view/layers/badges.ts:180` |
| `JSON.stringify(snapshot)` | 3.6–6.4 | не в игре (справочная величина) |
| всё остальное (`warnings`, `roadQueue`-мелочь, `weatherChip`, `effectLines`, `perDay`, `deltaDir`, `dayPhase`, `freshWarnings`, `governmentWarning`, `effectChips`, `eraProgress`, `buildingStatus`, `clearingView`, `jobNotes`, `researchStatusView`, `followStatus`, `signedDaily`, `formatDate`, `formatCoordinates`, `OUTPUT`) | < 0.002 каждая | — |

Рост с размером города (`withBuildings`: 120→1920 зданий, тот же город):

| модель | 120 | 240 | 480 | 960 | 1920 |
|---|---|---|---|---|---|
| `museum.museumView` | 0.011 | 0.013–0.024 | 0.017–0.031 | 0.024–0.034 | 0.033–0.055 |
| `finds.findsView` | 0.0066 | 0.010–0.012 | 0.011–0.014 | 0.010–0.015 | 0.014–0.024 |
| `count building sites` (`Object.values(buildings).filter`, как в `TopBar.tsx:420`) | 0.0023 | 0.004 | 0.006 | 0.008–0.013 | 0.020–0.025 |
| `Object.values(buildings)` | 0.0004 | 0.0006 | 0.001 | 0.002–0.003 | 0.003–0.005 |
| `tech.buildTechView` | 0.037–0.076 | — | — | — | 0.045–0.075 (не зависит) |
| `topbar.roadQueue` | 0.019–0.049 во всех (зависит от рёбер, не от зданий) | | | | |
| `places.placesView` | 5.7–7.7 во всех (зависит от старого города, не от зданий) | | | | |

`placesView` квадратичен по старому городу (улицы × признаки), замерено:

| улиц × признаков | 10×20 | 20×40 | 40×80 | 80×160 | 160×320 |
|---|---|---|---|---|---|
| мс | 0.15–0.22 | 0.24–0.45 | 0.55–1.0 | 1.1–1.8 | 2.1–4.2 |

## 3. Слои `src/view/layers/` на одном снапшоте

Replay 160 реальных сообщений `snapshot` из фикстуры через `state.value` (как `src/simClient.ts:158`), чтение всех
19 computed после каждого, время каждого чтения отдельно.

| слой (computed) | steady, медиана мс | max | file:line |
|---|---|---|---|
| **`buildings.buildingItems`** | **0.171–0.327** | 0.96–2.18 | `layers/buildings.ts:73-92` |
| `ruins.ruinGhosts` | 0.0008–0.0017 | 0.046–0.127 | `ruins.ts:48-64` (читает `buildings.value` → пересобирается) |
| `buildings.buildingShapes` | 0.0008–0.0021 | 0.009–0.037 | `buildings.ts:100-119` (sig-строка по всем зданиям) |
| `land.fields` | 0.0006–0.0012 | 0.011–0.016 | `land.ts:26-30` |
| `land.clearings` | 0.0006–0.0011 | 0.003–0.037 | `land.ts:46-50` |
| `ruins.ruinWalls` / `ruinFloors` | 0.0005–0.0009 | 0.005–0.038 | `ruins.ts:104-118` |
| `roads.roadItems` | 0.0005–0.0008 | 0.003–0.064 | `roads.ts:50-75` |
| `city.campArea` / `cityPoint` | 0.0005–0.0009 | 0.003–0.022 | `city.ts:100-116` |
| `traffic.roadTraffic` (оверлей выкл.) | 0.0003–0.0006 | 0.017–0.042 | `traffic.ts:128-143` |
| `roads.roadLines` | 0.0003–0.0005 | 0.002–0.003 | `roads.ts:83-111` |
| `ruins.ruinTyped`/`Names`/`Pois`/`Hints`/`restoredStreets` | 0.0003–0.0006 | ≤ 0.108 | `ruins.ts:121-191` |
| `land.clearingLabels` | 0.0003–0.0005 | 0.004–0.021 | `land.ts:51-61` |
| **сумма** | **0.181–0.344** | 0.98–2.21 | — |

Группами: `buildings` 0.216–0.412 мс, `ruins` 0.005–0.010, `land` 0.002–0.004, `roads`/`city`/`traffic` ≤ 0.002.
Т.е. **94–96 % стоимости слоёв — один computed** `buildingItems`, который каждый снапшот перебирает все 481 здание,
собирает 481 новый `ModelItem` и строку `itemSig` на каждое (`buildings.ts:72,80-91`), хотя меняется обычно 1–5 зданий.

Оверлей `traffic` включённый: 0.033–0.055 мс на пересборку, дальше 0.002–0.003 мс на снапшот (`traffic.ts:135`).
`reach`/`badges`/`articleMarkers` — эффекты, привязанные к `View` (без него не измерить); `reach` при пустом выборе не
читает дороги вовсе (`reach.ts:30-56`), `badges` ограничены 1 пересборкой в секунду и `MAX = 24` (`badges.ts:125,210`),
полный проход `badgeFor` по городу — 0.02–0.048 мс (`badges.ts:175-182`, выходит по `MAX`, но при малом числе зданий в
кадре идёт по всем).

## 4. Главная находка: не снапшот, а часы

`useGameMinutes` (`src/ui/useGameMinutes.ts:8-22`) — `requestAnimationFrame`-цикл, который **каждый кадр** делает
`setMinute(Math.floor(now()))`; в рендере компонент возвращает `Math.max(minute, Math.floor(now()))` (строка 21).
Preact 11 (проверено в `node_modules/preact/hooks/src/index.js:227`) байл-аутит только при равном значении, поэтому
**TopBar перерисовывается каждый раз, когда меняется игровая минута**:

* 1× → минута меняется каждые ~139 мс → **7 ре-рендеров TopBar/с**;
* 2× → ~125 мс → **8/с**;
* 4× → ~45 мс → **22/с**, ночью (×4) — **каждый кадр, до 60/с**.

При этом сама JavaScript-работа внутри одного рендера TopBar маленькая (все модели из §2, вызываемые им: `calendar`,
`weatherChip`, `effectLines`, `foodNet`, `perDay`, `deltaDir`, `dayPhase`, `researchStatusView` — суммарно ~0.01 мс), но
TopBar — самое большое поддерево HUD (6 `BarStat`+`Tooltip`, флаг, шкала суток, скорости, меню). Стоимость диффа этого
дерева в песочнице без DOM не измерена (**оценка**, не факт).

К этому добавляется `effect`+`setInterval(syncClock, 2000)` в `src/simClient.ts:61-66` (обновляет `gameClock`), из-за
которого `FollowCard` (`FollowCard.tsx:14`) перерисовывается 1/с и тянет `residentPlace` 0.011–0.020 мс.

## 5. Аудит подписок: кто читает `.value` в рендере глубоко в дереве

`state.value` (новая идентичность на каждый снапшот — `simClient.ts:158`) читают **21 компонент/функция**; каждый
перерисовывается на каждый снапшот (0.72–1.92 раза/с) даже если его часть не менялась:

| file:line | что | что нужно на самом деле |
|---|---|---|
| `src/ui/Hud.tsx:24` (`GovernmentWarning`) | весь `state` ради `gov`/`govView` | `computed(() => state.value?.govView ?? null)` |
| `src/ui/Hud.tsx:26` | `hallReady()` → `buildings.value` (`TownhallPanel.tsx:39-40`) | `activeHall` уже `computed` — ок, но читается в рендере |
| `src/ui/TopBar.tsx:132,137` | `state.clearings`, `state.weather` | `clearings`, `weather` через `computed` |
| `src/ui/TopBar.tsx:313` (`ResearchButton`) | весь `state` | `research`+`progress` |
| `src/ui/TopBar.tsx:416` (`currentWarnings`) | + `people`,`stock`,`economy`,`roads`,`buildings` → 6 подписок | узкие computed |
| `src/ui/TopBar.tsx:143` | `hallReady()` в рендере TopBar | `activeHall` |
| `src/ui/BuildBar.tsx:273` | `state.progress` | `computed(() => state.value?.progress)` |
| `src/ui/BuilderTasks.tsx:50` | весь `state` (`buildings`,`roads`,`levers`) | `buildings`/`roads` |
| `src/ui/BuildingPanel.tsx:100` (`MuseumSummary`) | весь `state` | `finds`,`buildings`,`articles` |
| `src/ui/BuildingPanel.tsx:208` (`StaffControl`) | `state.levers.jobs` | `computed` по группе |
| `src/ui/BuildingPanel.tsx:240` (`MarketSummary`) | весь `state` | `progress`,`levers.trade`,`economy.trade` |
| `src/ui/BuildingPanel.tsx:277` (`HallSummary`) | `state.govView` | `govView` |
| `src/ui/BuildingPanel.tsx:320,323,326,333` | `finds`, весь `state`, `levers` | узкие |
| `src/ui/BuildingPanel.tsx:334,401` | `stock.value` | — |
| `src/ui/ClearingPanel.tsx:18,19,28` | `state.clearings`, `state.levers` | `clearings` |
| `src/ui/HeritagePanel.tsx:122` | весь `state` | `finds`,`buildings` |
| `src/ui/InspectorParts.tsx:27,91` | `state`/`state.levers` (вложенные компоненты) | `levers` |
| `src/ui/MarketPanel.tsx:43` (`nameOfStall`, **не компонент**) | `state.value` в обычной функции — читается из рендера `MarketSummary` (`BuildingPanel.tsx:219`), подписка достаётся вызывающему компоненту | передавать имена аргументом |
| `src/ui/MarketPanel.tsx:218,407` | `state.levers.stallNames`, весь `state` | `levers` |
| `src/ui/MuseumPanel.tsx:434` | весь `state` | `finds`,`buildings` |
| `src/ui/TownPanel.tsx:46,90,119,188,211,221,282,312` | `state`/`stock`/`people`/`economy` по вкладкам | узкие computed |
| `src/ui/TownhallPanel.tsx:404,421,546` | `state.levers`, `state.history`, весь `state` | `history` |

Дополнительно: `NotebookHost.tsx:14,22,30,50` рендерит `Notebook` **всегда** (и когда книжка закрыта), а `Notebook.tsx:90-94`
считает `matchedArticles`/`matchedChronicle`/`matchedItems` **до** проверки `open` (`Notebook.tsx:109`) — то есть полный
фильтр по всем находкам/статьям/хронике выполняется на каждый ре-рендер хоста, даже при закрытой книжке.

`buildings.value` (новая идентичность при любом изменении любого здания — `delta.ts:87`) читают: `BuildingPanel.tsx:318`,
`NotebookHost.tsx:22`, `MarketPanel`/`TownhallPanel` через `hallReady()` (`Hud.tsx:26`, `TopBar.tsx:146`, `TownPanel.tsx:355`),
`ruins.ts:58,93`, `badges.ts:175`.

## 6. Остальной статический аудит `src/ui`

* **Списки без `key`** — не найдено. Проверены все `.map(`, возвращающие JSX (`src/ui/**/*.tsx`): `key=` есть везде
  (единственные `map` без `key` — над данными, не JSX: `buildings.ts`-подобные строки, `Notebook.tsx:93`,
  `TopBar.tsx:434-435`, `TownhallPanel.tsx:433`).
* **Инлайн-объекты/массивы в пропсах** — 21 `style={{…}}` и 5 `={[…]}`:
  `kit/ProgressBar.tsx:6` (используется везде — новый объект на каждый рендер каждой полоски),
  `NeedsBars.tsx:18` (4 объекта на каждый набор потребностей), `TopBar.tsx:171` (иголка суток), `TopBar.tsx:335`,
  `LayerBar.tsx:35,45,48,58,62`, `MarketPanel.tsx:111,153,198,203`, `MuseumPanel.tsx:84,119`, `TechPanel.tsx:300,333`,
  `TownhallPanel.tsx:373,501,525`, `DaySummary.tsx:72`; массивы: `BuildBar.tsx:298,335`, `MarketPanel.tsx:359`,
  `MuseumPanel.tsx:328`, `TownPanel.tsx:355`. В Preact это не экономия, а лишние аллокации в куче каждый рендер.
* **Эффекты с нестабильными зависимостями** — 25 `useEffect`, серьёзных нет. Единственный «на каждый рендер»:
  `Notebook.tsx:88` (`onSeen` — новая функция из `NotebookHost.tsx:34`), но тело защищено `total !== seen`.
  `TopBar.tsx:445` (`[currentKey]`) — строка, ок. `BuildingPanel.tsx:158` (`bump` — строка), ок.
* **Анимации CSS в бесконечном цикле** — одна: `src/ui/tech.css:694` (`animation: tf-hover 5.5s … infinite`), только в
  открытой панели технологий.
* **localState на каждый кадр**:
  * `useGameMinutes.ts:13` — `setMinute` каждый кадр (значение меняется 7–22 раза/с, см. §4) — **главный источник
    ре-рендеров**;
  * `DaySummary.tsx:34-41` — `setRemaining(next)` каждый кадр, пока карточка «Итоги дня» на экране (5 с), значение меняется
    каждый кадр → 60 ре-рендеров/с на 5 с;
  * `FpsCounter.tsx:20-54` — `setInterval` нет, но `requestAnimationFrame` вечный; сигналы обновляются раз в 1000 мс
    (3 сигнала → 1 ре-рендер/с), `samples.shift()` при `HISTORY = 120` — O(120) на кадр. Сам по себе дешёвый, но
    единственный компонент, который крутит кадры всегда;
  * `FollowCamera.tsx:52-80` — кадровый цикл с троттлингом 50 мс и `peek()` (без подписок) — сделано правильно.
* **Тяжёлые вычисления в теле компонента** (не в `computed`): `TownPanel.tsx:282-284` (`placesView` 5.5–9 мс на каждый
  рендер вкладки «Места»), `HeritagePanel.tsx:128` (`buildOutlineView` 2.7–5.3 мс), `Notebook.tsx:90-94`,
  `BuildingPanel.tsx:320` (`finds.foundations.find` на каждый рендер), `TopBar.tsx:132,420` (`filter` по всем зданиям),
  `MuseumPanel.tsx:216` (`Object.values(st.roads.edges)` + геометрия в рендере).

## 7. Что чинить и сколько это даст

| # | правка | ожидаемый выигрыш | риск |
|---|---|---|---|
| 1 | **Вынести часы из TopBar**: `useGameMinutes` оставить только в маленьком `<Clock/>` (шкала суток + время + скорости), остальное — отдельные компоненты, читающие `speed`/`city`. | −7…22 ре-рендеров всего TopBar в секунду (до −60/с на 4× ночью). Модельная работа одного рендера — 0.01 мс, но уходит дифф самого большого поддерева HUD; оцениваю как **основной выигрыш по главному потоку** (величина не измерена — нет DOM). | низкий: чисто структурный рефакторинг, тесты на `useGameMinutes` не завязаны на TopBar |
| 2 | **`streetFoundations` — в кэш по идентичности** (`finds.streets`, `finds.foundations`), как уже сделано для `foundationIndex` (`src/sim/foundationLots.ts:145-148`); `streetProgress` перестать считать `Object.values(buildings)` на каждую улицу (`src/sim/streets.ts:95`). | `buildOutlineView` 2.7–5.3 → ~0.3 мс (−90 %), `placesView` −1.7…−2.7 мс (`streets.ts:39-58` вызывается дважды из `digging.ts:89-101`), `streetProgress × 40` 0.96–1.5 → ~0.05 мс. | низкий: чистая функция, кэш по неизменяемым массивам (так же, как `catalogue`/`foundationIndex`) |
| 3 | **`placesView`: вынести `nearestStreet` из цикла по улицам** — посчитать ближайшую улицу для каждого «номерного» признака один раз (`src/ui/placesModel.ts:64`), вместо `O(улицы² × признаки × сегменты)`. | `placesView` 5.5–9.0 → ~0.9–1.2 мс (−80…85 %); на 160 улицах ×320 признаках 2.1–4.2 → ~0.3 мс. | низкий: чистый цикл, результат тот же (проверяется `placesModel.test.ts`) |
| 4 | **`buildingItems`: обновлять по патчу, а не пересобирать город** — перебирать только изменившиеся id (дельты уже несут `patch.buildings`, `src/sim/delta.ts:15,59`), либо кэшировать `ModelItem` по `b` и пересобирать массив только при смене набора id + сигнатуры. | 0.17–0.33 → ~0.01 мс на снапшот (−94…96 % всей стоимости слоёв; сейчас это 94–96 % суммы). На 1920 зданиях выигрыш растёт линейно. | средний: нужно прокинуть информацию «что изменилось» в слой (или сравнивать по `b`-идентичности, что дешевле: объект здания уже сохраняет идентичность, если не менялся — `delta.ts:30`) |
| 5 | **Узкие computed вместо `state.value`**: `progress`, `levers`, `govView`, `weather`, `clearings`, `history` — по одному `computed` на часть (12–21 подписчик из §5 перестанет просыпаться на `stock`/`stores`). | снимает 0.7–1.9 лишних ре-рендеров/с с каждого из ~21 компонента; плюс убирает чтение `state.value` из обычной функции `nameOfStall` (`MarketPanel.tsx:43`). | низкий |
| 6 | **`Notebook`: считать фильтр только при `open`** (`Notebook.tsx:90-94` до `if (!open)`): перенести в `useMemo` с зависимостями `[open, q, items, articles, chronicle]`. | 0.02–0.05 мс с каждого ре-рендера хоста → 0 при закрытой книжке. | низкий |
| 7 | **`DaySummary`: не гонять `setRemaining` каждый кадр** — обновлять 4–5 раз/с (или через CSS-анимацию ширины) вместо 60. | −55 ре-рендеров/с на 5 с показа карточки. | низкий |
| 8 | **`ruinHints`/`catalogue` при загрузке**: прогреть `catalogue` в `requestIdleCallback` после `loaded` (сейчас первый кадр ловит 4–8 мс JIT+пересчёт) | −4…8 мс на первом кадре загрузки (14.3–22.0 мс холодной сборки слоёв). | низкий |

## 8. Созданные файлы стенда и запуск

| файл | что мерит |
|---|---|
| `perf/bench/ui/town.ts` | город через настоящий `Handler` (дорога, `placeStroke`, `admin`, `recordFinds`, дни игры) |
| `perf/bench/ui/fixture.ts` | кэш фикстуры `.fixture.json`, `time()` (медиана/мин/p90), `withBuildings()` для кривых роста |
| `perf/bench/ui/fixture.test.ts` | печатает состав фикстуры и проверяет, что она «как сейв середины игры» |
| `perf/bench/ui/models.test.ts` | стоимость ~40 чистых вью-моделей, рост с городом, квадратичность `placesView`, пайплайн `snapshotDelta`/`applyDelta` |
| `perf/bench/ui/layers.test.ts` | холодная и steady-пересборка всех слоёв `src/view/layers/`, `catalogue`, `badgeFor` |
| `perf/bench/ui/publish.test.ts` | сколько снапшотов в секунду на 1×/2×/4×, размеры сообщений, игровые минуты/с |
| `perf/bench/ui/hotspots.test.ts` | разложение `placesView` и `buildOutlineView` по частям (`streetFoundations`, `streetProgress`, `digBlocker`, `streetOf`, `streetDigs`) |
| `perf/bench/ui/signals.ts`, `stubs.ts` | заглушки `Worker`/`document` и загрузка `src/simClient.ts` в Node |

```bash
# всё сразу (~3 с, если .fixture.json уже есть; первый прогон ~10 с на постройку города)
npx vitest run --config vitest.perf.config.ts perf/bench/ui/ --reporter=verbose

# по одному
npx vitest run --config vitest.perf.config.ts perf/bench/ui/models.test.ts --reporter=verbose
npx vitest run --config vitest.perf.config.ts perf/bench/ui/layers.test.ts --reporter=verbose
npx vitest run --config vitest.perf.config.ts perf/bench/ui/publish.test.ts --reporter=verbose
npx vitest run --config vitest.perf.config.ts perf/bench/ui/hotspots.test.ts --reporter=verbose
npx vitest run --config vitest.perf.config.ts perf/bench/ui/fixture.test.ts --reporter=verbose

# пересобрать фикстуру
rm perf/bench/ui/.fixture.json
```

## 9. Что осталось непокрытым

* Стоимость диффа/патча Preact (в песочнице нет DOM) — измерена частота ре-рендеров, не их цена.
* `view/engine/` (загрузка буферов WebGPU при смене слоёв) — вне задачи; но `buildingItems`/`buildingShapes` меняются
  каждый снапшот, значит движок получает новый список моделей 0.7–1.9 раза/с.
* Статьи (`state.articles`) в фикстуре пусты: они приходят из Википедии (сеть). `findsView`/`museumView`/`catalogue`
  на реальном сейве с десятками статей будут дороже — пропорционально числу статей (`findsModel.ts:29`, `items.ts:147-158`).
