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
import { Segmented, Tabs, Tooltip } from "./kit";
import { storedChoice } from "./preferenceModel";
import { LANDMARK_LABELS } from "./semanticModel";
import { tabId, tabPanelId } from "./tabSemantics";

const CATEGORY_STORE = "rebirth.build.category";
const CATEGORY_IDS = CATEGORIES.map((c) => c.id);
const readCategory = (): CategoryId => {
  try {
    return storedChoice(localStorage.getItem(CATEGORY_STORE), CATEGORY_IDS, "roads");
  } catch {
    return "roads";
  }
};
const category = signal<CategoryId>(readCategory());
effect(() => {
  const id = category.value;
  try {
    localStorage.setItem(CATEGORY_STORE, id);
  } catch {
    /* ignore */
  }
});

const ROAD_HINT: Record<RoadMode, string> = {
  straight: "Протяните от начала до конца — прямая; Shift — угол 15°, Пробел — двигать карту, ПКМ или Esc — закончить",
  arc: "Протяните от начала до конца (или клик, клик), затем движение мышью — изгиб, клик — готово; Shift — угол 15°, ПКМ или Esc — отмена",
};
const BRUSH_HINT = "Тяните — закрасить, Shift+клик — вся сторона дороги, Пробел — двигать карту, Esc — выйти";
const PLACE_HINT = "Клик — поставить у дороги, ПКМ или Esc — выйти";
const service = (id: keyof typeof SERVICES, tail: string) => `${PLACE_HINT}. Подсветка дорог — охват ${SERVICES[id].reach} м по дорогам${tail}`;

const HINT: Partial<Record<Tool, string>> = {
  bulldoze: "Клик по участку — снести, Esc — выйти",
  restore: "Наведите на раскопанную улицу — она подсветится целиком с ценой, клик — восстановить, Esc — выйти",
  res: BRUSH_HINT,
  craft: BRUSH_HINT,
  trade: BRUSH_HINT,
  clear: `${BRUSH_HINT}. Клик по полю или вырубке в работе — убрать`,
  gumno: `${PLACE_HINT}. Круг — досягаемость полей (${FIELD.radius} м)`,
  woodcutter: `${PLACE_HINT}. Круг — лес вокруг (${SITE_RADIUS.woodcutter} м)`,
  sawpit: PLACE_HINT,
  quarry: PLACE_HINT,
  fisher: `${PLACE_HINT}. Круг — вода рядом (${SITE_RADIUS.fisher} м)`,
  garden: PLACE_HINT,
  hunter: PLACE_HINT,
  forager: `${PLACE_HINT}. Круг — лес вокруг (${SITE_RADIUS.forager} м)`,
  orchard: PLACE_HINT,
  apiary: PLACE_HINT,
  cellar: PLACE_HINT,
  barn: PLACE_HINT,
  well: service("well", ""),
  market: service("market", ", нужны работники"),
  chapel: service("chapel", ", нужен работник"),
  school: service("school", ", нужны работники"),
  healer: service("healer", ", нужен работник"),
  dig: `${PLACE_HINT}. Круг — первое вскрытие (${DIG.startRadius} м), потом растёт до ${DIG.maxRadius} м и снимается, а найденное остаётся на карте`,
  field: "Клик — вершина, клик по первой точке или Enter — замкнуть, ПКМ — отменить точку, Esc — сбросить",
  clearing: "Как поле: контур леса до 5 га у построенной дороги (до 300 м). Строители рубят после строек, а когда брёвен на складе меньше, чем на дом, — раньше них. Брёвна идут на склад, земля станет лугом",
};

const ADVICE: Record<GrowthWhy, string | null> = {
  ok: null,
  nozone: "Не растёт: нет размеченных участков",
  demand: "Не растёт: нет спроса",
  lots: "Не растёт: нет свободных участков у построенной дороги",
  hands: "Не растёт: некому строить",
  materials: "Растёт медленно: не хватает материалов, часть работы делают вручную",
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
    e.preventDefault();
    return;
  }
  const t = toolForKey(e.code, category.value);
  if (!t) return;
  category.value = categoryOf(t).id;
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
          <span>Работа</span>
          <span>{i.labor}</span>
        </span>
      )}
      {i.materials.length > 0 && (
        <span class="tip-row">
          <span>Материалы</span>
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
          <span>Рабочих мест</span>
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
    <div class="bb-cost" aria-label="Стоимость">
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
        if (t) category.value = categoryOf(t).id;
      }),
    [],
  );
  const active = tool.value;
  const cat = CATEGORIES.find((c) => c.id === category.value)!;
  const msg = toolMsg.value;
  const progress = state.value?.progress;
  const growth = active === "res" || active === "craft" || active === "trade" ? ADVICE[people.value?.growth?.[active] ?? "ok"] : null;
  const mode = roadMode.value;
  const drawsRoad = !!active && isRoadTool(active) && active !== "bulldoze" && active !== "restore";
  const materials = active && isMaterialTool(active) ? ROAD_MATERIALS[active] : null;
  const hint = active ? (drawsRoad ? ROAD_HINT[mode] : HINT[active]) : null;
  return (
    <section class="build-bar" aria-label={LANDMARK_LABELS.build}>
      <div class="bb-lines" aria-live="polite">
        {msg ? (
          <div class="road-msg">{msg}</div>
        ) : (
          <div class="road-hint">
            {hint ?? (typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches ? "Два пальца — наклон" : "Правая кнопка — наклон")}
            {growth && <div>{growth}</div>}
          </div>
        )}
        {drawsRoad && <Segmented label="Режим дороги" value={mode} onChange={(m) => (roadMode.value = m)} options={ROAD_MODES.map((o) => ({ id: o.id, label: o.label, title: o.title }))} />}
        {materials && active && isMaterialTool(active) && (
          <Segmented
            label={active === "dirt" ? "Материал дороги" : "Материал моста"}
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
      <div class="bb-panel panel">
        <Tabs
          class="bb-tabs"
          label="Разделы стройки"
          idPrefix="build"
          active={cat.id}
          onChange={(id) => (category.value = id)}
          tabs={CATEGORIES.map((c, i) => ({
            id: c.id,
            label: (
              <>
                {c.label}
                <kbd>{CATEGORY_KEYS[i]}</kbd>
              </>
            ),
          }))}
        />
        <div class="bb-items" role="tabpanel" id={tabPanelId("build", cat.id)} aria-labelledby={tabId("build", cat.id)}>
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
                <Icon name={TOOL_ICON[t]} size={22} />
                <span class="bb-name">{toolLabel(t)}</span>
                <kbd>{t === "bulldoze" ? "B" : ITEM_KEY_LABEL[i]}</kbd>
                {lock && <Icon name="lock" size={14} class="bb-lock" />}
              </button>
            </Tooltip>
            );
          })}
        </div>
      </div>
    </section>
  );
}
