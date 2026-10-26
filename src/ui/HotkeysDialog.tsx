import { signal } from "@preact/signals";
import { Dialog } from "./kit";

export const hotkeysOpen = signal(false);

interface HotkeyRow {
  keys: string[];
  desc: string;
}

interface HotkeySection {
  title: string;
  rows: HotkeyRow[];
}

const SECTIONS: HotkeySection[] = [
  {
    title: "Время и перемещение",
    rows: [
      { keys: ["Space", "P"], desc: "Пауза / продолжить симуляцию" },
      { keys: ["1", "2", "3"], desc: "Скорость игры (1×, 2×, 4×)" },
      { keys: ["H", "Home"], desc: "К центру поселения" },
      { keys: ["N"], desc: "Наука: дерево исследований" },
    ],
  },
  {
    title: "Строительство",
    rows: [
      { keys: ["F1 – F5"], desc: "Категории (Дороги, Зоны, Хозяйство, Службы, Прошлое)" },
      { keys: ["Q – Y"], desc: "Выбор инструмента в выбранной категории" },
      { keys: ["B"], desc: "Снос (Бульдозер)" },
    ],
  },
  {
    title: "Управление",
    rows: [
      { keys: ["Esc", "ПКМ"], desc: "Отмена инструмента / разрыв дороги / закрыть панель" },
      { keys: ["Enter"], desc: "Быстрый безопасный выбор в карточке события" },
      { keys: ["?"], desc: "Открыть эту шпаргалку клавиш" },
    ],
  },
];

export function HotkeysDialog() {
  if (!hotkeysOpen.value) return null;
  return (
    <Dialog title="Горячие клавиши" class="hotkeys-dialog" onClose={() => (hotkeysOpen.value = false)}>
      <div class="hotkeys-body">
        {SECTIONS.map((sec) => (
          <div key={sec.title} class="hotkeys-sec">
            <h3 class="hotkeys-sec-title">{sec.title}</h3>
            <div class="hotkeys-table">
              {sec.rows.map((r, i) => (
                <div key={i} class="hotkeys-row">
                  <div class="hotkeys-keys">
                    {r.keys.map((k) => (
                      <kbd key={k} class="hotkey-kbd">{k}</kbd>
                    ))}
                  </div>
                  <span class="hotkeys-desc">{r.desc}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Dialog>
  );
}
