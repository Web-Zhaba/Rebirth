import { toolMsg, tool, type Tool } from "../map/tools";
import type { GrowthWhy } from "../sim/types";
import { people } from "../simClient";
import { Icon } from "./Icon";
import type { IconName } from "./icons";

const TOOL_ICON: Record<Tool, IconName> = {
  path: "path",
  dirt: "dirt",
  bulldoze: "bulldoze",
  res: "res",
  craft: "craft",
  trade: "trade",
  field: "field",
  clearing: "clearing",
  clear: "eraser",
  gumno: "gumno",
  woodcutter: "woodcutter",
  sawpit: "sawpit",
  quarry: "quarry",
  fisher: "fisher",
  barn: "barn",
  well: "well",
  market: "market",
  chapel: "chapel",
  school: "school",
  healer: "healer",
  dig: "dig",
};

const GROUPS: { title: string; buttons: { id: Tool; label: string }[] }[] = [
  {
    title: "Дороги",
    buttons: [
      { id: "path", label: "Тропа" },
      { id: "dirt", label: "Дорога" },
      { id: "bulldoze", label: "Снос" },
    ],
  },
  {
    title: "Зоны",
    buttons: [
      { id: "res", label: "Жильё" },
      { id: "craft", label: "Ремесло" },
      { id: "trade", label: "Торговля" },
      { id: "field", label: "Поле" },
      { id: "clearing", label: "Вырубка" },
      { id: "clear", label: "Снять зону" },
    ],
  },
  {
    title: "Постройки",
    buttons: [
      { id: "gumno", label: "Гумно" },
      { id: "woodcutter", label: "Лесоруб" },
      { id: "sawpit", label: "Пильня" },
      { id: "quarry", label: "Каменоломня" },
      { id: "fisher", label: "Рыбак" },
      { id: "barn", label: "Амбар" },
    ],
  },
  {
    title: "Службы",
    buttons: [
      { id: "well", label: "Колодец" },
      { id: "market", label: "Рынок" },
      { id: "chapel", label: "Часовня" },
      { id: "school", label: "Школа" },
      { id: "healer", label: "Лекарь" },
      { id: "dig", label: "Раскоп" },
    ],
  },
];

const ROAD_HINT = "Клик — точка, ПКМ или Esc — закончить";
const BRUSH_HINT = "Тяните — закрасить, Shift+клик — вся сторона дороги, Пробел — двигать карту, Esc — выйти";

const PLACE_HINT = "Клик — поставить у дороги, ПКМ или Esc — выйти";

const HINT: Record<Tool, string> = {
  path: ROAD_HINT,
  dirt: ROAD_HINT,
  bulldoze: "Клик по участку — снести, Esc — выйти",
  res: BRUSH_HINT,
  craft: BRUSH_HINT,
  trade: BRUSH_HINT,
  clear: `${BRUSH_HINT}. Клик по полю или вырубке в работе — убрать`,
  gumno: `${PLACE_HINT}. Круг — досягаемость полей (400 м)`,
  woodcutter: `${PLACE_HINT}. Круг — лес вокруг (150 м)`,
  sawpit: PLACE_HINT,
  quarry: PLACE_HINT,
  fisher: `${PLACE_HINT}. Круг — вода рядом (100 м)`,
  barn: PLACE_HINT,
  well: `${PLACE_HINT}. Подсветка дорог — охват 150 м по дорогам`,
  market: `${PLACE_HINT}. Подсветка дорог — охват 800 м, нужны работники`,
  chapel: `${PLACE_HINT}. Подсветка дорог — охват 1000 м, нужен работник`,
  school: `${PLACE_HINT}. Подсветка дорог — охват 800 м, нужны работники`,
  healer: `${PLACE_HINT}. Подсветка дорог — охват 1000 м, нужен работник`,
  dig: `${PLACE_HINT}. Круг — первое вскрытие (15 м), потом растёт до 120 м`,
  field: "Клик — вершина, клик по первой точке или Enter — замкнуть, ПКМ — отменить точку, Esc — сбросить",
  clearing: "Как поле: контур леса до 5 га у построенной дороги (до 300 м). Артель рубит после строек, а когда брёвен на складе меньше чем на избу — раньше них. Брёвна идут на склад, земля станет лугом",
};

const ADVICE: Record<GrowthWhy, string | null> = {
  ok: null,
  nozone: "Не растёт: нет размеченных участков",
  demand: "Не растёт: нет спроса",
  lots: "Не растёт: нет свободных участков у построенной дороги",
  hands: "Не растёт: некому строить",
  materials: "Растёт медленно: не хватает материалов, часть работы делают вручную",
};

export function RoadTools() {
  const active = tool.value;
  const msg = toolMsg.value;
  const why = active === "res" || active === "craft" || active === "trade" ? ADVICE[people.value?.growth?.[active] ?? "ok"] : null;
  return (
    <div class="road-tools panel">
      {msg ? (
        <div class="road-msg">{msg}</div>
      ) : (
        <div class="road-hint">
          {active ? HINT[active] : "Правая кнопка — наклон"}
          {why && <div>{why}</div>}
        </div>
      )}
      <div class="tool-groups">
        {GROUPS.map((g) => (
          <div class="road-buttons" key={g.title} role="group" aria-label={g.title}>
            {g.buttons.map((b) => (
              <button key={b.id} class={active === b.id ? "active" : ""} onClick={() => (tool.value = active === b.id ? null : b.id)}>
                <Icon name={TOOL_ICON[b.id]} size={16} />
                {b.label}
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
