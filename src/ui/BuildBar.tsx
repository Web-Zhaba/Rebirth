import { effect, signal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import { flash, isMaterialTool, isRoadTool, ROAD_MATERIALS, ROAD_MODES, roadKindOf, roadMaterial, roadMode, toolMsg, tool, SITE_RADIUS, type RoadMode, type Tool } from "../map/tools";
import { lockReason } from "../sim/tech";
import { DIG } from "../sim/excavation";
import { FIELD } from "../sim/fields";
import { SERVICES } from "../sim/services";
import type { GrowthWhy } from "../sim/types";
import { people, state } from "../simClient";
import { CATEGORIES, CATEGORY_KEYS, categoryOf, ITEM_KEY_LABEL, toolForKey, toolInfo, toolLabel, TOOL_ICON, type CategoryId } from "./buildMenu";
import { Icon } from "./Icon";
import type { IconName } from "./icons";
import { Segmented, Tooltip } from "./kit";
import { storedChoice } from "./preferenceModel";
import { LANDMARK_LABELS } from "./semanticModel";
import { L } from "../i18n";
import { touchScreen } from "../map/motion";

const CATEGORY_STORE = "rebirth.build.category";
const CATEGORY_IDS = CATEGORIES.map((c) => c.id);
const TRAY_ID = "build-tray";
const readCategory = (): CategoryId => {
  try {
    return storedChoice(localStorage.getItem(CATEGORY_STORE), CATEGORY_IDS, "roads");
  } catch {
    return "roads";
  }
};
const category = signal<CategoryId>(readCategory());
// The tray of the category's tools is open; closed, only the dock of categories stays on screen.
const TRAY_STORE = "rebirth.build.tray";
const readTray = (): boolean => {
  try {
    return localStorage.getItem(TRAY_STORE) !== "0";
  } catch {
    return true;
  }
};
const trayOpen = signal(readTray());
effect(() => {
  const id = category.value;
  const open = trayOpen.value;
  try {
    localStorage.setItem(CATEGORY_STORE, id);
    localStorage.setItem(TRAY_STORE, open ? "1" : "0");
  } catch {
    /* ignore */
  }
});

const CATEGORY_ICON: Record<CategoryId, IconName> = { roads: "dirt", zones: "res", food: "food", farm: "log", services: "well", past: "dig" };

// A category button: the live one with its tray open closes it, any other opens its own.
const pickCategory = (id: CategoryId): void => {
  if (category.peek() === id && trayOpen.peek()) trayOpen.value = false;
  else {
    category.value = id;
    trayOpen.value = true;
  }
};

// Arrow keys, Home and End move along the dock (roving focus, like a tab strip).
function onDockKey(e: KeyboardEvent): void {
  const buttons = [...(e.currentTarget as HTMLElement).querySelectorAll<HTMLElement>("button")];
  const i = buttons.indexOf(document.activeElement as HTMLElement);
  const to = e.key === "ArrowRight" ? (i + 1) % buttons.length : e.key === "ArrowLeft" ? (i - 1 + buttons.length) % buttons.length : e.key === "Home" ? 0 : e.key === "End" ? buttons.length - 1 : -1;
  if (to < 0) return;
  e.preventDefault();
  buttons[to]?.focus();
}

// Hints for a mouse and keyboard, and for a finger: no hover, no right button, no Esc; the tool's own button exits.
const EXIT_TOUCH = L("повторный тап по инструменту — выйти", "tap the tool again to exit");
function hints(touch: boolean): { road: Record<RoadMode, string>; tool: Partial<Record<Tool, string>> } {
  const road: Record<RoadMode, string> = touch
    ? {
        straight: L(`Протяните от начала до конца или тап, тап — прямая; ${EXIT_TOUCH}`, `Drag from start to end, or tap, tap — straight; ${EXIT_TOUCH}`),
        arc: L(`Протяните от начала до конца (или тап, тап), затем протяните — изгиб, отпустите — готово; ${EXIT_TOUCH}`, `Drag from start to end (or tap, tap), then drag to bend and release to finish; ${EXIT_TOUCH}`),
      }
    : {
        straight: L("Протяните от начала до конца — прямая; Shift — угол 15°, Пробел — двигать карту, ПКМ или Esc — закончить", "Drag from start to end — straight; Shift — 15° steps, Space — pan the map, RMB or Esc — finish"),
        arc: L("Протяните от начала до конца (или клик, клик), затем движение мышью — изгиб, клик — готово; Shift — угол 15°, ПКМ или Esc — отмена", "Drag from start to end (or click, click), then move the mouse to bend, click to finish; Shift — 15° steps, RMB or Esc — cancel"),
      };
  const brush = touch
    ? L(`Ведите пальцем — закрасить, двумя пальцами — двигать карту; ${EXIT_TOUCH}`, `Drag a finger to paint, two fingers to move the map; ${EXIT_TOUCH}`)
    : L("Тяните — закрасить, Shift+клик — вся сторона дороги, Пробел — двигать карту, Esc — выйти", "Drag to paint, Shift+click — the whole side of a road, Space — pan the map, Esc — exit");
  const place = touch
    ? L(`Тап — показать участок у дороги или старый фундамент, второй тап — поставить; ${EXIT_TOUCH}`, `Tap to show a lot by a road or an old foundation, tap it again to place; ${EXIT_TOUCH}`)
    : L("Клик — поставить у дороги или на старый фундамент, ПКМ или Esc — выйти", "Click to place by a road or on an old foundation, RMB or Esc — exit");
  const service = (id: keyof typeof SERVICES, tail: string) => `${place}. ${L(`Подсветка дорог — охват ${SERVICES[id].reach} м по дорогам`, `Highlighted roads — reach ${SERVICES[id].reach} m by road`)}${tail}`;
  const tool: Partial<Record<Tool, string>> = {
    bulldoze: touch ? L(`Тап по участку — снести; ${EXIT_TOUCH}`, `Tap a section to demolish; ${EXIT_TOUCH}`) : L("Клик по участку — снести, Esc — выйти", "Click a section to demolish, Esc — exit"),
    restore: touch
      ? L(`Тап по раскопанной улице — она подсветится целиком с ценой, второй тап — восстановить; ${EXIT_TOUCH}`, `Tap an excavated street — it lights up whole with its cost; tap again to restore; ${EXIT_TOUCH}`)
      : L("Наведите на раскопанную улицу — она подсветится целиком с ценой, клик — восстановить, Esc — выйти", "Hover over an excavated street — it lights up whole with its cost; click to restore, Esc — exit"),
    res: brush,
    craft: brush,
    trade: brush,
    clear: `${brush}. ${touch ? L("Тап по полю или вырубке в работе — убрать", "Tap a field or an active clearing to remove it") : L("Клик по полю или вырубке в работе — убрать", "Click a field or an active clearing to remove it")}`,
    gumno: `${place}. ${L(`Круг — досягаемость полей (${FIELD.radius} м)`, `Circle — field reach (${FIELD.radius} m)`)}`,
    woodcutter: `${place}. ${L(`Круг — лес вокруг (${SITE_RADIUS.woodcutter} м)`, `Circle — forest around (${SITE_RADIUS.woodcutter} m)`)}`,
    sawpit: place,
    quarry: place,
    fisher: `${place}. ${L(`Круг — вода рядом (${SITE_RADIUS.fisher} м)`, `Circle — water nearby (${SITE_RADIUS.fisher} m)`)}`,
    garden: place,
    hunter: place,
    forager: `${place}. ${L(`Круг — лес вокруг (${SITE_RADIUS.forager} м)`, `Circle — forest around (${SITE_RADIUS.forager} m)`)}`,
    orchard: place,
    apiary: place,
    cellar: place,
    barn: place,
    well: service("well", ""),
    market: service("market", L(", нужны работники", ", needs workers")),
    chapel: service("chapel", L(", нужен работник", ", needs a worker")),
    school: service("school", L(", нужны работники", ", needs workers")),
    healer: service("healer", L(", нужен работник", ", needs a worker")),
    dig: `${place}. ${L(`Круг — первое вскрытие (${DIG.startRadius} м), потом растёт до ${DIG.maxRadius} м и снимается, а найденное остаётся на карте`, `Circle — the first opening (${DIG.startRadius} m); it grows to ${DIG.maxRadius} m and is then removed, while the finds stay on the map`)}`,
    field: touch
      ? L(`Тап — вершина, тап по первой точке — замкнуть, тап по последней — убрать её; ${EXIT_TOUCH}`, `Tap — add a corner, tap the first point — close, tap the last one — remove it; ${EXIT_TOUCH}`)
      : L("Клик — вершина, клик по первой точке или Enter — замкнуть, ПКМ — отменить точку, Esc — сбросить", "Click — add a corner, click the first point or Enter — close, RMB — undo a point, Esc — reset"),
    clearing: L("Как поле: контур леса до 5 га у построенной дороги (до 300 м). Строители рубят после строек, а когда брёвен на складе меньше, чем на дом, — раньше них. Брёвна идут на склад, земля станет лугом", "Like a field: an outline of forest up to 5 ha near a built road (within 300 m). Builders fell it after the building sites, or before them when the store holds fewer logs than a house needs. Logs go to the store; the land becomes meadow"),
  };
  return { road, tool };
}
const HINTS = { mouse: hints(false), touch: hints(true) };

const ADVICE: Record<GrowthWhy, string | null> = {
  ok: null,
  nozone: L("Не растёт: нет размеченных участков", "Not growing: no zoned plots"),
  demand: L("Не растёт: нет спроса", "Not growing: no demand"),
  lots: L("Не растёт: нет свободных участков у построенной дороги", "Not growing: no free plots along a built road"),
  hands: L("Не растёт: некому строить", "Not growing: no one to build"),
  materials: L("Растёт медленно: не хватает материалов, часть работы делают вручную", "Growing slowly: short of materials, part of the work is done by hand"),
};

// Why a tool is closed (the tech that opens it), or null. Before the town is loaded nothing is locked.
const lockOf = (t: Tool): string | null => {
  const progress = state.peek()?.progress;
  return progress ? lockReason({ progress }, t) : null;
};

const isTyping = (el: HTMLElement | null) => !!el && (["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName) || el.isContentEditable || !!el.closest("dialog"));

// F1-F5 pick a category, Q W E R T Y U I an item of it, B demolish. Layout independent (key codes).
function onKey(e: KeyboardEvent): void {
  if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey || e.repeat) return;
  const el = e.target as HTMLElement | null;
  if (isTyping(el)) return;
  const f = CATEGORY_KEYS.indexOf(e.code as (typeof CATEGORY_KEYS)[number]);
  if (f >= 0) {
    category.value = CATEGORIES[f].id;
    trayOpen.value = true;
    e.preventDefault();
    return;
  }
  const t = toolForKey(e.code, category.value);
  if (!t) return;
  category.value = categoryOf(t).id;
  trayOpen.value = true;
  if (lockOf(t)) {
    flash(lockOf(t)!);
    e.preventDefault();
    return;
  }
  tool.value = tool.peek() === t ? null : t;
  e.preventDefault();
}

// Esc closes the hover card (it follows focus); the tools drop themselves on Esc.
function onEsc(e: KeyboardEvent): void {
  if (e.key !== "Escape") return;
  const el = document.activeElement as HTMLElement | null;
  if (el && el.closest(".build-bar")) el.blur();
}

function Card({ t, lock }: { t: Tool; lock: string | null }) {
  const i = toolInfo(t);
  return (
    <>
      <b class="tip-title">{i.label}</b>
      {lock && <span class="bc-lock">{lock}</span>}
      <span class="bc-purpose">{i.purpose}</span>
      {i.labor && (
        <span class="tip-row">
          <span>{L("Работа", "Labour")}</span>
          <span>{i.labor}</span>
        </span>
      )}
      {i.materials.length > 0 && (
        <span class="tip-row">
          <span>{L("Материалы", "Materials")}</span>
          <span class="bc-mats">
            {i.materials.map((m) => (
              <span key={m.icon} class="bc-mat">
                <Icon name={m.icon} size={14} />
                {m.text}
              </span>
            ))}
          </span>
        </span>
      )}
      {i.jobs !== null && (
        <span class="tip-row">
          <span>{L("Рабочих мест", "Jobs")}</span>
          <span>{i.jobs}</span>
        </span>
      )}
      <span class="bc-site">{i.site}</span>
      {i.reach && <span class="bc-site">{i.reach}</span>}
    </>
  );
}

// Cost of the active tool, shown above the bar next to the hint.
function CostLine({ t }: { t: Tool }) {
  const i = toolInfo(t);
  if (!i.labor) return null;
  return (
    <div class="bb-cost" aria-label={L("Стоимость", "Cost")}>
      <b>{i.label}</b>
      <span>{i.labor}</span>
      {i.materials.map((m) => (
        <span key={m.icon} class="bc-mat">
          <Icon name={m.icon} size={14} />
          {m.text}
        </span>
      ))}
    </div>
  );
}

export function BuildBar() {
  useEffect(() => {
    window.addEventListener("keydown", onKey);
    window.addEventListener("keydown", onEsc);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keydown", onEsc);
    };
  }, []);
  // A stone material that is not open (another town loaded) falls back to the plain one.
  useEffect(
    () =>
      effect(() => {
        const progress = state.value?.progress;
        if (!progress) return;
        const cur = roadMaterial.peek();
        const next = { ...cur };
        for (const k of ["dirt", "bridge"] as const) if (lockReason({ progress }, cur[k])) next[k] = k;
        if (next.dirt !== cur.dirt || next.bridge !== cur.bridge) roadMaterial.value = next;
      }),
    [],
  );
  // A tool picked elsewhere (hotkey, map) brings its category to the front.
  useEffect(
    () =>
      effect(() => {
        const t = tool.value;
        if (t) {
          category.value = categoryOf(t).id;
          trayOpen.value = true;
        }
      }),
    [],
  );
  const active = tool.value;
  const cat = CATEGORIES.find((c) => c.id === category.value)!;
  const open = trayOpen.value;
  const msg = toolMsg.value;
  const progress = state.value?.progress;
  const growth = active === "res" || active === "craft" || active === "trade" ? ADVICE[people.value?.growth?.[active] ?? "ok"] : null;
  const mode = roadMode.value;
  const drawsRoad = !!active && isRoadTool(active) && active !== "bulldoze" && active !== "restore";
  const materials = active && isMaterialTool(active) ? ROAD_MATERIALS[active] : null;
  const h = touchScreen() ? HINTS.touch : HINTS.mouse;
  const hint = active ? (drawsRoad ? h.road[mode] : h.tool[active]) : null;
  return (
    <section class="build-bar" aria-label={LANDMARK_LABELS.build}>
      <div class="bb-lines" aria-live="polite">
        {msg && <div class="road-msg">{msg}</div>}
        {(hint || growth) && (
          <div class="road-hint">
            {hint}
            {growth && <div>{growth}</div>}
          </div>
        )}
        {drawsRoad && <Segmented label={L("Режим дороги", "Road mode")} value={mode} onChange={(m) => (roadMode.value = m)} options={ROAD_MODES.map((o) => ({ id: o.id, label: o.label, title: o.title }))} />}
        {materials && active && isMaterialTool(active) && (
          <Segmented
            label={active === "dirt" ? L("Материал дороги", "Road material") : L("Материал моста", "Bridge material")}
            value={roadKindOf(active)!}
            onChange={(k) => (roadMaterial.value = { ...roadMaterial.value, [active]: k })}
            options={materials.map((o) => {
              const lock = progress ? lockReason({ progress }, o.id) : null;
              return { id: o.id, label: o.label, title: lock ? `${o.title}: ${lock}` : o.title, disabled: !!lock };
            })}
          />
        )}
        {active && !msg && <CostLine t={active} />}
      </div>
      <div class={`bb-panel${open ? " is-open" : ""}`}>
        {open && (
          <div class="bb-items" role="group" id={TRAY_ID} aria-label={cat.label}>
            {cat.tools.map((t, i) => {
              const lock = progress ? lockReason({ progress }, t) : null;
              return (
                <Tooltip key={t} side="top" align={i >= 4 ? "end" : "start"} text={<Card t={t} lock={lock} />}>
                  <button
                    type="button"
                    class={`${active === t ? "build-btn on" : "build-btn"}${lock ? " locked" : ""}`}
                    aria-pressed={active === t}
                    aria-disabled={lock ? true : undefined}
                    aria-keyshortcuts={t === "bulldoze" ? `${ITEM_KEY_LABEL[i]} B` : ITEM_KEY_LABEL[i]}
                    onClick={() => (lock ? flash(lock) : (tool.value = active === t ? null : t))}
                  >
                    <Icon name={TOOL_ICON[t]} size={20} />
                    <span class="bb-name">{toolLabel(t)}</span>
                    {lock && <Icon name="lock" size={12} class="bb-lock" />}
                  </button>
                </Tooltip>
              );
            })}
          </div>
        )}
        <div class="bb-cats" role="toolbar" aria-label={L("Разделы стройки", "Building categories")} onKeyDown={onDockKey}>
          {CATEGORIES.map((c, i) => {
            const live = c.id === cat.id;
            return (
              <button
                key={c.id}
                type="button"
                class={`bb-cat${live ? " on" : ""}${live && open ? " open" : ""}`}
                aria-expanded={live && open}
                aria-controls={live && open ? TRAY_ID : undefined}
                aria-keyshortcuts={CATEGORY_KEYS[i]}
                title={`${c.label} · ${CATEGORY_KEYS[i]}`}
                tabIndex={live ? 0 : -1}
                onClick={() => pickCategory(c.id)}
              >
                <Icon name={CATEGORY_ICON[c.id]} size={18} />
                <span class="bb-cat-name">{c.label}</span>
                {c.tools.includes(active as Tool) && <span class="bb-cat-live" aria-hidden="true" />}
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}
