import { PLACED_COLORS, toolMsg, tool, type Tool } from "../map/tools";

const GROUPS: { title: string; buttons: { id: Tool; label: string; color?: string }[] }[] = [
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
      { id: "res", label: "Жильё", color: "#6fb35a" },
      { id: "craft", label: "Ремесло", color: "#d99a3b" },
      { id: "trade", label: "Торговля", color: "#4f8fd0" },
      { id: "field", label: "Поле", color: "#d9c26a" },
      { id: "clear", label: "Снять зону" },
    ],
  },
  {
    title: "Постройки",
    buttons: [
      { id: "gumno", label: "Гумно", color: PLACED_COLORS.gumno },
      { id: "woodcutter", label: "Лесоруб", color: PLACED_COLORS.woodcutter },
      { id: "sawpit", label: "Пильня", color: PLACED_COLORS.sawpit },
      { id: "quarry", label: "Каменоломня", color: PLACED_COLORS.quarry },
      { id: "fisher", label: "Рыбак", color: PLACED_COLORS.fisher },
      { id: "barn", label: "Амбар", color: PLACED_COLORS.barn },
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
  clear: `${BRUSH_HINT}. Клик по полю — убрать поле`,
  gumno: `${PLACE_HINT}. Круг — досягаемость полей (400 м)`,
  woodcutter: `${PLACE_HINT}. Круг — лес вокруг (150 м)`,
  sawpit: PLACE_HINT,
  quarry: PLACE_HINT,
  fisher: `${PLACE_HINT}. Круг — вода рядом (100 м)`,
  barn: PLACE_HINT,
  field: "Клик — вершина, клик по первой точке или Enter — замкнуть, ПКМ — отменить точку, Esc — сбросить",
};

export function RoadTools() {
  const active = tool.value;
  const msg = toolMsg.value;
  return (
    <div class="road-tools panel">
      {msg ? (
        <div class="road-msg">{msg}</div>
      ) : (
        <div class="road-hint">{active ? HINT[active] : "Правая кнопка — наклон"}</div>
      )}
      <div class="tool-groups">
        {GROUPS.map((g) => (
          <div class="road-buttons" key={g.title} role="group" aria-label={g.title}>
            {g.buttons.map((b) => (
              <button key={b.id} class={active === b.id ? "active" : ""} onClick={() => (tool.value = active === b.id ? null : b.id)}>
                {b.color && <span class="swatch" style={{ background: b.color }} />}
                {b.label}
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
