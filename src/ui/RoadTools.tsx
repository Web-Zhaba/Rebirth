import { roadMsg, tool, type Tool } from "../map/roadTool";

const BUTTONS: { id: Tool; label: string }[] = [
  { id: "path", label: "Тропа" },
  { id: "dirt", label: "Дорога" },
  { id: "bulldoze", label: "Снос" },
];

const HINT: Record<Tool, string> = {
  path: "Клик — точка, ПКМ или Esc — закончить",
  dirt: "Клик — точка, ПКМ или Esc — закончить",
  bulldoze: "Клик по участку — снести, Esc — выйти",
};

export function RoadTools() {
  const active = tool.value;
  const msg = roadMsg.value;
  return (
    <div class="road-tools panel">
      {msg ? <div class="road-msg">{msg}</div> : active && <div class="road-hint">{HINT[active]}</div>}
      <div class="road-buttons">
        {BUTTONS.map((b) => (
          <button
            key={b.id}
            class={active === b.id ? "active" : ""}
            onClick={() => (tool.value = active === b.id ? null : b.id)}
          >
            {b.label}
          </button>
        ))}
      </div>
    </div>
  );
}
