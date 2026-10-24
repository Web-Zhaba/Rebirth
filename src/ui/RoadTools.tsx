import { toolMsg, tool, type Tool } from "../map/tools";

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
];

const ROAD_HINT = "Клик — точка, ПКМ или Esc — закончить";
const BRUSH_HINT = "Тяните — закрасить, Shift+клик — вся сторона дороги, Пробел — двигать карту, Esc — выйти";

const HINT: Record<Tool, string> = {
  path: ROAD_HINT,
  dirt: ROAD_HINT,
  bulldoze: "Клик по участку — снести, Esc — выйти",
  res: BRUSH_HINT,
  craft: BRUSH_HINT,
  trade: BRUSH_HINT,
  clear: `${BRUSH_HINT}. Клик по полю — убрать поле`,
  field: "Клик — вершина, клик по первой точке или Enter — замкнуть, ПКМ — отменить точку, Esc — сбросить",
};

export function RoadTools() {
  const active = tool.value;
  const msg = toolMsg.value;
  return (
    <div class="road-tools panel">
      {msg ? <div class="road-msg">{msg}</div> : active && <div class="road-hint">{HINT[active]}</div>}
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
